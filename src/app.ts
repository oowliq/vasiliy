import { Events } from '@fluxerjs/core';
import type { Client, Message } from '@fluxerjs/core';
import { openDatabase, type Db } from './db.js';
import { Achievements } from './features/achievements.js';
import { createAnnouncer, type Announce } from './features/announce.js';
import { BirthdayStore } from './features/birthdays.js';
import { LFG_EMOJI, LfgManager, formatLfg, type LfgChange } from './features/lfg.js';
import { QuoteStore } from './features/quotes.js';
import { ReminderStore } from './features/reminders.js';
import { Streaks } from './features/streaks.js';
import { welcomeText } from './features/welcome.js';
import { SettingsStore } from './settings.js';
import { publishWeeklyReports } from './stats/report.js';
import { StatsStore } from './stats/store.js';
import { VoiceTracker, type VoiceSnapshot } from './stats/tracker.js';
import { dayStart, mskParts, weekStart } from './time.js';
import { mention } from './util.js';

/** Как часто проверять напоминания. */
const FAST_TICK_MS = 15_000;
/** Как часто сбрасывать время в БД, проверять ачивки и итоги недели. */
const SLOW_TICK_MS = 60_000;
/** Во сколько по МСК выполнять ежедневные задачи (дни рождения, прерванные серии). */
const DAILY_HOUR_MSK = 10;

export interface App {
  client: Client;
  prefix: string;
  db: Db;
  settings: SettingsStore;
  stats: StatsStore;
  tracker: VoiceTracker;
  achievements: Achievements;
  streaks: Streaks;
  quotes: QuoteStore;
  birthdays: BirthdayStore;
  reminders: ReminderStore;
  lfg: LfgManager;
  announce: Announce;
}

interface RawVoiceState {
  guild_id?: string | null;
  channel_id: string | null;
  user_id: string;
  member?: { user?: { bot?: boolean } };
  mute: boolean;
  deaf: boolean;
  self_mute: boolean;
  self_deaf: boolean;
  self_stream?: boolean;
  self_video?: boolean;
}

function toSnapshot(guildId: string, s: RawVoiceState): VoiceSnapshot {
  return {
    guildId,
    userId: s.user_id,
    channelId: s.channel_id,
    serverMute: s.mute || s.deaf,
    selfMute: s.self_mute || s.self_deaf,
    stream: !!s.self_stream,
    video: !!s.self_video,
  };
}

export function createApp(client: Client, options: { prefix: string; dbPath: string }): App {
  const db = openDatabase(options.dbPath);
  const settings = new SettingsStore(db);
  const stats = new StatsStore(db);
  const announce = createAnnouncer(client, settings);
  const achievements = new Achievements(stats, announce);
  const streaks = new Streaks(stats, announce);
  const tracker = new VoiceTracker(stats, (guildId) => client.guilds.get(guildId)?.afkChannelId, {
    onVoiceDay: (guildId, userId, day) => streaks.onVoiceDay(guildId, userId, day),
    onJoin: (guildId, userId, at) => achievements.onJoin(guildId, userId, at),
  });

  const app: App = {
    client,
    prefix: options.prefix,
    db,
    settings,
    stats,
    tracker,
    achievements,
    streaks,
    quotes: new QuoteStore(db),
    birthdays: new BirthdayStore(db),
    reminders: new ReminderStore(db),
    lfg: new LfgManager(),
    announce,
  };

  registerEvents(app);
  startScheduler(app);
  return app;
}

function registerEvents(app: App): void {
  const { client, tracker, stats, achievements, settings } = app;
  const isBot = (s: RawVoiceState) => s.member?.user?.bot === true || s.user_id === client.user?.id;

  client.on(Events.VoiceStatesSync, ({ guildId, voiceStates }) => {
    tracker.sync(
      guildId,
      voiceStates.filter((s) => !isBot(s)).map((s) => toSnapshot(guildId, s)),
    );
  });

  client.on(Events.VoiceStateUpdate, (data) => {
    if (!data.guild_id || isBot(data)) return;
    tracker.update(toSnapshot(data.guild_id, data));
  });

  client.on(Events.MessageCreate, (message) => {
    if (!message.guildId || message.author.bot) return;
    stats.add(message.guildId, message.author.id, weekStart(Date.now()), { messages: 1 });
    achievements.check(message.guildId, message.author.id);
  });

  client.on(Events.GuildMemberAdd, (member) => {
    if (member.user.bot) return;
    const guildSettings = settings.get(member.guild.id);
    if (!guildSettings.welcomeEnabled) return;
    const channelId = member.guild.systemChannelId ?? guildSettings.announceChannelId;
    if (!channelId) return;
    void app.announce(member.guild.id, welcomeText(member.user.id), { channelId, ping: [member.user.id] });
  });

  client.on(Events.MessageReactionAdd, (payload) => {
    if (payload.emoji.name !== LFG_EMOJI || payload.user.bot) return;
    void applyLfgChange(app, payload.messageId, app.lfg.join(payload.messageId, payload.userId));
  });

  client.on(Events.MessageReactionRemove, (payload) => {
    if (payload.emoji.name !== LFG_EMOJI) return;
    void applyLfgChange(app, payload.messageId, app.lfg.leave(payload.messageId, payload.userId));
  });
}

/** Обновляет сообщение сбора и, если состав собран, зовёт всех. */
async function applyLfgChange(app: App, messageId: string, change: LfgChange | null): Promise<void> {
  if (!change) return;
  const { group } = change;
  try {
    const channel = await app.client.channels.fetch(group.channelId);
    if (!channel?.isTextBased()) return;
    const message: Message = await channel.messages.fetch(messageId);
    await message.edit({ content: formatLfg(group), allowedMentions: { parse: [] } });
    if (change.kind === 'filled') {
      await channel.send({
        content: `🚀 Состав в **${group.game}** собран: ${group.members.map(mention).join(' ')} — погнали!`,
        allowedMentions: { parse: [], users: group.members },
      });
    }
  } catch (error) {
    console.error('[lfg] не удалось обновить сбор:', error);
  }
}

function startScheduler(app: App): void {
  const fast = () => void sendDueReminders(app);
  const slow = async () => {
    try {
      app.tracker.flush();
      for (const { guildId, userId } of app.tracker.activeUsers()) {
        app.achievements.check(guildId, userId);
      }
      app.lfg.cleanup();
      await publishWeeklyReports(app.client, app.stats, app.settings, app.announce);
      await runDailyTasks(app);
    } catch (error) {
      console.error('[scheduler] ошибка:', error);
    }
  };

  const fastTimer = setInterval(fast, FAST_TICK_MS);
  const slowTimer = setInterval(() => void slow(), SLOW_TICK_MS);
  app.client.once(Events.Ready, () => {
    fast();
    void slow();
  });

  const shutdown = () => {
    clearInterval(fastTimer);
    clearInterval(slowTimer);
    try {
      app.tracker.flush();
      app.db.close();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function sendDueReminders(app: App): Promise<void> {
  for (const reminder of app.reminders.due(Date.now())) {
    // Удаляем до отправки: лучше потерять напоминание, чем слать его каждые 15 секунд.
    app.reminders.remove(reminder.id);
    try {
      const channel = await app.client.channels.fetch(reminder.channelId);
      if (!channel?.isTextBased()) throw new Error('канал недоступен');
      await channel.send({
        content: `⏰ ${mention(reminder.userId)}, напоминаю: ${reminder.text}`,
        allowedMentions: { parse: [], users: [reminder.userId] },
      });
    } catch (error) {
      console.error(`[remind] не удалось отправить напоминание #${reminder.id}:`, error);
    }
  }
}

/** Раз в день после 10:00 МСК: дни рождения и прерванные серии. */
async function runDailyTasks(app: App): Promise<void> {
  const now = Date.now();
  if (mskParts(now).hour < DAILY_HOUR_MSK) return;
  const today = dayStart(now);

  for (const guild of app.settings.withAnnounceChannel()) {
    if ((guild.lastDailyDay ?? -Infinity) >= today) continue;
    app.settings.update(guild.guildId, { lastDailyDay: today });

    const birthdays = app.birthdays.today(guild.guildId, now);
    if (birthdays.length) {
      const ids = birthdays.map((b) => b.userId);
      await app.announce(
        guild.guildId,
        `🎂 Сегодня день рождения у ${ids.map(mention).join(', ')}! Поздравляем! 🎉`,
        { ping: ids },
      );
    }
    await app.streaks.reportBroken(guild.guildId, today);
  }
}

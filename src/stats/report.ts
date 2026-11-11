import type { Client, GuildMember } from '@fluxerjs/core';
import type { Announce } from '../features/announce.js';
import type { SettingsStore } from '../settings.js';
import { HOUR_MS, reportWeek, weekStart } from '../time.js';
import { formatWeeklyReport } from './format.js';
import type { StatsStore } from './store.js';

// Защищает и вызов по Ready, и интервальные вызовы от наложения.
const running = new WeakSet<SettingsStore>();

/** Команды настройки не должны менять роли посреди сетевых запросов выдачи. */
export const weeklyTasksRunning = (settings: SettingsStore): boolean => running.has(settings);

/** Итоги календарной недели: понедельник 09:00 МСК, с догоняющим запуском после простоя. */
export async function publishWeeklyReports(
  client: Client,
  stats: StatsStore,
  settings: SettingsStore,
  announce: Announce,
): Promise<void> {
  const now = Date.now();
  if (now < weekStart(now) + 9 * HOUR_MS || running.has(settings)) return;
  running.add(settings);
  try {
    const finishedWeek = reportWeek(now);
    for (const initial of settings.withWeeklyTasks()) {
      try {
        let config = settings.get(initial.guildId);
        const guildId = config.guildId;
        const { defaultRoleId, weeklyRoleId } = config;
        if (defaultRoleId && weeklyRoleId && (config.lastAwardedWeek ?? -Infinity) < finishedWeek) {
          if (defaultRoleId === weeklyRoleId) throw new Error('Конкурс требует разные роли');
          const guild = await client.guilds.resolve(guildId);
          // REST-пагинация: кэш содержит не всех участников сервера.
          const members: GuildMember[] = [];
          let after: string | undefined;
          for (;;) {
            const page = await guild.members.fetch({ limit: 1000, after });
            members.push(...page);
            if (page.length < 1000) break;
            const next = page[page.length - 1]!.id;
            if (next === after) throw new Error('Пагинация участников не продвигается');
            after = next;
          }
          const latest = settings.get(guildId);
          if (latest.defaultRoleId !== defaultRoleId || latest.weeklyRoleId !== weeklyRoleId ||
            (latest.lastAwardedWeek ?? -Infinity) >= finishedWeek) continue;
          config = latest;
          const awardWeek = config.pendingWeek ?? finishedWeek;
          if (config.pendingWeek === null) {
            // Прежние обладатели получат default_role при сбросе и тоже участвуют.
            const eligible = new Set(members.filter((m) => !m.user.bot &&
              (m.roles.has(defaultRoleId) || m.roles.has(weeklyRoleId))).map((m) => m.id));
            const candidates = stats.getWeekAll(guildId, awardWeek)
              .filter((r) => eligible.has(r.userId) && r.counters.voice_ms > 0)
              .sort((a, b) => b.counters.voice_ms - a.counters.voice_ms ||
                (BigInt(a.userId) < BigInt(b.userId) ? -1 : BigInt(a.userId) > BigInt(b.userId) ? 1 : 0));
            // Без соперника конкурс не состоялся: нужны хотя бы два активных участника.
            const winner = candidates.length >= 2 ? candidates[0] : undefined;
            settings.update(guildId, { pendingWeek: awardWeek, pendingWinnerId: winner?.userId ?? null });
            config = settings.get(guildId);
          }
          // Сначала добавляем замену: ошибка API не оставит участника без обеих ролей.
          for (const member of members) {
            if (!member.roles.has(weeklyRoleId)) continue;
            if (!member.roles.has(defaultRoleId)) await member.roles.add(defaultRoleId);
            await member.roles.remove(weeklyRoleId);
          }
          const winner = members.find((m) => m.id === config.pendingWinnerId);
          if (winner && !winner.user.bot) {
            await winner.roles.add(weeklyRoleId);
            if (winner.roles.has(defaultRoleId)) await winner.roles.remove(defaultRoleId);
          }
          settings.update(guildId, {
            lastAwardedWeek: awardWeek, weeklyUserId: winner?.id ?? null,
            pendingWeek: null, pendingWinnerId: null,
          });
          // Если незавершённая выдача была за более старую неделю, текущую обработает следующий тик.
          if (awardWeek !== finishedWeek) continue;
          config = settings.get(guildId);
        }
        if (!config.announceChannelId || (config.lastReportedWeek ?? -Infinity) >= finishedWeek) continue;
        const winnerId = defaultRoleId && weeklyRoleId && config.lastAwardedWeek === finishedWeek
          ? config.weeklyUserId : null;
        const report = formatWeeklyReport(stats, guildId, finishedWeek, winnerId);
        if (await announce(guildId, report.text, { ping: winnerId ? [winnerId] : [] })) {
          settings.update(guildId, { lastReportedWeek: finishedWeek });
        }
      } catch (error) {
        // Не отмечаем выполнение: повторяем на следующем тике, сохранив выбранного победителя.
        console.error(`[stats] не удалось подвести итоги в гильдии ${initial.guildId}:`, error);
      }
    }
  } finally {
    running.delete(settings);
  }
}

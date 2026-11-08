import { PermissionFlags } from '@fluxerjs/core';
import type { Guild, GuildChannel, Message, ThreadChannel } from '@fluxerjs/core';

/** Сколько ждём подтверждения после первого вызова команды. */
const CONFIRM_TTL_MS = 60_000;
/** Лимит API на одну страницу истории и на один bulk-delete. */
const PAGE_SIZE = 100;

type DeletableChannel = {
  id: string;
  name: string | null;
  messages: { fetch(options: { limit: number; before?: string }): Promise<Map<string, Message>> };
  bulkDelete(ids: readonly string[]): Promise<string[]>;
};

interface PurgeStats {
  channels: number;
  deleted: number;
  failed: number;
}

/** Кто и в какой гильдии запросил очистку: `${guildId}:${userId}` → время истечения. */
const pendingConfirmations = new Map<string, number>();
/** Гильдии, в которых очистка идёт прямо сейчас. */
const runningPurges = new Set<string>();

export async function handlePurge(message: Message, args: string[]): Promise<void> {
  const guild = await message.resolveGuild();
  if (!guild) {
    await message.reply('Эта команда работает только на сервере.');
    return;
  }

  const member =
    guild.members.get(message.author.id) ?? (await guild.fetchMember(message.author.id));
  if (!member?.permissions.has(PermissionFlags.Administrator)) {
    await message.reply('Очистить сервер может только администратор.');
    return;
  }

  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (
    !me?.permissions.has(PermissionFlags.ManageMessages) ||
    !me.permissions.has(PermissionFlags.ReadMessageHistory)
  ) {
    await message.reply(
      'Боту нужны права «Управлять сообщениями» и «Читать историю сообщений».',
    );
    return;
  }

  if (runningPurges.has(guild.id)) {
    await message.reply('Очистка уже идёт, дождитесь её окончания.');
    return;
  }

  const key = `${guild.id}:${message.author.id}`;
  const expiresAt = pendingConfirmations.get(key);
  const confirmed = args[0]?.toLowerCase() === 'confirm' && expiresAt && expiresAt > Date.now();

  if (!confirmed) {
    pendingConfirmations.set(key, Date.now() + CONFIRM_TTL_MS);
    await message.reply(
      '⚠️ Будут **безвозвратно удалены все сообщения и вложения** во всех каналах и тредах сервера.\n' +
        `Для подтверждения отправьте \`${message.content.split(/\s+/)[0]} confirm\` в течение 60 секунд.`,
    );
    return;
  }

  pendingConfirmations.delete(key);
  runningPurges.add(guild.id);
  try {
    const stats = await purgeGuild(guild, message.channelId);
    const summary =
      `🧹 Очистка завершена: каналов — ${stats.channels}, удалено сообщений — ${stats.deleted}` +
      (stats.failed ? `, не удалось удалить — ${stats.failed}.` : '.');
    console.log(`[purge] guild ${guild.id}: ${summary}`);
    // Исходное сообщение уже удалено, поэтому пишем в канал, а не отвечаем на него.
    const channel = await message.resolveChannel();
    if (channel?.isTextBased()) await channel.send(summary);
  } catch (error) {
    console.error(`[purge] guild ${guild.id} failed:`, error);
    const channel = await message.resolveChannel().catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send('Очистка прервана из-за ошибки, подробности в логах бота.').catch(() => {});
    }
  } finally {
    runningPurges.delete(guild.id);
  }
}

async function purgeGuild(guild: Guild, commandChannelId: string): Promise<PurgeStats> {
  const channels = await collectChannels(guild);
  // Канал, где вызвали команду, чистим последним: туда потом уйдёт итог.
  channels.sort((a, b) => Number(a.id === commandChannelId) - Number(b.id === commandChannelId));

  const stats: PurgeStats = { channels: 0, deleted: 0, failed: 0 };
  for (const channel of channels) {
    const result = await purgeChannel(channel);
    stats.channels++;
    stats.deleted += result.deleted;
    stats.failed += result.failed;
    console.log(
      `[purge] #${channel.name ?? channel.id}: удалено ${result.deleted}, ошибок ${result.failed}`,
    );
  }
  return stats;
}

/** Все каналы гильдии, в которых есть сообщения: текстовые, голосовые (чат), анонсы и треды. */
async function collectChannels(guild: Guild): Promise<DeletableChannel[]> {
  const guildChannels = await guild.fetchChannels();
  const result = new Map<string, DeletableChannel>();

  for (const channel of guildChannels) {
    if (channel.isTextBased()) result.set(channel.id, channel as unknown as DeletableChannel);
  }

  const { threads: active } = await guild.fetchActiveThreads();
  for (const thread of active) result.set(thread.id, thread as unknown as DeletableChannel);

  for (const channel of guildChannels) {
    for (const thread of await fetchArchivedThreads(channel)) {
      result.set(thread.id, thread as unknown as DeletableChannel);
    }
  }

  return [...result.values()];
}

async function fetchArchivedThreads(channel: GuildChannel): Promise<ThreadChannel[]> {
  if (!(channel.isText() || channel.isAnnouncement() || channel.isForum() || channel.isMedia())) {
    return [];
  }

  const threads: ThreadChannel[] = [];
  for (const type of ['public', 'private'] as const) {
    let before: string | undefined;
    try {
      for (;;) {
        const page = await channel.threads.fetchArchived({ type, before, limit: PAGE_SIZE });
        threads.push(...page.threads);
        const last = page.threads.at(-1)?.archiveTimestamp;
        if (!page.hasMore || !last) break;
        before = last;
      }
    } catch (error) {
      // Приватные архивные треды требуют отдельного права — без него просто пропускаем.
      console.warn(`[purge] архивные ${type}-треды #${channel.name ?? channel.id} недоступны:`, error);
    }
  }
  return threads;
}

async function purgeChannel(channel: DeletableChannel): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  let before: string | undefined;

  for (;;) {
    const page = await channel.messages.fetch({ limit: PAGE_SIZE, before });
    if (page.size === 0) break;

    const ids = [...page.keys()];
    // Курсор двигаем по самому старому сообщению страницы, чтобы
    // неудаляемые (например, системные) сообщения не зациклили обход.
    before = ids.reduce((min, id) => (BigInt(id) < BigInt(min) ? id : min));

    const result = await deleteBatch(channel, page);
    deleted += result.deleted;
    failed += result.failed;

    if (page.size < PAGE_SIZE) break;
  }

  return { deleted, failed };
}

async function deleteBatch(
  channel: DeletableChannel,
  page: Map<string, Message>,
): Promise<{ deleted: number; failed: number }> {
  try {
    await channel.bulkDelete([...page.keys()]);
    return { deleted: page.size, failed: 0 };
  } catch (error) {
    // bulk-delete может требовать MFA/sudo — тогда удаляем по одному.
    console.warn(`[purge] bulk-delete в #${channel.name ?? channel.id} не сработал, удаляю по одному:`, error);
  }

  let deleted = 0;
  let failed = 0;
  for (const msg of page.values()) {
    try {
      await msg.delete();
      deleted++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed };
}

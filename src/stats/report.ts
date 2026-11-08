import type { Client } from '@fluxerjs/core';
import type { Announce } from '../features/announce.js';
import type { SettingsStore } from '../settings.js';
import { WEEK_MS, weekStart } from '../time.js';
import { mention } from '../util.js';
import { formatWeeklyReport } from './format.js';
import type { StatsStore } from './store.js';

/** Публикует итоги прошедшей недели во все гильдии, где они ещё не опубликованы. */
export async function publishWeeklyReports(
  client: Client,
  stats: StatsStore,
  settings: SettingsStore,
  announce: Announce,
): Promise<void> {
  const finishedWeek = weekStart(Date.now()) - WEEK_MS;

  for (const guild of settings.withAnnounceChannel()) {
    if ((guild.lastReportedWeek ?? -Infinity) >= finishedWeek) continue;
    // Отмечаем заранее: если канал удалён, не спамим попытками каждую минуту.
    settings.update(guild.guildId, { lastReportedWeek: finishedWeek });

    const report = formatWeeklyReport(stats, guild.guildId, finishedWeek);
    const sent = await announce(guild.guildId, report.text);
    if (sent) console.log(`[stats] итоги недели опубликованы в гильдии ${guild.guildId}`);

    if (guild.mvpRoleId && report.mvpUserId) {
      await passMvpRole(client, settings, announce, guild.guildId, guild.mvpRoleId, guild.mvpUserId, report.mvpUserId);
    }
  }
}

/** Снимает роль MVP с прошлого победителя и выдаёт новому. */
async function passMvpRole(
  client: Client,
  settings: SettingsStore,
  announce: Announce,
  guildId: string,
  roleId: string,
  previousUserId: string | null,
  winnerId: string,
): Promise<void> {
  try {
    const guild = await client.guilds.resolve(guildId);
    if (previousUserId && previousUserId !== winnerId) {
      const previous = await guild.members.resolve(previousUserId).catch(() => null);
      if (previous?.roles.has(roleId)) await previous.roles.remove(roleId);
    }
    const winner = await guild.members.resolve(winnerId);
    if (!winner.roles.has(roleId)) await winner.roles.add(roleId);
    settings.update(guildId, { mvpUserId: winnerId });
    await announce(guildId, `👑 Роль MVP недели переходит к ${mention(winnerId)}!`, { ping: [winnerId] });
  } catch (error) {
    console.error(`[stats] не удалось передать роль MVP в гильдии ${guildId}:`, error);
    await announce(
      guildId,
      '⚠️ Не получилось выдать роль MVP. Проверьте, что у бота есть право «Управлять ролями» и его роль выше роли MVP.',
    );
  }
}

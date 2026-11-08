import { WEEK_MS, weekStart } from '../time.js';
import { handlePurge } from './purge.js';
import type { Command } from './types.js';

export const adminCommands: Command[] = [
  {
    name: 'channel',
    admin: true,
    usage: 'channel [off]',
    description: 'Сделать этот канал каналом объявлений бота',
    details: [
      'Сюда приходят итоги недели, серии, ачивки и дни рождения. `off` — отключить объявления.',
    ],
    async run({ message, args, app, guildId }) {
      if (args[0]?.toLowerCase() === 'off') {
        app.settings.update(guildId, { announceChannelId: null });
        await message.reply('Объявления отключены.');
        return;
      }
      const current = app.settings.get(guildId);
      // Если раньше канала не было, прошлую неделю считаем опубликованной: первые итоги — в ближайшее воскресенье.
      const lastWeek = weekStart(Date.now()) - WEEK_MS;
      app.settings.update(guildId, {
        announceChannelId: message.channelId,
        lastReportedWeek: Math.max(current.lastReportedWeek ?? 0, lastWeek),
      });
      await message.reply(
        'Готово: объявления бота будут приходить сюда. Итоги недели — каждое воскресенье в 18:00 МСК.',
      );
    },
  },
  {
    name: 'mvprole',
    admin: true,
    usage: 'mvprole @роль | off',
    description: 'Роль, которую каждую неделю получает MVP (больше всех в голосе)',
    async run({ message, args, app, guildId }) {
      if (args[0]?.toLowerCase() === 'off') {
        app.settings.update(guildId, { mvpRoleId: null, mvpUserId: null });
        await message.reply('Роль MVP больше не выдаётся.');
        return;
      }
      // `<@&id>` или просто id роли.
      const roleId = /^(?:<@&)?(\d+)>?$/.exec(args[0] ?? '')?.[1] ?? null;
      if (!roleId) {
        await message.reply(`Пример: \`${app.prefix}mvprole @MVP\` или \`${app.prefix}mvprole off\``);
        return;
      }
      app.settings.update(guildId, { mvpRoleId: roleId });
      await message.reply(
        `Готово: роль <@&${roleId}> будет переходить к MVP недели. Боту нужно право «Управлять ролями», а его роль должна быть выше этой.`,
      );
    },
  },
  {
    name: 'welcome',
    admin: true,
    usage: 'welcome on | off',
    description: 'Приветствовать новых участников',
    async run({ message, args, app, guildId }) {
      const arg = args[0]?.toLowerCase();
      if (arg !== 'on' && arg !== 'off') {
        const enabled = app.settings.get(guildId).welcomeEnabled;
        await message.reply(`Приветствия сейчас ${enabled ? 'включены' : 'выключены'}. Пример: \`${app.prefix}welcome off\``);
        return;
      }
      app.settings.update(guildId, { welcomeEnabled: arg === 'on' });
      await message.reply(
        arg === 'on'
          ? 'Приветствия включены. Пишу в системный канал сервера, а если его нет — в канал объявлений.'
          : 'Приветствия выключены.',
      );
    },
  },
  {
    name: 'purge',
    admin: true,
    usage: 'purge',
    description: 'Удалить ВСЕ сообщения и вложения на сервере (с подтверждением)',
    async run({ message, args }) {
      await handlePurge(message, args);
    },
  },
];

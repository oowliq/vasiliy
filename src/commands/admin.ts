import { reportWeek } from '../time.js';
import { weeklyTasksRunning } from '../stats/report.js';
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
      // Если раньше канала не было, прошлую неделю считаем опубликованной: первые итоги — в ближайший понедельник.
      const lastWeek = reportWeek(Date.now());
      app.settings.update(guildId, {
        announceChannelId: message.channelId,
        lastReportedWeek: Math.max(current.lastReportedWeek ?? 0, lastWeek),
      });
      await message.reply(
        'Готово: объявления бота будут приходить сюда. Итоги недели — каждый понедельник в 09:00 МСК.',
      );
    },
  },
  roleCommand('default_role', 'defaultRoleId'),
  roleCommand('weekly_role', 'weeklyRoleId'),
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

function roleCommand(name: string, field: 'defaultRoleId' | 'weeklyRoleId'): Command {
  return {
    name,
    aliases: field === 'weeklyRoleId' ? ['mvprole'] : [],
    admin: true,
    usage: `${name} @роль | off`,
    description: field === 'defaultRoleId' ? 'Роль участников еженедельного конкурса' : 'Роль победителя недели по времени в голосе',
    async run({ message, args, app, guildId }) {
      let current = app.settings.get(guildId);
      if (weeklyTasksRunning(app.settings)) {
        await message.reply('Бот сейчас подводит итоги. Повторите команду после завершения.');
        return;
      }
      if (args[0]?.toLowerCase() === 'off') {
        app.settings.update(guildId, { [field]: null, pendingWeek: null, pendingWinnerId: null });
        await message.reply('Еженедельная выдача ролей отключена. Уже выданные роли сохранены.');
        return;
      }
      if (current.pendingWeek !== null) {
        await message.reply(`Есть незавершённая выдача. Исправьте права бота или отмените её командой \`${app.prefix}${name} off\`, затем настройте роли заново.`);
        return;
      }
      const roleId = /^(?:<@&(\d+)>|(\d+))$/.exec(args[0] ?? '')?.slice(1).find(Boolean);
      if (!roleId) {
        await message.reply(`Пример: \`${app.prefix}${name} @роль\` или \`${app.prefix}${name} off\``);
        return;
      }
      const other = field === 'defaultRoleId' ? current.weeklyRoleId : current.defaultRoleId;
      if (roleId === other || roleId === guildId) {
        await message.reply('Нужны две разные роли, отличные от @everyone.');
        return;
      }
      const guild = await app.client.guilds.resolve(guildId);
      await guild.fetchRoles();
      const role = guild.roles.get(roleId);
      if (!role) {
        await message.reply('Роль не найдена. Выберите роль этого сервера.');
        return;
      }
      current = app.settings.get(guildId);
      if (weeklyTasksRunning(app.settings) || current.pendingWeek !== null) {
        await message.reply('Выдача ролей уже началась. Повторите команду после завершения.');
        return;
      }
      const latestOther = field === 'defaultRoleId' ? current.weeklyRoleId : current.defaultRoleId;
      if (roleId === latestOther) {
        await message.reply('Нужны две разные роли.');
        return;
      }
      app.settings.update(guildId, {
        [field]: roleId,
        // Первое назначение — в ближайший понедельник, без выдачи за старые недели.
        lastAwardedWeek: Math.max(current.lastAwardedWeek ?? -Infinity, reportWeek(Date.now())),
      });
      await message.reply(`Готово: ${name} — <@&${roleId}>. Выдача и итоги — в понедельник в 09:00 МСК. Боту нужны права «Управлять ролями», а его роль должна быть выше обеих настроенных ролей.`);
    },
  };
}

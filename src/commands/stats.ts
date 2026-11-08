import { parseUserMention } from '@fluxerjs/core';
import { formatCompare, formatTop, formatUser } from '../stats/format.js';
import { dayStart, weekStart } from '../time.js';
import { quiet } from '../util.js';
import type { Command } from './types.js';

export const statsCommands: Command[] = [
  {
    name: 'stats',
    usage: 'stats [@участник]',
    description: 'Статистика за неделю и за всё время',
    async run({ message, args, app, guildId }) {
      // Подтягиваем в БД время текущих голосовых сессий, чтобы цифры были актуальными.
      app.tracker.flush();
      const userId = args[0] ? parseUserMention(args[0]) : message.author.id;
      if (!userId) {
        await message.reply(`Не понял, чью статистику показать. Пример: \`${app.prefix}stats @участник\``);
        return;
      }
      const now = Date.now();
      const week = weekStart(now);
      const today = dayStart(now);
      const { stats } = app;
      const streak = Math.max(
        stats.getStreak(guildId, userId, today),
        stats.getStreak(guildId, userId, today - 86_400_000),
      );
      await message.reply({
        content: formatUser(userId, stats.getWeek(guildId, userId, week), stats.getTotal(guildId, userId), {
          streak,
          bestStreak: stats.getBestStreak(guildId, userId),
          partnerWeek: stats.getBestPartner(guildId, userId, week),
          partnerTotal: stats.getBestPartner(guildId, userId, null),
        }),
        ...quiet(),
      });
    },
  },
  {
    name: 'top',
    usage: 'top',
    description: 'Топ текущей недели',
    async run({ message, app, guildId }) {
      app.tracker.flush();
      await message.reply({ content: formatTop(app.stats, guildId, weekStart(Date.now())), ...quiet() });
    },
  },
  {
    name: 'compare',
    aliases: ['vs'],
    usage: 'compare @участник [@участник]',
    description: 'Сравнить двух участников',
    async run({ message, args, app, guildId }) {
      const first = args[0] ? parseUserMention(args[0]) : null;
      const second = args[1] ? parseUserMention(args[1]) : message.author.id;
      if (!first || !second || first === second) {
        await message.reply(`Пример: \`${app.prefix}compare @вася\` или \`${app.prefix}compare @вася @петя\``);
        return;
      }
      app.tracker.flush();
      const [a, b] = [second, first];
      await message.reply({
        content: formatCompare(a, app.stats.getTotal(guildId, a), b, app.stats.getTotal(guildId, b)),
        ...quiet(),
      });
    },
  },
  {
    name: 'achievements',
    aliases: ['ach', 'ачивки'],
    usage: 'achievements [@участник]',
    description: 'Ачивки — свои или чужие',
    async run({ message, args, app, guildId }) {
      const userId = args[0] ? parseUserMention(args[0]) : message.author.id;
      if (!userId) {
        await message.reply(`Пример: \`${app.prefix}achievements @участник\``);
        return;
      }
      app.tracker.flush();
      app.achievements.check(guildId, userId);
      await message.reply({ content: app.achievements.list(guildId, userId), ...quiet() });
    },
  },
];

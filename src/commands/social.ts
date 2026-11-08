import { parseUserMention } from '@fluxerjs/core';
import type { Message } from '@fluxerjs/core';
import { formatBirthday, parseBirthday } from '../features/birthdays.js';
import { LFG_EMOJI, formatLfg, parseLfg } from '../features/lfg.js';
import { formatQuote } from '../features/quotes.js';
import { MAX_REMINDERS_PER_USER } from '../features/reminders.js';
import { WEEK_MS, formatDuration, formatMsk, parseDuration } from '../time.js';
import { isAdmin, mention, quiet } from '../util.js';
import type { Command } from './types.js';

/** Сообщение, на которое отвечает `message` (из кэша или API). */
async function repliedMessage(message: Message): Promise<Message | null> {
  if (message.referencedMessage) return message.referencedMessage;
  const ref = message.messageReference;
  if (!ref) return null;
  try {
    const channel = await message.client.channels.fetch(ref.channelId);
    return channel?.isTextBased() ? await channel.messages.fetch(ref.messageId) : null;
  } catch {
    return null;
  }
}

export const socialCommands: Command[] = [
  {
    name: 'quote',
    aliases: ['q', 'цитата'],
    usage: 'quote [@участник | номер]',
    description: 'Цитатник: ответь на сообщение, чтобы сохранить; без ответа — случайная цитата',
    details: [
      'Ответом на сообщение — сохранить его в цитатник.',
      'Без аргументов — случайная цитата, `@участник` — случайная цитата этого человека, `номер` — конкретная.',
      '`delete номер` — удалить (тот, кто сохранил, или админ).',
    ],
    async run({ message, args, app, guildId }) {
      const { quotes } = app;
      const target = await repliedMessage(message);

      if (target) {
        const content = target.content?.trim();
        if (!content) {
          await message.reply('В этом сообщении нет текста — сохранить нечего.');
          return;
        }
        const { quote, created } = quotes.add({
          guildId,
          authorId: target.author.id,
          content: content.slice(0, 1500),
          savedBy: message.author.id,
          messageId: target.id,
          createdAt: target.createdAt.getTime(),
        });
        await message.reply({
          content: created ? `📌 Сохранил цитату #${quote.id}` : `Эта цитата уже есть: #${quote.id}`,
          ...quiet(),
        });
        return;
      }

      if (args[0]?.toLowerCase() === 'delete' || args[0]?.toLowerCase() === 'del') {
        const id = Number(args[1]);
        const quote = Number.isInteger(id) ? quotes.get(guildId, id) : null;
        if (!quote) {
          await message.reply('Нет такой цитаты.');
          return;
        }
        if (quote.savedBy !== message.author.id && !(await isAdmin(message))) {
          await message.reply('Удалить цитату может тот, кто её сохранил, или админ.');
          return;
        }
        quotes.remove(guildId, id);
        await message.reply(`🗑 Цитата #${id} удалена.`);
        return;
      }

      const byNumber = args[0] && /^\d+$/.test(args[0]) ? quotes.get(guildId, Number(args[0])) : undefined;
      const authorId = args[0] && byNumber === undefined ? parseUserMention(args[0]) : null;
      const quote = byNumber !== undefined ? byNumber : quotes.random(guildId, authorId ?? undefined);
      if (!quote) {
        await message.reply(
          quotes.count(guildId) === 0
            ? `Цитатник пуст. Ответь на любое сообщение командой \`${app.prefix}quote\`, чтобы сохранить его.`
            : 'Такой цитаты не нашлось.',
        );
        return;
      }
      await message.reply({ content: formatQuote(quote), ...quiet() });
    },
  },
  {
    name: 'bday',
    aliases: ['birthday', 'др'],
    usage: 'bday [ДД.ММ | remove]',
    description: 'Дни рождения: указать свой или посмотреть ближайшие',
    details: [
      '`ДД.ММ` — указать свой день рождения (например, `15.03`).',
      '`remove` — удалить. Без аргументов — ближайшие дни рождения.',
      'Поздравления приходят в канал объявлений в 10:00 МСК.',
    ],
    async run({ message, args, app, guildId }) {
      const { birthdays } = app;
      const arg = args[0]?.toLowerCase();

      if (arg === 'remove' || arg === 'delete') {
        const removed = birthdays.remove(guildId, message.author.id);
        await message.reply(removed ? 'Удалил твой день рождения.' : 'У тебя и не был указан день рождения.');
        return;
      }

      if (arg) {
        const date = parseBirthday(arg);
        if (!date) {
          await message.reply(`Не понял дату. Пример: \`${app.prefix}bday 15.03\``);
          return;
        }
        birthdays.set(guildId, message.author.id, date.day, date.month);
        await message.reply(`🎂 Запомнил: ${formatBirthday(date)}. Поздравим!`);
        return;
      }

      const upcoming = birthdays.upcoming(guildId, Date.now(), 10);
      if (upcoming.length === 0) {
        await message.reply(`Никто ещё не указал день рождения. Будь первым: \`${app.prefix}bday ДД.ММ\``);
        return;
      }
      const lines = upcoming.map((b) => {
        const when = b.inDays === 0 ? '**сегодня!**' : b.inDays === 1 ? 'завтра' : `через ${b.inDays} дн.`;
        return `${mention(b.userId)} — ${formatBirthday(b)} (${when})`;
      });
      await message.reply({ content: `🎂 **Ближайшие дни рождения**\n${lines.join('\n')}`, ...quiet() });
    },
  },
  {
    name: 'remind',
    aliases: ['напомни'],
    usage: 'remind 2h30m текст',
    description: 'Напоминание через заданное время',
    details: [
      'Время: `30m`, `2h`, `1h30m`, `3d`, `1w` (или по-русски: `30мин`, `2ч`, `3д`).',
      '`list` — твои напоминания, `cancel номер` — отменить.',
    ],
    async run({ message, args, rest, app, guildId }) {
      const { reminders } = app;
      const sub = args[0]?.toLowerCase();

      if (sub === 'list') {
        const mine = reminders.listForUser(message.author.id);
        if (mine.length === 0) {
          await message.reply('Напоминаний нет.');
          return;
        }
        const lines = mine.map((r) => `#${r.id} — ${formatMsk(r.dueAt)} МСК: ${r.text}`);
        await message.reply({ content: `⏰ **Твои напоминания**\n${lines.join('\n')}`, ...quiet() });
        return;
      }

      if (sub === 'cancel' || sub === 'delete') {
        const removed = reminders.remove(Number(args[1]), message.author.id);
        await message.reply(removed ? 'Напоминание отменено.' : 'Нет такого напоминания среди твоих.');
        return;
      }

      const delay = args[0] ? parseDuration(args[0]) : null;
      const text = rest.trim().slice(args[0]?.length ?? 0).trim();
      if (!delay || !text) {
        await message.reply(`Пример: \`${app.prefix}remind 1h30m забрать пиццу\``);
        return;
      }
      if (delay > 52 * WEEK_MS) {
        await message.reply('Максимум — год вперёд.');
        return;
      }
      if (reminders.listForUser(message.author.id).length >= MAX_REMINDERS_PER_USER) {
        await message.reply(`У тебя уже ${MAX_REMINDERS_PER_USER} напоминаний. Отмени ненужные: \`${app.prefix}remind list\``);
        return;
      }
      const reminder = reminders.add({
        guildId,
        channelId: message.channelId,
        userId: message.author.id,
        text: text.slice(0, 1000),
        dueAt: Date.now() + delay,
      });
      await message.reply({
        content: `⏰ Напомню через ${formatDuration(delay)} (${formatMsk(reminder.dueAt)} МСК). Номер: #${reminder.id}`,
        ...quiet(),
      });
    },
  },
  {
    name: 'lfg',
    aliases: ['сбор'],
    usage: 'lfg игра [сколько человек]',
    description: 'Собрать народ на игру',
    details: [
      `Например, \`lfg CS 5\`. Участники жмут ${LFG_EMOJI}, когда состав собран — бот всех зовёт.`,
      'Сбор живёт 6 часов и сбрасывается при перезапуске бота.',
    ],
    async run({ message, rest, app }) {
      const parsed = parseLfg(rest);
      if (!parsed) {
        await message.reply(`Пример: \`${app.prefix}lfg CS 5\` (от 2 до 50 человек)`);
        return;
      }
      const channel = await message.resolveChannel();
      if (!channel?.isTextBased()) return;
      const draft = { game: parsed.game, size: parsed.size, authorId: message.author.id };
      const preview = formatLfg({ ...draft, messageId: '', channelId: '', members: [draft.authorId], createdAt: 0, closed: false });
      const sent = await channel.send({ content: preview, allowedMentions: { parse: [] } });
      app.lfg.create({ ...draft, messageId: sent.id, channelId: channel.id });
      await sent.react(LFG_EMOJI);
    },
  },
];

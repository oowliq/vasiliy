import { randomInt } from 'node:crypto';
import { EIGHT_BALL, NUMBER_EMOJIS, parseChoices, parsePoll, rollDice } from '../features/fun.js';
import { mention, pick, quiet } from '../util.js';
import type { Command } from './types.js';

export const funCommands: Command[] = [
  {
    name: 'coinflip',
    aliases: ['flip', 'монетка'],
    usage: 'coinflip',
    description: 'Подбросить монетку',
    async run({ message }) {
      await message.reply(`🪙 ${randomInt(2) === 0 ? 'Орёл' : 'Решка'}!`);
    },
  },
  {
    name: 'roll',
    aliases: ['dice'],
    usage: 'roll [2d6 | d20 | 100]',
    description: 'Бросить кубики',
    async run({ message, args, app }) {
      const roll = rollDice(args[0]);
      if (!roll) {
        await message.reply(`Примеры: \`${app.prefix}roll\`, \`${app.prefix}roll 2d6\`, \`${app.prefix}roll d20\`, \`${app.prefix}roll 100\` (до 100 кубиков)`);
        return;
      }
      const detail = roll.count > 1 ? ` (${roll.rolls.join(' + ')})` : '';
      await message.reply(`🎲 ${roll.count}d${roll.sides}: **${roll.total}**${detail}`);
    },
  },
  {
    name: 'choose',
    aliases: ['выбери'],
    usage: 'choose пицца | суши | шаурма',
    description: 'Выбрать за тебя',
    async run({ message, rest, app }) {
      const choices = parseChoices(rest);
      if (choices.length < 2) {
        await message.reply(`Дай хотя бы два варианта: \`${app.prefix}choose пицца | суши\` или \`пицца или суши\``);
        return;
      }
      await message.reply({ content: `🤔 Я выбираю: **${pick(choices)}**`, ...quiet() });
    },
  },
  {
    name: '8ball',
    aliases: ['шар'],
    usage: '8ball вопрос',
    description: 'Магический шар ответит на вопрос',
    async run({ message, rest, app }) {
      if (!rest.trim()) {
        await message.reply(`Спроси что-нибудь: \`${app.prefix}8ball идём сегодня в войс?\``);
        return;
      }
      await message.reply(`🎱 ${pick(EIGHT_BALL)}`);
    },
  },
  {
    name: 'poll',
    aliases: ['опрос'],
    usage: 'poll Вопрос | вариант 1 | вариант 2',
    description: 'Опрос с голосованием реакциями',
    details: ['Без вариантов — опрос «да/нет». До 10 вариантов.'],
    async run({ message, rest, app }) {
      const poll = parsePoll(rest);
      if (!poll) {
        await message.reply(`Пример: \`${app.prefix}poll Во что играем? | CS | Dota | Minecraft\` (2–10 вариантов или ни одного для «да/нет»)`);
        return;
      }
      const channel = await message.resolveChannel();
      if (!channel?.isTextBased()) return;
      const emojis = poll.options.length ? NUMBER_EMOJIS.slice(0, poll.options.length) : ['👍', '👎'];
      const lines = poll.options.map((option, i) => `${emojis[i]} ${option}`);
      const sent = await channel.send({
        content: `📊 **${poll.question}**\n${lines.join('\n')}\n\nОпрос от ${mention(message.author.id)}`.trim(),
        allowedMentions: { parse: [] },
      });
      for (const emoji of emojis) await sent.react(emoji);
    },
  },
];

import { parsePrefixCommand } from '@fluxerjs/core';
import type { Message } from '@fluxerjs/core';
import type { App } from '../app.js';
import { isAdmin, quiet } from '../util.js';
import { adminCommands } from './admin.js';
import { funCommands } from './fun.js';
import { socialCommands } from './social.js';
import { statsCommands } from './stats.js';
import type { Command } from './types.js';

const helpCommand: Command = {
  name: 'help',
  aliases: ['помощь', 'commands'],
  usage: 'help [команда]',
  description: 'Список команд',
  async run({ message, args, app }) {
    const p = app.prefix;
    const name = args[0]?.toLowerCase().replace(p, '');
    if (name) {
      const command = lookup.get(name);
      if (!command) {
        await message.reply(`Нет такой команды. Все команды: \`${p}help\``);
        return;
      }
      const aliases = command.aliases?.length ? `\nТакже: ${command.aliases.map((a) => `\`${p}${a}\``).join(', ')}` : '';
      const details = command.details?.length ? `\n\n${command.details.join('\n')}` : '';
      await message.reply({
        content: `\`${p}${command.usage}\` — ${command.description}${command.admin ? ' (админ)' : ''}${aliases}${details}`,
        ...quiet(),
      });
      return;
    }

    const section = (title: string, list: Command[]) =>
      `**${title}**\n${list.map((c) => `\`${p}${c.usage}\` — ${c.description}`).join('\n')}`;
    await message.reply({
      content: [
        section('📊 Статистика', statsCommands),
        section('🎉 Развлечения', funCommands),
        section('🤝 Общение', [...socialCommands, helpCommand]),
        section('🛠 Для админов', adminCommands),
        `Подробнее о команде: \`${p}help команда\``,
      ].join('\n\n'),
      ...quiet(),
    });
  },
};

export const commands: Command[] = [
  ...statsCommands,
  ...funCommands,
  ...socialCommands,
  ...adminCommands,
  helpCommand,
];

const lookup = new Map<string, Command>();
for (const command of commands) {
  for (const key of [command.name, ...(command.aliases ?? [])]) {
    if (lookup.has(key)) throw new Error(`Команда «${key}» объявлена дважды`);
    lookup.set(key, command);
  }
}

/** Находит и выполняет команду из сообщения. */
export async function dispatch(message: Message, app: App): Promise<void> {
  if (message.author.bot || !message.content) return;
  const parsed = parsePrefixCommand(message.content, app.prefix);
  if (!parsed) return;
  const command = lookup.get(parsed.command);
  if (!command) return;

  if (!message.guildId) {
    await message.reply('Команды работают только на сервере.');
    return;
  }
  if (command.admin && !(await isAdmin(message))) {
    await message.reply('Эта команда только для администраторов.');
    return;
  }

  // Текст после имени команды как есть, с исходными пробелами и регистром.
  const afterPrefix = message.content.trimStart().slice(app.prefix.length).trimStart();
  const rest = afterPrefix.slice(afterPrefix.split(/\s/, 1)[0]!.length).trim();

  try {
    await command.run({ message, args: parsed.args, rest, app, guildId: message.guildId });
  } catch (error) {
    console.error(`Ошибка в команде ${command.name}:`, error);
    await message.reply('Что-то пошло не так, подробности в логах бота.').catch(() => {});
  }
}

import type { Message } from '@fluxerjs/core';
import type { App } from '../app.js';

export interface CommandContext {
  message: Message;
  /** Аргументы, разбитые по пробелам. */
  args: string[];
  /** Весь текст после команды как есть — для команд со свободным текстом. */
  rest: string;
  app: App;
  /** guildId; для команд с `guildOnly` всегда есть. */
  guildId: string;
}

export interface Command {
  name: string;
  aliases?: string[];
  /** Как вызывать, без префикса: «stats [@участник]». */
  usage: string;
  description: string;
  /** Только для администраторов сервера. */
  admin?: boolean;
  /** Справка по подкомандам, выводится в `!help команда`. */
  details?: string[];
  run(ctx: CommandContext): Promise<void>;
}

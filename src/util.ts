import { PermissionFlags } from '@fluxerjs/core';
import type { Message } from '@fluxerjs/core';

/** Упоминания показываем как имена, но никого не пингуем (включая автора при ответе). */
export const quiet = () => ({ allowedMentions: { parse: [] as never[] }, ping: false });

export const mention = (userId: string) => `<@${userId}>`;

/** «1 раз», «2 раза», «5 раз» и т. п. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const formatTimes = (n: number) => `${n} ${plural(n, 'раз', 'раза', 'раз')}`;
export const formatDays = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/** Делит длинный текст на сообщения по абзацам, чтобы не упереться в лимит длины. */
export function chunkText(text: string, limit = 1900): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const block of text.split('\n\n')) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > limit && current) {
      chunks.push(current);
      current = block;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function isAdmin(message: Message): Promise<boolean> {
  const guild = await message.resolveGuild();
  if (!guild) return false;
  const member = await guild.members.resolve(message.author.id).catch(() => null);
  return !!member?.permissions.has(PermissionFlags.Administrator);
}

import { HOUR_MS } from '../time.js';
import { mention } from '../util.js';

export const LFG_EMOJI = '✅';
/** Сколько живёт незаполненный сбор. */
const LFG_TTL_MS = 6 * HOUR_MS;

export interface LfgGroup {
  messageId: string;
  channelId: string;
  game: string;
  size: number;
  authorId: string;
  /** Участники по порядку записи, автор — первый. */
  members: string[];
  createdAt: number;
  closed: boolean;
}

export type LfgChange =
  | { kind: 'joined' | 'left'; group: LfgGroup }
  | { kind: 'filled'; group: LfgGroup };

/** «CS 5», «Dota», «5 Minecraft» → игра и размер команды (по умолчанию 5). */
export function parseLfg(input: string): { game: string; size: number } | null {
  const words = input.trim().split(/\s+/).filter(Boolean);
  let size = 5;
  const sizeIndex = words.findIndex((w) => /^\d+$/.test(w));
  if (sizeIndex !== -1) {
    size = Number(words[sizeIndex]);
    words.splice(sizeIndex, 1);
  }
  if (size < 2 || size > 50) return null;
  return { game: words.join(' ') || 'катку', size };
}

/** Сборы на игру живут в памяти: после перезапуска бота старые сборы перестают обновляться. */
export class LfgManager {
  private readonly groups = new Map<string, LfgGroup>();

  constructor(private readonly now: () => number = Date.now) {}

  create(group: Omit<LfgGroup, 'members' | 'createdAt' | 'closed'>): LfgGroup {
    const created: LfgGroup = { ...group, members: [group.authorId], createdAt: this.now(), closed: false };
    this.groups.set(group.messageId, created);
    return created;
  }

  get(messageId: string): LfgGroup | undefined {
    return this.groups.get(messageId);
  }

  join(messageId: string, userId: string): LfgChange | null {
    const group = this.groups.get(messageId);
    if (!group || group.closed || group.members.includes(userId)) return null;
    group.members.push(userId);
    if (group.members.length >= group.size) {
      group.closed = true;
      return { kind: 'filled', group };
    }
    return { kind: 'joined', group };
  }

  leave(messageId: string, userId: string): LfgChange | null {
    const group = this.groups.get(messageId);
    // Автор не выходит через реакцию — он и так в составе.
    if (!group || group.closed || userId === group.authorId) return null;
    const index = group.members.indexOf(userId);
    if (index === -1) return null;
    group.members.splice(index, 1);
    return { kind: 'left', group };
  }

  /** Убирает старые и закрытые сборы. */
  cleanup(): void {
    const at = this.now();
    for (const [id, group] of this.groups) {
      if (group.closed || at - group.createdAt > LFG_TTL_MS) this.groups.delete(id);
    }
  }
}

export function formatLfg(group: LfgGroup): string {
  const header = group.closed
    ? `🎮 Сбор в **${group.game}** — состав собран!`
    : `🎮 ${mention(group.authorId)} собирает в **${group.game}**: ${group.members.length}/${group.size}, нужно ещё ${group.size - group.members.length}`;
  const list = group.members.map((id, i) => `${i + 1}. ${mention(id)}`).join('\n');
  const footer = group.closed ? '' : `\n\nЖми ${LFG_EMOJI}, чтобы вписаться (убери реакцию, чтобы выйти).`;
  return `${header}\n${list}${footer}`;
}

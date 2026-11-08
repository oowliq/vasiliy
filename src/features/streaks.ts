import type { StatsStore } from '../stats/store.js';
import { DAY_MS } from '../time.js';
import { formatDays, mention, pick } from '../util.js';
import type { Announce } from './announce.js';

/** На каких днях серии поздравляем. */
const MILESTONES = new Set([3, 7, 14, 30, 50, 100, 200, 365]);
/** Начиная с какой длины оплакиваем прерванную серию. */
const MOURN_FROM = 5;

const BROKEN_LINES = [
  'Серия {user} из {days} прервалась. Вспомним, какой она была.',
  '{user} пропустил(а) день и потерял(а) серию из {days}. Позор и пепел.',
  'Минута молчания: серия {user} ({days}) больше не с нами.',
  '{user}, серия из {days} — всё. Возвращайся в войс.',
];

export class Streaks {
  constructor(
    private readonly store: StatsStore,
    private readonly announce: Announce,
  ) {}

  /** Участник впервые за день появился в голосе. */
  onVoiceDay(guildId: string, userId: string, day: number): void {
    const streak = this.store.getStreak(guildId, userId, day);
    if (!MILESTONES.has(streak)) return;
    void this.announce(
      guildId,
      `🔥 ${mention(userId)} заходит в голос уже **${formatDays(streak)} подряд**!`,
      { ping: [userId] },
    );
  }

  /** Ежедневно: оплакиваем серии, прервавшиеся вчера. `today` — полночь МСК. */
  async reportBroken(guildId: string, today: number): Promise<void> {
    const yesterday = today - DAY_MS;
    const dayBefore = today - 2 * DAY_MS;
    for (const userId of this.store.usersWithVoiceDay(guildId, dayBefore)) {
      if (this.store.hasVoiceDay(guildId, userId, yesterday)) continue;
      const streak = this.store.getStreak(guildId, userId, dayBefore);
      if (streak < MOURN_FROM) continue;
      const text = pick(BROKEN_LINES)
        .replace('{user}', mention(userId))
        .replace('{days}', formatDays(streak));
      await this.announce(guildId, `💔 ${text}`);
    }
  }
}

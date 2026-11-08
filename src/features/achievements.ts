import type { Counters, StatsStore } from '../stats/store.js';
import { HOUR_MS, dayStart, formatMskDate, mskParts } from '../time.js';
import { mention } from '../util.js';
import type { Announce } from './announce.js';

export interface AchievementProgress {
  total: Counters;
  /** Лучшая серия дней в голосе. */
  bestStreak: number;
  /** Максимум совместного времени с одним человеком. */
  bestPairMs: number;
}

export interface Achievement {
  id: string;
  emoji: string;
  title: string;
  description: string;
  /** Нет `check` — ачивка выдаётся событием (например, первым зашёл в понедельник). */
  check?: (p: AchievementProgress) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'voice_10h', emoji: '🎙', title: 'Завсегдатай', description: '10 часов в голосовых', check: (p) => p.total.voice_ms >= 10 * HOUR_MS },
  { id: 'voice_100h', emoji: '🏠', title: 'Живёт в войсе', description: '100 часов в голосовых', check: (p) => p.total.voice_ms >= 100 * HOUR_MS },
  { id: 'voice_500h', emoji: '🏰', title: 'Прописка', description: '500 часов в голосовых', check: (p) => p.total.voice_ms >= 500 * HOUR_MS },
  { id: 'afk_10', emoji: '💤', title: 'Сонный', description: '10 попаданий в AFK', check: (p) => p.total.afk_moves >= 10 },
  { id: 'afk_50', emoji: '🛌', title: 'Профессиональный AFK-ер', description: '50 попаданий в AFK', check: (p) => p.total.afk_moves >= 50 },
  { id: 'msg_1000', emoji: '💬', title: 'Болтун', description: '1000 сообщений', check: (p) => p.total.messages >= 1000 },
  { id: 'msg_10000', emoji: '📜', title: 'Графоман', description: '10 000 сообщений', check: (p) => p.total.messages >= 10_000 },
  { id: 'stream_24h', emoji: '📺', title: 'Стример', description: 'Сутки стримов', check: (p) => p.total.stream_ms >= 24 * HOUR_MS },
  { id: 'video_10h', emoji: '📷', title: 'Звезда камеры', description: '10 часов с камерой', check: (p) => p.total.video_ms >= 10 * HOUR_MS },
  { id: 'night_24h', emoji: '🦉', title: 'Полуночник', description: 'Сутки в голосе ночью (00–06 МСК)', check: (p) => p.total.night_ms >= 24 * HOUR_MS },
  { id: 'selfmute_24h', emoji: '🤐', title: 'Молчаливый слушатель', description: 'Сутки в самомьюте', check: (p) => p.total.self_mute_ms >= 24 * HOUR_MS },
  { id: 'servermute_10h', emoji: '🔇', title: 'Наказанный', description: '10 часов в серверном мьюте', check: (p) => p.total.server_mute_ms >= 10 * HOUR_MS },
  { id: 'streak_7', emoji: '🔥', title: 'Неделя без пропусков', description: '7 дней подряд в голосе', check: (p) => p.bestStreak >= 7 },
  { id: 'streak_30', emoji: '☄️', title: 'Месяц в строю', description: '30 дней подряд в голосе', check: (p) => p.bestStreak >= 30 },
  { id: 'duo_24h', emoji: '👯', title: 'Неразлучные', description: 'Сутки в одном канале с одним и тем же человеком', check: (p) => p.bestPairMs >= 24 * HOUR_MS },
  { id: 'monday_first', emoji: '🐓', title: 'Ранняя пташка', description: 'Первый в голосе в понедельник' },
];

const byId = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export class Achievements {
  constructor(
    private readonly store: StatsStore,
    private readonly announce: Announce,
    private readonly now: () => number = Date.now,
  ) {}

  /** Проверяет пороговые ачивки и объявляет новые. */
  check(guildId: string, userId: string): Achievement[] {
    const progress: AchievementProgress = {
      total: this.store.getTotal(guildId, userId),
      bestStreak: this.store.getBestStreak(guildId, userId),
      bestPairMs: this.store.getBestPartner(guildId, userId, null)?.ms ?? 0,
    };
    const earned = ACHIEVEMENTS.filter(
      (a) => a.check?.(progress) && this.store.award(guildId, userId, a.id, this.now()),
    );
    for (const a of earned) this.congratulate(guildId, userId, a);
    return earned;
  }

  /** Вызывается при входе в голос: «Ранняя пташка» — первый зашедший в понедельник. */
  onJoin(guildId: string, userId: string, at: number): void {
    if (mskParts(at).weekday !== 1) return;
    if (!this.store.claimFirstJoin(guildId, dayStart(at), userId)) return;
    if (this.store.award(guildId, userId, 'monday_first', at)) {
      this.congratulate(guildId, userId, byId.get('monday_first')!);
    }
  }

  list(guildId: string, userId: string): string {
    const earned = this.store.getAchievements(guildId, userId);
    const have = new Set(earned.map((e) => e.id));
    const lines = earned.map((e) => {
      const a = byId.get(e.id);
      return a ? `${a.emoji} **${a.title}** — ${a.description} (${formatMskDate(e.earnedAt)})` : null;
    });
    const locked = ACHIEVEMENTS.filter((a) => !have.has(a.id)).map((a) => `🔒 ${a.title} — ${a.description}`);
    return [
      `🏆 Ачивки ${mention(userId)}: ${earned.length} из ${ACHIEVEMENTS.length}`,
      lines.filter(Boolean).join('\n'),
      locked.length ? `**Ещё не открыто**\n${locked.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private congratulate(guildId: string, userId: string, a: Achievement): void {
    void this.announce(
      guildId,
      `🏆 ${mention(userId)} получает ачивку ${a.emoji} **${a.title}** — ${a.description.toLowerCase()}!`,
      { ping: [userId] },
    );
  }
}

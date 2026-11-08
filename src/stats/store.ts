import { ensureColumns, type Db, type Row } from '../db.js';
import { DAY_MS } from '../time.js';

/** Счётчики пользователя за неделю. Время — в миллисекундах. */
export interface Counters {
  /** Время в голосовых каналах, кроме AFK. */
  voice_ms: number;
  /** Время в AFK-канале. */
  afk_ms: number;
  /** Сколько раз попадал в AFK-канал. */
  afk_moves: number;
  /** Время в серверном мьюте/заглушке (выдал модератор). */
  server_mute_ms: number;
  /** Время в самомьюте/самозаглушке. */
  self_mute_ms: number;
  /** Время стрима экрана. */
  stream_ms: number;
  /** Время с включённой камерой. */
  video_ms: number;
  /** Время в голосе ночью (00:00–06:00 МСК). */
  night_ms: number;
  /** Отправленные сообщения. */
  messages: number;
}

export type Metric = keyof Counters;

export const METRICS: readonly Metric[] = [
  'voice_ms',
  'afk_ms',
  'afk_moves',
  'server_mute_ms',
  'self_mute_ms',
  'stream_ms',
  'video_ms',
  'night_ms',
  'messages',
];

export const emptyCounters = (): Counters =>
  Object.fromEntries(METRICS.map((m) => [m, 0])) as unknown as Counters;

export interface UserCounters {
  userId: string;
  counters: Counters;
}

export interface Pair {
  userA: string;
  userB: string;
  ms: number;
}

function toCounters(row: Row | undefined): Counters {
  const counters = emptyCounters();
  if (row) for (const m of METRICS) counters[m] = Number(row[m] ?? 0);
  return counters;
}

export class StatsStore {
  constructor(private readonly db: Db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS weekly_stats (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        week_start INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id, week_start)
      );
      CREATE TABLE IF NOT EXISTS voice_days (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id, day)
      );
      CREATE TABLE IF NOT EXISTS voice_pairs (
        guild_id TEXT NOT NULL,
        week_start INTEGER NOT NULL,
        user_a TEXT NOT NULL,
        user_b TEXT NOT NULL,
        ms INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, week_start, user_a, user_b)
      );
      CREATE TABLE IF NOT EXISTS achievements (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        achievement TEXT NOT NULL,
        earned_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id, achievement)
      );
      CREATE TABLE IF NOT EXISTS first_joins (
        guild_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, day)
      );
    `);
    ensureColumns(
      db,
      'weekly_stats',
      Object.fromEntries(METRICS.map((m) => [m, 'INTEGER NOT NULL DEFAULT 0'])),
    );
  }

  // ── Недельные счётчики ────────────────────────────────────────────

  /** Прибавляет значения к счётчикам пользователя за неделю. */
  add(guildId: string, userId: string, week: number, delta: Partial<Counters>): void {
    const metrics = METRICS.filter((m) => delta[m]);
    if (metrics.length === 0) return;
    this.db
      .prepare(
        `INSERT INTO weekly_stats (guild_id, user_id, week_start, ${metrics.join(', ')})
         VALUES (?, ?, ?, ${metrics.map(() => '?').join(', ')})
         ON CONFLICT (guild_id, user_id, week_start) DO UPDATE SET
         ${metrics.map((m) => `${m} = ${m} + excluded.${m}`).join(', ')}`,
      )
      .run(guildId, userId, week, ...metrics.map((m) => delta[m]!));
  }

  getWeek(guildId: string, userId: string, week: number): Counters {
    const row = this.db
      .prepare('SELECT * FROM weekly_stats WHERE guild_id = ? AND user_id = ? AND week_start = ?')
      .get(guildId, userId, week);
    return toCounters(row as Row | undefined);
  }

  getTotal(guildId: string, userId: string): Counters {
    const row = this.db
      .prepare(
        `SELECT ${METRICS.map((m) => `SUM(${m}) AS ${m}`).join(', ')}
         FROM weekly_stats WHERE guild_id = ? AND user_id = ?`,
      )
      .get(guildId, userId);
    return toCounters(row as Row | undefined);
  }

  getTop(guildId: string, week: number, metric: Metric, limit: number): UserCounters[] {
    if (!METRICS.includes(metric)) throw new Error(`Неизвестная метрика: ${metric}`);
    const rows = this.db
      .prepare(
        `SELECT * FROM weekly_stats
         WHERE guild_id = ? AND week_start = ? AND ${metric} > 0
         ORDER BY ${metric} DESC LIMIT ?`,
      )
      .all(guildId, week, limit) as Row[];
    return rows.map((row) => ({ userId: String(row.user_id), counters: toCounters(row) }));
  }

  /** Все участники с хоть какой-то активностью за неделю. */
  getWeekAll(guildId: string, week: number): UserCounters[] {
    const rows = this.db
      .prepare('SELECT * FROM weekly_stats WHERE guild_id = ? AND week_start = ?')
      .all(guildId, week) as Row[];
    return rows.map((row) => ({ userId: String(row.user_id), counters: toCounters(row) }));
  }

  // ── Дни в голосе (серии) ──────────────────────────────────────────

  /** Отмечает, что участник был в голосе в этот день. true — если отметка новая. */
  markVoiceDay(guildId: string, userId: string, day: number): boolean {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO voice_days (guild_id, user_id, day) VALUES (?, ?, ?)')
      .run(guildId, userId, day);
    return Number(result.changes) > 0;
  }

  hasVoiceDay(guildId: string, userId: string, day: number): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM voice_days WHERE guild_id = ? AND user_id = ? AND day = ?')
      .get(guildId, userId, day);
  }

  usersWithVoiceDay(guildId: string, day: number): string[] {
    const rows = this.db
      .prepare('SELECT user_id FROM voice_days WHERE guild_id = ? AND day = ?')
      .all(guildId, day) as Row[];
    return rows.map((r) => String(r.user_id));
  }

  /** Сколько дней подряд участник был в голосе, заканчивая днём `day` включительно. */
  getStreak(guildId: string, userId: string, day: number): number {
    const rows = this.db
      .prepare(
        `SELECT day FROM voice_days WHERE guild_id = ? AND user_id = ? AND day <= ?
         ORDER BY day DESC LIMIT 1000`,
      )
      .all(guildId, userId, day) as Row[];
    let streak = 0;
    let expected = day;
    for (const row of rows) {
      if (Number(row.day) !== expected) break;
      streak++;
      expected -= DAY_MS;
    }
    return streak;
  }

  /** Самая длинная серия за всё время. */
  getBestStreak(guildId: string, userId: string): number {
    const rows = this.db
      .prepare('SELECT day FROM voice_days WHERE guild_id = ? AND user_id = ? ORDER BY day')
      .all(guildId, userId) as Row[];
    let best = 0;
    let current = 0;
    let previous = -Infinity;
    for (const row of rows) {
      const day = Number(row.day);
      current = day - previous === DAY_MS ? current + 1 : 1;
      best = Math.max(best, current);
      previous = day;
    }
    return best;
  }

  // ── Пары (дуэты) ──────────────────────────────────────────────────

  addPair(guildId: string, week: number, a: string, b: string, ms: number): void {
    if (ms <= 0 || a === b) return;
    const [userA, userB] = a < b ? [a, b] : [b, a];
    this.db
      .prepare(
        `INSERT INTO voice_pairs (guild_id, week_start, user_a, user_b, ms) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, week_start, user_a, user_b) DO UPDATE SET ms = ms + excluded.ms`,
      )
      .run(guildId, week, userA, userB, ms);
  }

  getTopPairs(guildId: string, week: number, limit: number): Pair[] {
    const rows = this.db
      .prepare(
        `SELECT user_a, user_b, ms FROM voice_pairs
         WHERE guild_id = ? AND week_start = ? ORDER BY ms DESC LIMIT ?`,
      )
      .all(guildId, week, limit) as Row[];
    return rows.map((r) => ({ userA: String(r.user_a), userB: String(r.user_b), ms: Number(r.ms) }));
  }

  /** С кем участник больше всего сидел вместе: за неделю или (week = null) за всё время. */
  getBestPartner(
    guildId: string,
    userId: string,
    week: number | null,
  ): { userId: string; ms: number } | null {
    const row = this.db
      .prepare(
        `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS partner, SUM(ms) AS total
         FROM voice_pairs
         WHERE guild_id = ? AND (user_a = ? OR user_b = ?) AND (? IS NULL OR week_start = ?)
         GROUP BY partner ORDER BY total DESC LIMIT 1`,
      )
      .get(userId, guildId, userId, userId, week, week) as Row | undefined;
    return row ? { userId: String(row.partner), ms: Number(row.total) } : null;
  }

  // ── Ачивки ────────────────────────────────────────────────────────

  /** Выдаёт ачивку. true — если её ещё не было. */
  award(guildId: string, userId: string, achievement: string, at: number): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO achievements (guild_id, user_id, achievement, earned_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(guildId, userId, achievement, at);
    return Number(result.changes) > 0;
  }

  getAchievements(guildId: string, userId: string): { id: string; earnedAt: number }[] {
    const rows = this.db
      .prepare(
        `SELECT achievement, earned_at FROM achievements
         WHERE guild_id = ? AND user_id = ? ORDER BY earned_at`,
      )
      .all(guildId, userId) as Row[];
    return rows.map((r) => ({ id: String(r.achievement), earnedAt: Number(r.earned_at) }));
  }

  /** Фиксирует первого зашедшего в голос за день. true — если это он. */
  claimFirstJoin(guildId: string, day: number, userId: string): boolean {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO first_joins (guild_id, day, user_id) VALUES (?, ?, ?)')
      .run(guildId, day, userId);
    return Number(result.changes) > 0;
  }
}

import type { Db, Row } from '../db.js';
import { mskParts } from '../time.js';

export interface Birthday {
  userId: string;
  day: number;
  month: number;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «15.03», «15.3», «15/03» → { day, month }; null — если даты не бывает. */
export function parseBirthday(input: string): { day: number; month: number } | null {
  const match = /^(\d{1,2})[./-](\d{1,2})$/.exec(input.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]!) return null;
  return { day, month };
}

export const formatBirthday = (b: { day: number; month: number }) =>
  `${b.day} ${MONTHS_GENITIVE[b.month - 1]}`;

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Отмечается ли этот день рождения в дату `at` (29.02 в невисокосный год — 28.02). */
export function isBirthdayOn(b: { day: number; month: number }, at: number): boolean {
  const today = mskParts(at);
  if (b.day === 29 && b.month === 2 && !isLeap(today.year)) {
    return today.day === 28 && today.month === 2;
  }
  return b.day === today.day && b.month === today.month;
}

/** Через сколько дней ближайший день рождения (0 — сегодня). */
export function daysUntil(b: { day: number; month: number }, at: number): number {
  const today = mskParts(at);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  for (const year of [today.year, today.year + 1, today.year + 2, today.year + 3, today.year + 4]) {
    const day = b.day === 29 && b.month === 2 && !isLeap(year) ? 28 : b.day;
    const next = Date.UTC(year, b.month - 1, day);
    if (next >= todayUtc) return Math.round((next - todayUtc) / 86_400_000);
  }
  return 366;
}

export class BirthdayStore {
  constructor(private readonly db: Db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS birthdays (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        month INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
    `);
  }

  set(guildId: string, userId: string, day: number, month: number): void {
    this.db
      .prepare(
        `INSERT INTO birthdays (guild_id, user_id, day, month) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET day = excluded.day, month = excluded.month`,
      )
      .run(guildId, userId, day, month);
  }

  remove(guildId: string, userId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?')
      .run(guildId, userId);
    return Number(result.changes) > 0;
  }

  get(guildId: string, userId: string): Birthday | null {
    const row = this.db
      .prepare('SELECT * FROM birthdays WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as Row | undefined;
    return row ? { userId, day: Number(row.day), month: Number(row.month) } : null;
  }

  list(guildId: string): Birthday[] {
    const rows = this.db.prepare('SELECT * FROM birthdays WHERE guild_id = ?').all(guildId) as Row[];
    return rows.map((r) => ({ userId: String(r.user_id), day: Number(r.day), month: Number(r.month) }));
  }

  /** Ближайшие дни рождения, начиная с сегодняшнего. */
  upcoming(guildId: string, at: number, limit: number): (Birthday & { inDays: number })[] {
    return this.list(guildId)
      .map((b) => ({ ...b, inDays: daysUntil(b, at) }))
      .sort((a, b) => a.inDays - b.inDays)
      .slice(0, limit);
  }

  today(guildId: string, at: number): Birthday[] {
    return this.list(guildId).filter((b) => isBirthdayOn(b, at));
  }
}

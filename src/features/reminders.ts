import type { Db, Row } from '../db.js';

export interface Reminder {
  id: number;
  guildId: string | null;
  channelId: string;
  userId: string;
  text: string;
  dueAt: number;
}

const toReminder = (r: Row): Reminder => ({
  id: Number(r.id),
  guildId: r.guild_id == null ? null : String(r.guild_id),
  channelId: String(r.channel_id),
  userId: String(r.user_id),
  text: String(r.text),
  dueAt: Number(r.due_at),
});

/** Сколько активных напоминаний может быть у одного человека. */
export const MAX_REMINDERS_PER_USER = 25;

export class ReminderStore {
  constructor(private readonly db: Db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        text TEXT NOT NULL,
        due_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reminders_due ON reminders (due_at);
    `);
  }

  add(r: Omit<Reminder, 'id'>): Reminder {
    const result = this.db
      .prepare('INSERT INTO reminders (guild_id, channel_id, user_id, text, due_at) VALUES (?, ?, ?, ?, ?)')
      .run(r.guildId, r.channelId, r.userId, r.text, r.dueAt);
    return { ...r, id: Number(result.lastInsertRowid) };
  }

  /** Напоминания, время которых пришло. */
  due(at: number): Reminder[] {
    const rows = this.db.prepare('SELECT * FROM reminders WHERE due_at <= ? ORDER BY due_at').all(at) as Row[];
    return rows.map(toReminder);
  }

  listForUser(userId: string): Reminder[] {
    const rows = this.db
      .prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY due_at')
      .all(userId) as Row[];
    return rows.map(toReminder);
  }

  /** Удаляет напоминание; `userId` — чтобы нельзя было удалить чужое. */
  remove(id: number, userId?: string): boolean {
    const result = this.db
      .prepare('DELETE FROM reminders WHERE id = ? AND (? IS NULL OR user_id = ?)')
      .run(id, userId ?? null, userId ?? null);
    return Number(result.changes) > 0;
  }
}

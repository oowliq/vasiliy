import type { Db, Row } from '../db.js';
import { formatMskDate } from '../time.js';
import { mention } from '../util.js';

export interface Quote {
  id: number;
  guildId: string;
  authorId: string;
  content: string;
  savedBy: string;
  messageId: string;
  createdAt: number;
}

const toQuote = (r: Row): Quote => ({
  id: Number(r.id),
  guildId: String(r.guild_id),
  authorId: String(r.author_id),
  content: String(r.content),
  savedBy: String(r.saved_by),
  messageId: String(r.message_id),
  createdAt: Number(r.created_at),
});

export class QuoteStore {
  constructor(private readonly db: Db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        saved_by TEXT NOT NULL,
        message_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (guild_id, message_id)
      );
    `);
  }

  /** Сохраняет цитату. Если это сообщение уже в цитатнике — возвращает существующую. */
  add(q: Omit<Quote, 'id'>): { quote: Quote; created: boolean } {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO quotes (guild_id, author_id, content, saved_by, message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(q.guildId, q.authorId, q.content, q.savedBy, q.messageId, q.createdAt);
    const row = this.db
      .prepare('SELECT * FROM quotes WHERE guild_id = ? AND message_id = ?')
      .get(q.guildId, q.messageId) as Row;
    return { quote: toQuote(row), created: Number(result.changes) > 0 };
  }

  random(guildId: string, authorId?: string): Quote | null {
    const row = this.db
      .prepare(
        `SELECT * FROM quotes WHERE guild_id = ? AND (? IS NULL OR author_id = ?)
         ORDER BY RANDOM() LIMIT 1`,
      )
      .get(guildId, authorId ?? null, authorId ?? null) as Row | undefined;
    return row ? toQuote(row) : null;
  }

  get(guildId: string, id: number): Quote | null {
    const row = this.db.prepare('SELECT * FROM quotes WHERE guild_id = ? AND id = ?').get(guildId, id) as
      | Row
      | undefined;
    return row ? toQuote(row) : null;
  }

  remove(guildId: string, id: number): boolean {
    const result = this.db.prepare('DELETE FROM quotes WHERE guild_id = ? AND id = ?').run(guildId, id);
    return Number(result.changes) > 0;
  }

  count(guildId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM quotes WHERE guild_id = ?').get(guildId) as Row;
    return Number(row.n);
  }
}

export function formatQuote(q: Quote): string {
  const body = q.content
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${body}\n— ${mention(q.authorId)}, ${formatMskDate(q.createdAt)} · цитата #${q.id}`;
}

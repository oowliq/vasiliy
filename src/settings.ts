import { ensureColumns, type Db, type Row } from './db.js';

export interface GuildSettings {
  guildId: string;
  /** Канал для объявлений бота: итоги недели, серии, ачивки, дни рождения. */
  announceChannelId: string | null;
  /** Последняя неделя, итоги которой уже опубликованы. */
  lastReportedWeek: number | null;
  /** Роль, которую получает MVP недели. */
  weeklyRoleId: string | null;
  defaultRoleId: string | null;
  lastAwardedWeek: number | null;
  pendingWeek: number | null;
  pendingWinnerId: string | null;
  /** Кто сейчас носит роль MVP. */
  weeklyUserId: string | null;
  /** День (полночь МСК), за который уже прошли ежедневные задачи. */
  lastDailyDay: number | null;
  welcomeEnabled: boolean;
}

const COLUMNS = {
  announceChannelId: 'report_channel_id',
  lastReportedWeek: 'last_reported_week',
  weeklyRoleId: 'mvp_role_id',
  defaultRoleId: 'default_role_id',
  lastAwardedWeek: 'last_awarded_week',
  pendingWeek: 'pending_week',
  pendingWinnerId: 'pending_winner_id',
  weeklyUserId: 'mvp_user_id',
  lastDailyDay: 'last_daily_day',
  welcomeEnabled: 'welcome_enabled',
} as const satisfies Record<Exclude<keyof GuildSettings, 'guildId'>, string>;

type Patch = Partial<Omit<GuildSettings, 'guildId'>>;

export class SettingsStore {
  constructor(private readonly db: Db) {
    db.exec(`CREATE TABLE IF NOT EXISTS guild_settings (guild_id TEXT PRIMARY KEY)`);
    ensureColumns(db, 'guild_settings', {
      report_channel_id: 'TEXT',
      last_reported_week: 'INTEGER',
      mvp_role_id: 'TEXT',
      default_role_id: 'TEXT',
      last_awarded_week: 'INTEGER',
      pending_week: 'INTEGER',
      pending_winner_id: 'TEXT',
      mvp_user_id: 'TEXT',
      last_daily_day: 'INTEGER',
      welcome_enabled: 'INTEGER NOT NULL DEFAULT 1',
    });
  }

  get(guildId: string): GuildSettings {
    const row = this.db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId) as
      | Row
      | undefined;
    const str = (v: unknown) => (v == null ? null : String(v));
    const num = (v: unknown) => (v == null ? null : Number(v));
    return {
      guildId,
      announceChannelId: str(row?.report_channel_id),
      lastReportedWeek: num(row?.last_reported_week),
      weeklyRoleId: str(row?.mvp_role_id),
      defaultRoleId: str(row?.default_role_id),
      lastAwardedWeek: num(row?.last_awarded_week),
      pendingWeek: num(row?.pending_week),
      pendingWinnerId: str(row?.pending_winner_id),
      weeklyUserId: str(row?.mvp_user_id),
      lastDailyDay: num(row?.last_daily_day),
      welcomeEnabled: row ? Number(row.welcome_enabled) !== 0 : true,
    };
  }

  update(guildId: string, patch: Patch): void {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [
      keyof Patch,
      unknown,
    ][];
    if (entries.length === 0) return;
    const columns = entries.map(([k]) => COLUMNS[k]);
    const values = entries.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v)) as (
      | string
      | number
      | null
    )[];
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, ${columns.join(', ')})
         VALUES (?, ${columns.map(() => '?').join(', ')})
         ON CONFLICT (guild_id) DO UPDATE SET ${columns.map((c) => `${c} = excluded.${c}`).join(', ')}`,
      )
      .run(guildId, ...values);
  }

  /** Гильдии с объявлениями или настроенным конкурсом. */
  withWeeklyTasks(): GuildSettings[] {
    const rows = this.db.prepare(`SELECT guild_id FROM guild_settings
      WHERE report_channel_id IS NOT NULL OR (default_role_id IS NOT NULL AND mvp_role_id IS NOT NULL)`)
      .all() as Row[];
    return rows.map((r) => this.get(String(r.guild_id)));
  }

  /** Гильдии, где настроен канал объявлений. */
  withAnnounceChannel(): GuildSettings[] {
    const rows = this.db
      .prepare('SELECT guild_id FROM guild_settings WHERE report_channel_id IS NOT NULL')
      .all() as Row[];
    return rows.map((r) => this.get(String(r.guild_id)));
  }
}

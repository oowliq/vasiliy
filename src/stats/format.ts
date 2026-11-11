import { HOUR_MS, WEEK_MS, formatDuration, formatMsk } from '../time.js';
import { formatTimes, mention } from '../util.js';
import type { Counters, Metric, StatsStore, UserCounters } from './store.js';

const TOP_SIZE = 5;
/** «Молчун недели» — только если человек провёл в голосе хотя бы столько. */
const SILENT_MIN_VOICE_MS = 2 * HOUR_MS;

interface Section {
  title: string;
  metric: Metric;
  value: (c: Counters) => string;
}

const SECTIONS: Section[] = [
  { title: '🎙 Больше всех в голосовых', metric: 'voice_ms', value: (c) => formatDuration(c.voice_ms) },
  {
    title: '💤 Чаще всех улетали в AFK',
    metric: 'afk_moves',
    value: (c) => `${formatTimes(c.afk_moves)} (всего ${formatDuration(c.afk_ms)})`,
  },
  { title: '🔇 Дольше всех в серверном мьюте', metric: 'server_mute_ms', value: (c) => formatDuration(c.server_mute_ms) },
  { title: '🙊 Дольше всех в самомьюте', metric: 'self_mute_ms', value: (c) => formatDuration(c.self_mute_ms) },
  { title: '📺 Больше всех стримили', metric: 'stream_ms', value: (c) => formatDuration(c.stream_ms) },
  { title: '📷 Больше всех с камерой', metric: 'video_ms', value: (c) => formatDuration(c.video_ms) },
  { title: '🦉 Больше всех ночью', metric: 'night_ms', value: (c) => formatDuration(c.night_ms) },
  { title: '💬 Больше всех писали', metric: 'messages', value: (c) => `${c.messages} сообщ.` },
];

const period = (week: number) => `${formatMsk(week)} — ${formatMsk(week + WEEK_MS)} МСК`;

function topBlocks(store: StatsStore, guildId: string, week: number): string[] {
  const blocks: string[] = [];
  for (const section of SECTIONS) {
    const top = store.getTop(guildId, week, section.metric, TOP_SIZE);
    if (top.length === 0) continue;
    const lines = top.map((e, i) => `${i + 1}. ${mention(e.userId)} — ${section.value(e.counters)}`);
    blocks.push(`**${section.title}**\n${lines.join('\n')}`);
  }
  const pairs = store.getTopPairs(guildId, week, 3);
  if (pairs.length) {
    const lines = pairs.map(
      (p, i) => `${i + 1}. ${mention(p.userA)} + ${mention(p.userB)} — ${formatDuration(p.ms)}`,
    );
    blocks.push(`**👯 Чаще всех сидели вместе**\n${lines.join('\n')}`);
  }
  return blocks;
}

/** Топ текущей недели (промежуточный). */
export function formatTop(store: StatsStore, guildId: string, week: number): string {
  const header = `📊 **Топ текущей недели** (${period(week)}, итоги в понедельник в 09:00 МСК)`;
  const blocks = topBlocks(store, guildId, week);
  if (blocks.length === 0) return `${header}\n\nЗа эту неделю пока ничего не набралось.`;
  return `${header}\n\n${blocks.join('\n\n')}`;
}

export interface Nominations {
  text: string;
  /** Победитель по времени в голосе — получает роль MVP. */
  mvpUserId: string | null;
}

const maxBy = (rows: UserCounters[], score: (c: Counters) => number) => {
  let best: UserCounters | null = null;
  for (const row of rows) {
    if (score(row.counters) > 0 && (!best || score(row.counters) > score(best.counters))) best = row;
  }
  return best;
};

/** Шуточные номинации недели. */
export function nominate(store: StatsStore, guildId: string, week: number, winnerId?: string | null): Nominations {
  const rows = store.getWeekAll(guildId, week);
  const lines: string[] = [];
  const add = (row: UserCounters | null, title: string, detail: (c: Counters) => string) => {
    if (row) lines.push(`${title} — ${mention(row.userId)} (${detail(row.counters)})`);
  };

  const mvp = winnerId === undefined ? maxBy(rows, (c) => c.voice_ms) : rows.find((r) => r.userId === winnerId) ?? null;
  add(mvp, '👑 **MVP недели**', (c) => `${formatDuration(c.voice_ms)} в голосе`);
  add(maxBy(rows, (c) => c.afk_moves), '💤 **Король AFK**', (c) => formatTimes(c.afk_moves));
  add(
    maxBy(
      rows.filter((r) => r.counters.voice_ms >= SILENT_MIN_VOICE_MS),
      (c) => c.self_mute_ms / c.voice_ms,
    ),
    '🤐 **Молчун недели**',
    (c) => `${Math.round((c.self_mute_ms / c.voice_ms) * 100)}% времени в мьюте`,
  );
  add(maxBy(rows, (c) => c.night_ms), '🦉 **Полуночник**', (c) => `${formatDuration(c.night_ms)} ночью`);
  add(maxBy(rows, (c) => c.stream_ms), '📺 **Стример недели**', (c) => formatDuration(c.stream_ms));
  add(maxBy(rows, (c) => c.video_ms), '📷 **Звезда камеры**', (c) => formatDuration(c.video_ms));
  add(maxBy(rows, (c) => c.messages), '💬 **Болтун недели**', (c) => `${c.messages} сообщ.`);

  const [duo] = store.getTopPairs(guildId, week, 1);
  if (duo) {
    lines.push(
      `👯 **Дуэт недели** — ${mention(duo.userA)} и ${mention(duo.userB)} (${formatDuration(duo.ms)} вместе)`,
    );
  }

  return { text: lines.join('\n'), mvpUserId: mvp?.userId ?? null };
}

/** Итоговый отчёт по завершённой неделе: номинации + топы. */
export function formatWeeklyReport(store: StatsStore, guildId: string, week: number, winnerId?: string | null): Nominations {
  const nominations = nominate(store, guildId, week, winnerId);
  const header = `📊 **Итоги недели** (${period(week)})${winnerId === null ? '\n\nВ конкурсе на weekly_role нет победителя.' : ''}`;
  if (!nominations.text) {
    return { text: `${header}\n\nНа этой неделе было тихо. Подозрительно тихо.`, mvpUserId: null };
  }
  const blocks = topBlocks(store, guildId, week);
  return {
    text: [header, `**🏅 Номинации**\n${nominations.text}`, ...blocks].join('\n\n'),
    mvpUserId: nominations.mvpUserId,
  };
}

function statLines(c: Counters): string[] {
  return [
    `🎙 В голосовых: ${formatDuration(c.voice_ms)}`,
    `💤 В AFK: ${formatTimes(c.afk_moves)}, всего ${formatDuration(c.afk_ms)}`,
    `🔇 Серверный мьют: ${formatDuration(c.server_mute_ms)}`,
    `🙊 Самомьют: ${formatDuration(c.self_mute_ms)}`,
    `📺 Стримы: ${formatDuration(c.stream_ms)}`,
    `📷 Камера: ${formatDuration(c.video_ms)}`,
    `🦉 Ночью: ${formatDuration(c.night_ms)}`,
    `💬 Сообщения: ${c.messages}`,
  ];
}

export interface UserExtras {
  streak: number;
  bestStreak: number;
  partnerWeek: { userId: string; ms: number } | null;
  partnerTotal: { userId: string; ms: number } | null;
}

/** Личная статистика: за текущую неделю и за всё время. */
export function formatUser(userId: string, week: Counters, total: Counters, extras: UserExtras): string {
  const partner = (p: UserExtras['partnerWeek']) =>
    p ? `👯 Чаще всего с ${mention(p.userId)} (${formatDuration(p.ms)})` : null;
  const weekLines = [...statLines(week), partner(extras.partnerWeek)].filter(Boolean);
  const totalLines = [
    ...statLines(total),
    partner(extras.partnerTotal),
    `🔥 Серия: ${extras.streak} дн. подряд (рекорд — ${extras.bestStreak})`,
  ].filter(Boolean);
  return `📊 Статистика ${mention(userId)}\n\n**Эта неделя**\n${weekLines.join('\n')}\n\n**За всё время**\n${totalLines.join('\n')}`;
}

/** Сравнение двух участников за всё время. */
export function formatCompare(a: string, ca: Counters, b: string, cb: Counters): string {
  const rows: [string, number, number, (n: number) => string][] = [
    ['🎙 Голос', ca.voice_ms, cb.voice_ms, formatDuration],
    ['💤 AFK', ca.afk_moves, cb.afk_moves, formatTimes],
    ['🔇 Серверный мьют', ca.server_mute_ms, cb.server_mute_ms, formatDuration],
    ['🙊 Самомьют', ca.self_mute_ms, cb.self_mute_ms, formatDuration],
    ['📺 Стримы', ca.stream_ms, cb.stream_ms, formatDuration],
    ['📷 Камера', ca.video_ms, cb.video_ms, formatDuration],
    ['🦉 Ночью', ca.night_ms, cb.night_ms, formatDuration],
    ['💬 Сообщения', ca.messages, cb.messages, String],
  ];
  let scoreA = 0;
  let scoreB = 0;
  const lines = rows.map(([title, va, vb, fmt]) => {
    if (va > vb) scoreA++;
    if (vb > va) scoreB++;
    const left = va > vb ? `**${fmt(va)}**` : fmt(va);
    const right = vb > va ? `**${fmt(vb)}**` : fmt(vb);
    return `${title}: ${left} vs ${right}`;
  });
  return `⚔️ ${mention(a)} vs ${mention(b)} (за всё время)\n\n${lines.join('\n')}\n\nСчёт по категориям: ${scoreA}:${scoreB}`;
}

/**
 * Работа со временем по МСК. МСК — фиксированный UTC+3 без перехода на летнее время,
 * поэтому все границы считаем арифметикой над UTC-миллисекундами.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

const MSK_OFFSET_MS = 3 * HOUR_MS;

/** Ночь для «Полуночника»: 00:00–06:00 МСК. */
const NIGHT_END_HOUR_MSK = 6;

/** 5 января 1970, понедельник 00:00 МСК. */
const WEEK_ANCHOR_MS = 4 * DAY_MS - MSK_OFFSET_MS;

/** Начало календарной недели по МСК (понедельник 00:00). */
export function weekStart(at: number): number {
  return WEEK_ANCHOR_MS + Math.floor((at - WEEK_ANCHOR_MS) / WEEK_MS) * WEEK_MS;
}

/** Последняя неделя, для которой наступил срок объявления: понедельник 09:00 МСК. */
export function reportWeek(at: number): number {
  return weekStart(at - 9 * HOUR_MS) - WEEK_MS;
}

/** Полночь по МСК дня, в который попадает `at`. */
export function dayStart(at: number): number {
  return Math.floor((at + MSK_OFFSET_MS) / DAY_MS) * DAY_MS - MSK_OFFSET_MS;
}

export interface MskParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0 — воскресенье, 1 — понедельник, … */
  weekday: number;
  hour: number;
  minute: number;
}

export function mskParts(at: number): MskParts {
  const d = new Date(at + MSK_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** Сколько миллисекунд интервала [from, to) пришлось на ночь (00:00–06:00 МСК). */
export function nightOverlap(from: number, to: number): number {
  let total = 0;
  for (let day = dayStart(from); day < to; day += DAY_MS) {
    const nightEnd = day + NIGHT_END_HOUR_MSK * HOUR_MS;
    total += Math.max(0, Math.min(to, nightEnd) - Math.max(from, day));
  }
  return total;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** «02.11 18:00» по МСК. */
export function formatMsk(at: number): string {
  const p = mskParts(at);
  return `${pad(p.day)}.${pad(p.month)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** «02.11.2026» по МСК. */
export function formatMskDate(at: number): string {
  const p = mskParts(at);
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 1) return 'меньше минуты';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  // Дни показываем только для длинных интервалов (напоминания), статистику — в часах.
  if (days >= 2) return [`${days} д`, hours && `${hours} ч`].filter(Boolean).join(' ');
  const totalHours = Math.floor(minutes / 60);
  if (totalHours === 0) return `${rest} мин`;
  return rest === 0 ? `${totalHours} ч` : `${totalHours} ч ${rest} мин`;
}

const DURATION_UNITS: Record<string, number> = {
  s: 1000, с: 1000, сек: 1000,
  m: MINUTE_MS, м: MINUTE_MS, мин: MINUTE_MS,
  h: HOUR_MS, ч: HOUR_MS,
  d: DAY_MS, д: DAY_MS, дн: DAY_MS,
  w: WEEK_MS, н: WEEK_MS, нед: WEEK_MS,
};

/** «1h30m», «2д», «45мин», «1ч 15м» → миллисекунды; null, если не разобралось. */
export function parseDuration(input: string): number | null {
  const text = input.toLowerCase().replace(/\s+/g, '');
  if (!text) return null;
  const re = /(\d+)([a-zа-я]+)/gy;
  let total = 0;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = re.exec(text))) {
    const unit = DURATION_UNITS[match[2]!];
    if (!unit) return null;
    total += Number(match[1]) * unit;
    consumed = re.lastIndex;
  }
  return consumed === text.length && total > 0 ? total : null;
}

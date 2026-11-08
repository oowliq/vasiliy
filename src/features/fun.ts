import { randomInt } from 'node:crypto';

export interface DiceRoll {
  count: number;
  sides: number;
  rolls: number[];
  total: number;
}

/** «2d6», «d20», «100» (=1d100), пусто (=1d6). null — если не разобралось или вне лимитов. */
export function rollDice(spec = ''): DiceRoll | null {
  const text = spec.trim().toLowerCase().replace('д', 'd');
  let count = 1;
  let sides = 6;
  if (text) {
    const match = /^(\d*)d(\d+)$/.exec(text) ?? /^()(\d+)$/.exec(text);
    if (!match) return null;
    count = match[1] ? Number(match[1]) : 1;
    sides = Number(match[2]);
  }
  if (count < 1 || count > 100 || sides < 2 || sides > 1_000_000) return null;
  const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
  return { count, sides, rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

/** Варианты для `!choose`: через «|», «или» или запятую. */
export function parseChoices(input: string): string[] {
  const separator = input.includes('|') ? /\|/ : / или /i.test(input) ? / или /i : /,/;
  return input
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const EIGHT_BALL = [
  'Бесспорно.',
  'Предрешено.',
  'Никаких сомнений.',
  'Определённо да.',
  'Можешь быть уверен.',
  'Мне кажется — да.',
  'Вероятнее всего.',
  'Хорошие перспективы.',
  'Знаки говорят — да.',
  'Да.',
  'Пока не ясно, попробуй снова.',
  'Спроси позже.',
  'Лучше не рассказывать.',
  'Сейчас нельзя предсказать.',
  'Сконцентрируйся и спроси опять.',
  'Даже не думай.',
  'Мой ответ — нет.',
  'По моим данным — нет.',
  'Перспективы не очень хорошие.',
  'Весьма сомнительно.',
];

export const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export interface Poll {
  question: string;
  options: string[];
}

/** «Вопрос | вариант 1 | вариант 2». Без вариантов — опрос «да/нет». */
export function parsePoll(input: string): Poll | null {
  const [question, ...options] = input.split('|').map((s) => s.trim());
  if (!question) return null;
  const filtered = options.filter(Boolean);
  if (filtered.length === 1 || filtered.length > NUMBER_EMOJIS.length) return null;
  return { question, options: filtered };
}

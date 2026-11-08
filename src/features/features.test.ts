import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../db.js';
import { StatsStore } from '../stats/store.js';
import { DAY_MS, HOUR_MS, MINUTE_MS, formatDuration, parseDuration } from '../time.js';
import { chunkText, formatDays, formatTimes } from '../util.js';
import { Achievements } from './achievements.js';
import type { Announce } from './announce.js';
import { BirthdayStore, daysUntil, isBirthdayOn, parseBirthday } from './birthdays.js';
import { parseChoices, parsePoll, rollDice } from './fun.js';
import { LfgManager, formatLfg, parseLfg } from './lfg.js';
import { QuoteStore } from './quotes.js';
import { ReminderStore } from './reminders.js';
import { Streaks } from './streaks.js';

const G = 'guild';
/** Полдень по МСК в заданную дату. */
const mskNoon = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 9);

function recorder() {
  const sent: { guildId: string; text: string; ping?: string[] }[] = [];
  const announce: Announce = async (guildId, text, options) => {
    sent.push({ guildId, text, ping: options?.ping });
    return true;
  };
  return { sent, announce };
}

describe('время и тексты', () => {
  it('разбирает длительности', () => {
    assert.equal(parseDuration('30m'), 30 * MINUTE_MS);
    assert.equal(parseDuration('1h30m'), 90 * MINUTE_MS);
    assert.equal(parseDuration('2ч'), 2 * HOUR_MS);
    assert.equal(parseDuration('45мин'), 45 * MINUTE_MS);
    assert.equal(parseDuration('3д'), 3 * DAY_MS);
    assert.equal(parseDuration('1w'), 7 * DAY_MS);
    assert.equal(parseDuration('завтра'), null);
    assert.equal(parseDuration('10'), null);
    assert.equal(parseDuration('10x'), null);
    assert.equal(parseDuration('0m'), null);
  });

  it('форматирует длительность, «раз» и «дней»', () => {
    assert.equal(formatDuration(30_000), 'меньше минуты');
    assert.equal(formatDuration(45 * MINUTE_MS), '45 мин');
    assert.equal(formatDuration(2 * HOUR_MS), '2 ч');
    assert.equal(formatDuration(30 * HOUR_MS + 5 * MINUTE_MS), '30 ч 5 мин');
    assert.equal(formatDuration(3 * DAY_MS + 2 * HOUR_MS), '3 д 2 ч');
    assert.deepEqual([1, 2, 4, 5, 11, 12, 21, 22, 25].map(formatTimes), [
      '1 раз', '2 раза', '4 раза', '5 раз', '11 раз', '12 раз', '21 раз', '22 раза', '25 раз',
    ]);
    assert.deepEqual([1, 3, 7, 21].map(formatDays), ['1 день', '3 дня', '7 дней', '21 день']);
  });

  it('делит длинный текст на части по абзацам', () => {
    const chunks = chunkText(['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)].join('\n\n'), 70);
    assert.deepEqual(chunks, [`${'a'.repeat(30)}\n\n${'b'.repeat(30)}`, 'c'.repeat(30)]);
  });
});

describe('развлечения', () => {
  it('бросает кубики в пределах', () => {
    for (let i = 0; i < 200; i++) {
      const r = rollDice('3d6')!;
      assert.equal(r.rolls.length, 3);
      assert.ok(r.total >= 3 && r.total <= 18);
    }
    assert.equal(rollDice()!.sides, 6);
    assert.equal(rollDice('d20')!.sides, 20);
    assert.equal(rollDice('100')!.sides, 100);
    assert.equal(rollDice('2д6')!.count, 2);
    assert.equal(rollDice('0d6'), null);
    assert.equal(rollDice('500d6'), null);
    assert.equal(rollDice('abc'), null);
  });

  it('разбирает варианты и опросы', () => {
    assert.deepEqual(parseChoices('пицца | суши | шаурма'), ['пицца', 'суши', 'шаурма']);
    assert.deepEqual(parseChoices('пицца или суши'), ['пицца', 'суши']);
    assert.deepEqual(parseChoices('a, b'), ['a', 'b']);
    assert.deepEqual(parsePoll('Во что? | CS | Dota'), { question: 'Во что?', options: ['CS', 'Dota'] });
    assert.deepEqual(parsePoll('Идём?'), { question: 'Идём?', options: [] });
    assert.equal(parsePoll('Вопрос | один'), null);
    assert.equal(parsePoll(''), null);
  });
});

describe('LFG', () => {
  it('разбирает игру и размер', () => {
    assert.deepEqual(parseLfg('CS 5'), { game: 'CS', size: 5 });
    assert.deepEqual(parseLfg('Dead by Daylight'), { game: 'Dead by Daylight', size: 5 });
    assert.deepEqual(parseLfg('3'), { game: 'катку', size: 3 });
    assert.equal(parseLfg('CS 1'), null);
  });

  it('набирает состав и закрывается', () => {
    const lfg = new LfgManager();
    lfg.create({ messageId: 'm', channelId: 'c', game: 'CS', size: 3, authorId: 'a' });
    assert.equal(lfg.join('m', 'a'), null, 'автор уже в составе');
    assert.equal(lfg.join('m', 'b')?.kind, 'joined');
    assert.equal(lfg.leave('m', 'b')?.kind, 'left');
    assert.equal(lfg.leave('m', 'a'), null, 'автор не выходит');
    lfg.join('m', 'b');
    const filled = lfg.join('m', 'c');
    assert.equal(filled?.kind, 'filled');
    assert.deepEqual(filled?.group.members, ['a', 'b', 'c']);
    assert.equal(lfg.join('m', 'd'), null, 'после сбора не пускаем');
    assert.match(formatLfg(filled!.group), /состав собран/);
  });

  it('удаляет старые сборы', () => {
    let now = 0;
    const lfg = new LfgManager(() => now);
    lfg.create({ messageId: 'm', channelId: 'c', game: 'CS', size: 3, authorId: 'a' });
    now = 7 * HOUR_MS;
    lfg.cleanup();
    assert.equal(lfg.get('m'), undefined);
  });
});

describe('дни рождения', () => {
  it('разбирает даты', () => {
    assert.deepEqual(parseBirthday('15.03'), { day: 15, month: 3 });
    assert.deepEqual(parseBirthday('1/1'), { day: 1, month: 1 });
    assert.deepEqual(parseBirthday('29.02'), { day: 29, month: 2 });
    assert.equal(parseBirthday('31.04'), null);
    assert.equal(parseBirthday('15.13'), null);
  });

  it('учитывает 29 февраля и переход года', () => {
    const leapDay = { day: 29, month: 2 };
    assert.ok(isBirthdayOn(leapDay, mskNoon(2027, 2, 28)), 'в невисокосный год — 28.02');
    assert.ok(!isBirthdayOn(leapDay, mskNoon(2028, 2, 28)));
    assert.ok(isBirthdayOn(leapDay, mskNoon(2028, 2, 29)));
    assert.equal(daysUntil({ day: 8, month: 11 }, mskNoon(2026, 11, 8)), 0);
    assert.equal(daysUntil({ day: 1, month: 1 }, mskNoon(2026, 12, 31)), 1);
    assert.equal(daysUntil({ day: 7, month: 11 }, mskNoon(2026, 11, 8)), 364);
  });

  it('ищет именинников и ближайших', () => {
    const store = new BirthdayStore(openDatabase(':memory:'));
    store.set(G, 'a', 8, 11);
    store.set(G, 'b', 1, 1);
    store.set(G, 'c', 10, 11);
    const at = mskNoon(2026, 11, 8);
    assert.deepEqual(store.today(G, at).map((b) => b.userId), ['a']);
    assert.deepEqual(store.upcoming(G, at, 2).map((b) => b.userId), ['a', 'c']);
  });
});

describe('цитаты и напоминания', () => {
  it('сохраняет цитату один раз и выдаёт случайную', () => {
    const quotes = new QuoteStore(openDatabase(':memory:'));
    const base = { guildId: G, authorId: 'a', content: 'привет', savedBy: 's', createdAt: 0 };
    const first = quotes.add({ ...base, messageId: 'm1' });
    const again = quotes.add({ ...base, messageId: 'm1' });
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.quote.id, first.quote.id);
    quotes.add({ ...base, authorId: 'b', messageId: 'm2' });
    assert.equal(quotes.random(G, 'b')?.authorId, 'b');
    assert.equal(quotes.random('other'), null);
    assert.equal(quotes.remove(G, first.quote.id), true);
    assert.equal(quotes.count(G), 1);
  });

  it('выдаёт только наступившие напоминания и не даёт удалить чужие', () => {
    const reminders = new ReminderStore(openDatabase(':memory:'));
    const r1 = reminders.add({ guildId: G, channelId: 'c', userId: 'u', text: 'один', dueAt: 100 });
    reminders.add({ guildId: G, channelId: 'c', userId: 'u', text: 'два', dueAt: 200 });
    assert.deepEqual(reminders.due(150).map((r) => r.text), ['один']);
    assert.equal(reminders.remove(r1.id, 'someone-else'), false);
    assert.equal(reminders.remove(r1.id, 'u'), true);
    assert.equal(reminders.listForUser('u').length, 1);
  });
});

describe('ачивки и серии', () => {
  it('выдаёт пороговые ачивки один раз', () => {
    const stats = new StatsStore(openDatabase(':memory:'));
    const { sent, announce } = recorder();
    const achievements = new Achievements(stats, announce, () => 0);
    stats.add(G, 'u', 0, { voice_ms: 11 * HOUR_MS, afk_moves: 10 });
    const earned = achievements.check(G, 'u').map((a) => a.id);
    assert.deepEqual(earned, ['voice_10h', 'afk_10']);
    assert.deepEqual(achievements.check(G, 'u'), []);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0]!.ping, ['u']);
  });

  it('«Ранняя пташка» — только первому в понедельник', () => {
    const stats = new StatsStore(openDatabase(':memory:'));
    const { sent, announce } = recorder();
    const achievements = new Achievements(stats, announce);
    const monday = mskNoon(2026, 11, 9);
    achievements.onJoin(G, 'sunday', mskNoon(2026, 11, 8));
    achievements.onJoin(G, 'first', monday);
    achievements.onJoin(G, 'second', monday + MINUTE_MS);
    assert.deepEqual(stats.getAchievements(G, 'first').map((a) => a.id), ['monday_first']);
    assert.deepEqual(stats.getAchievements(G, 'second'), []);
    assert.deepEqual(stats.getAchievements(G, 'sunday'), []);
    assert.equal(sent.length, 1);
  });

  it('поздравляет с вехой серии и оплакивает прерванную', async () => {
    const stats = new StatsStore(openDatabase(':memory:'));
    const { sent, announce } = recorder();
    const streaks = new Streaks(stats, announce);
    const day0 = Date.UTC(2026, 10, 1, 21); // 02.11 00:00 МСК
    for (let d = 0; d < 7; d++) {
      stats.markVoiceDay(G, 'u', day0 + d * DAY_MS);
      streaks.onVoiceDay(G, 'u', day0 + d * DAY_MS);
    }
    assert.equal(sent.length, 2, 'вехи 3 и 7 дней');
    assert.match(sent[1]!.text, /7 дней подряд/);

    // День 7 пропущен → на день 8 сообщаем о прерванной серии.
    await streaks.reportBroken(G, day0 + 8 * DAY_MS);
    assert.equal(sent.length, 3);
    assert.match(sent[2]!.text, /7 дней/);
  });
});

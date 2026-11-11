import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../db.js';
import { SettingsStore } from '../settings.js';
import { DAY_MS, HOUR_MS, MINUTE_MS as MIN, WEEK_MS, formatMsk, weekStart } from '../time.js';
import { formatTop, formatWeeklyReport, nominate } from './format.js';
import { StatsStore } from './store.js';
import { VoiceTracker, type TrackerHooks, type VoiceSnapshot } from './tracker.js';

const G = 'guild';
const AFK = 'afk-channel';

/** Понедельник 09.11.2026 00:00 МСК = 21:00 UTC. */
const WEEK_START = Date.UTC(2026, 10, 8, 21, 0);
/** Понедельник 09.11.2026 00:00 МСК. */
const MONDAY_MSK = Date.UTC(2026, 10, 8, 21, 0);

function setup(start: number, hooks: TrackerHooks = {}) {
  let now = start;
  const store = new StatsStore(openDatabase(':memory:'));
  const tracker = new VoiceTracker(store, () => AFK, hooks, () => now);
  const state = (userId: string, channelId: string | null, extra: Partial<VoiceSnapshot> = {}) =>
    tracker.update({
      guildId: G,
      userId,
      channelId,
      serverMute: false,
      selfMute: false,
      stream: false,
      video: false,
      ...extra,
    });
  return { store, tracker, state, advance: (ms: number) => (now += ms) };
}

describe('week', () => {
  it('неделя начинается в понедельник 00:00 МСК', () => {
    assert.equal(weekStart(WEEK_START), WEEK_START);
    assert.equal(weekStart(WEEK_START - 1), WEEK_START - WEEK_MS);
    assert.equal(weekStart(WEEK_START + 3 * DAY_MS), WEEK_START);
    assert.equal(formatMsk(WEEK_START), '09.11 00:00');
  });
});

describe('VoiceTracker', () => {
  it('считает время в канале, мьюты, стрим и камеру', () => {
    const t = setup(WEEK_START + HOUR_MS);
    t.state('u1', 'voice');
    t.advance(30 * MIN);
    t.state('u1', 'voice', { selfMute: true, stream: true });
    t.advance(20 * MIN);
    t.state('u1', 'voice', { selfMute: true, serverMute: true, video: true });
    t.advance(10 * MIN);
    t.state('u1', null);

    const c = t.store.getWeek(G, 'u1', WEEK_START);
    assert.equal(c.voice_ms, 60 * MIN);
    assert.equal(c.self_mute_ms, 20 * MIN, 'самомьют не считается поверх серверного');
    assert.equal(c.server_mute_ms, 10 * MIN);
    assert.equal(c.stream_ms, 20 * MIN);
    assert.equal(c.video_ms, 10 * MIN);
    assert.equal(c.night_ms, 60 * MIN);
  });

  it('считает попадания в AFK и время там отдельно', () => {
    const t = setup(WEEK_START + HOUR_MS);
    t.state('u1', 'voice');
    t.advance(10 * MIN);
    t.state('u1', AFK);
    t.advance(5 * MIN);
    t.state('u1', AFK, { selfMute: true }); // смена состояния внутри AFK — не новое попадание
    t.advance(5 * MIN);
    t.state('u1', 'voice');
    t.advance(MIN);
    t.state('u1', AFK);
    t.advance(MIN);
    t.tracker.flush();

    const c = t.store.getWeek(G, 'u1', WEEK_START);
    assert.equal(c.afk_moves, 2);
    assert.equal(c.afk_ms, 11 * MIN);
    assert.equal(c.voice_ms, 11 * MIN);
    assert.equal(c.self_mute_ms, 0, 'мьют в AFK не считается');
  });

  it('делит сессию по границе недели', () => {
    const t = setup(WEEK_START - 30 * MIN);
    t.state('u1', 'voice');
    t.advance(HOUR_MS);
    t.tracker.flush();

    assert.equal(t.store.getWeek(G, 'u1', WEEK_START - WEEK_MS).voice_ms, 30 * MIN);
    assert.equal(t.store.getWeek(G, 'u1', WEEK_START).voice_ms, 30 * MIN);
    assert.equal(t.store.getTotal(G, 'u1').voice_ms, HOUR_MS);
  });

  it('повторный flush не задваивает время', () => {
    const t = setup(WEEK_START + HOUR_MS);
    t.state('u1', 'voice');
    t.advance(10 * MIN);
    t.tracker.flush();
    t.tracker.flush();
    t.advance(5 * MIN);
    t.tracker.flush();
    assert.equal(t.store.getWeek(G, 'u1', WEEK_START).voice_ms, 15 * MIN);
  });

  it('sync закрывает сессии тех, кого больше нет в голосе', () => {
    const t = setup(WEEK_START + HOUR_MS);
    t.state('u1', 'voice');
    t.state('u2', 'voice');
    t.advance(10 * MIN);
    t.tracker.sync(G, []);
    t.advance(10 * MIN);
    t.tracker.flush();
    assert.equal(t.store.getWeek(G, 'u1', WEEK_START).voice_ms, 10 * MIN);
    assert.equal(t.store.getWeek(G, 'u2', WEEK_START).voice_ms, 10 * MIN);
  });

  it('считает ночное время 00:00–06:00 МСК', () => {
    const t = setup(MONDAY_MSK - HOUR_MS); // вс 23:00
    t.state('u1', 'voice');
    t.advance(8 * HOUR_MS); // до пн 07:00
    t.tracker.flush();
    const c = t.store.getTotal(G, 'u1');
    assert.equal(c.voice_ms, 8 * HOUR_MS);
    assert.equal(c.night_ms, 6 * HOUR_MS);
  });

  it('считает совместное время пар без двойного учёта', () => {
    const t = setup(WEEK_START + HOUR_MS);
    t.state('a', 'voice');
    t.advance(10 * MIN);
    t.state('b', 'voice'); // a один 10 минут
    t.advance(20 * MIN);
    t.tracker.flush();
    t.state('c', 'voice');
    t.advance(15 * MIN);
    t.state('b', 'other'); // b ушёл в другой канал
    t.advance(5 * MIN);
    t.state('c', AFK); // c в AFK — пары не считаются
    t.advance(5 * MIN);
    t.tracker.flush();

    const pairs = Object.fromEntries(
      t.store.getTopPairs(G, WEEK_START, 10).map((p) => [`${p.userA}+${p.userB}`, p.ms]),
    );
    assert.deepEqual(pairs, { 'a+b': 35 * MIN, 'a+c': 20 * MIN, 'b+c': 15 * MIN });
    assert.deepEqual(t.store.getBestPartner(G, 'a', WEEK_START), { userId: 'b', ms: 35 * MIN });
  });

  it('отмечает дни в голосе и сообщает о новых', () => {
    const days: number[] = [];
    const t = setup(MONDAY_MSK - 10 * MIN, { onVoiceDay: (_g, _u, day) => days.push(day) });
    t.state('u1', 'voice');
    t.advance(20 * MIN); // через полночь
    t.tracker.flush();
    t.advance(MIN);
    t.tracker.flush();
    assert.deepEqual(days, [MONDAY_MSK - DAY_MS, MONDAY_MSK]);
    assert.equal(t.store.getStreak(G, 'u1', MONDAY_MSK), 2);
  });

  it('вызывает onJoin только при входе в голос, не в AFK', () => {
    const joins: string[] = [];
    const t = setup(WEEK_START, { onJoin: (_g, u) => joins.push(u) });
    t.state('a', 'voice');
    t.state('a', 'other');
    t.state('b', AFK);
    t.state('b', 'voice');
    assert.deepEqual(joins, ['a']);
  });
});

describe('StatsStore', () => {
  it('считает текущую и лучшую серию', () => {
    const store = new StatsStore(openDatabase(':memory:'));
    for (const d of [0, 1, 2, 5, 6, 7, 8]) store.markVoiceDay(G, 'u', MONDAY_MSK + d * DAY_MS);
    assert.equal(store.getStreak(G, 'u', MONDAY_MSK + 8 * DAY_MS), 4);
    assert.equal(store.getStreak(G, 'u', MONDAY_MSK + 2 * DAY_MS), 3);
    assert.equal(store.getStreak(G, 'u', MONDAY_MSK + 3 * DAY_MS), 0);
    assert.equal(store.getBestStreak(G, 'u'), 4);
  });

  it('мигрирует старую таблицу без новых колонок', () => {
    const db = openDatabase(':memory:');
    db.exec(`CREATE TABLE weekly_stats (guild_id TEXT, user_id TEXT, week_start INTEGER, voice_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, week_start))`);
    db.exec(`CREATE TABLE guild_settings (guild_id TEXT PRIMARY KEY, report_channel_id TEXT, last_reported_week INTEGER)`);
    db.exec(`INSERT INTO guild_settings VALUES ('g', 'chan', 5)`);
    const store = new StatsStore(db);
    store.add(G, 'u', 0, { voice_ms: 1, night_ms: 2 });
    assert.equal(store.getWeek(G, 'u', 0).night_ms, 2);
    const settings = new SettingsStore(db).get('g');
    assert.equal(settings.announceChannelId, 'chan');
    assert.equal(settings.lastReportedWeek, 5);
    assert.equal(settings.welcomeEnabled, true);
  });
});

describe('format', () => {
  it('строит топ, сортируя по убыванию и пропуская пустые разделы', () => {
    const store = new StatsStore(openDatabase(':memory:'));
    store.add(G, 'a', WEEK_START, { voice_ms: HOUR_MS, messages: 3 });
    store.add(G, 'b', WEEK_START, { voice_ms: 2 * HOUR_MS });
    const text = formatTop(store, G, WEEK_START);

    assert.match(text, /Топ текущей недели/);
    assert.ok(text.indexOf('1. <@b> — 2 ч') < text.indexOf('2. <@a> — 1 ч'));
    assert.match(text, /1\. <@a> — 3 сообщ\./);
    assert.doesNotMatch(text, /AFK/);
  });

  it('выбирает номинантов и MVP', () => {
    const store = new StatsStore(openDatabase(':memory:'));
    const w = WEEK_START;
    store.add(G, 'loud', w, { voice_ms: 10 * HOUR_MS, self_mute_ms: HOUR_MS, messages: 50 });
    store.add(G, 'quiet', w, { voice_ms: 3 * HOUR_MS, self_mute_ms: 2 * HOUR_MS, afk_moves: 4 });
    // Почти всё время в мьюте, но в голосе меньше 2 часов — в «Молчуны» не попадает.
    store.add(G, 'lurker', w, { voice_ms: HOUR_MS, self_mute_ms: HOUR_MS });
    store.addPair(G, w, 'loud', 'quiet', 3 * HOUR_MS);

    const n = nominate(store, G, w);
    assert.equal(n.mvpUserId, 'loud');
    assert.match(n.text, /MVP недели\*\* — <@loud>/);
    assert.match(n.text, /Король AFK\*\* — <@quiet> \(4 раза\)/);
    assert.match(n.text, /Молчун недели\*\* — <@quiet> \(67% времени в мьюте\)/);
    assert.match(n.text, /Болтун недели\*\* — <@loud>/);
    assert.match(n.text, /Дуэт недели\*\* — <@loud> и <@quiet>/);
    assert.doesNotMatch(n.text, /Полуночник/);
  });

  it('пишет про тихую неделю без активности', () => {
    const store = new StatsStore(openDatabase(':memory:'));
    const report = formatWeeklyReport(store, G, WEEK_START);
    assert.equal(report.mvpUserId, null);
    assert.match(report.text, /тихо/);
  });
});

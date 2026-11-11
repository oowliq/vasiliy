import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Client } from '@fluxerjs/core';
import { openDatabase } from '../db.js';
import { adminCommands } from '../commands/admin.js';
import type { CommandContext } from '../commands/types.js';
import { SettingsStore } from '../settings.js';
import { HOUR_MS, WEEK_MS } from '../time.js';
import { StatsStore } from './store.js';
import { publishWeeklyReports } from './report.js';

const monday = Date.UTC(2026, 10, 8, 21);
function setup() {
  const db = openDatabase(':memory:');
  const settings = new SettingsStore(db);
  settings.update('g', { announceChannelId: 'channel', defaultRoleId: 'default', weeklyRoleId: 'weekly' } as Parameters<SettingsStore['update']>[1]);
  const stats = new StatsStore(db);
  let fail = false;
  const member = (id: string, roles: string[], bot = false) => ({
    id, user: { bot }, roles: {
      cache: new Set(roles),
      has(role: string) { return this.cache.has(role); },
      async add(role: string) { if (fail) throw new Error('API unavailable'); this.cache.add(role); },
      async remove(role: string) { if (fail) throw new Error('API unavailable'); this.cache.delete(role); },
    },
  });
  const members = [member('1', ['weekly']), member('2', ['weekly']), member('3', ['default']), member('4', []), member('5', ['default'], true)];
  const fetches: unknown[] = [];
  const client = { guilds: { resolve: async () => ({ members: {
    fetch: async (options: { after?: string; limit: number }) => {
      fetches.push(options);
      const start = options.after ? members.findIndex((m) => m.id === options.after) + 1 : 0;
      return members.slice(start, start + options.limit);
    },
    resolve: async (id: string) => members.find((m) => m.id === id),
  } }) } } as unknown as Client;
  for (const [id, hours] of [['1', 2], ['2', 1], ['3', 3], ['4', 100], ['5', 200]] as const) {
    stats.add('g', id, monday - WEEK_MS, { voice_ms: hours * HOUR_MS });
  }
  const messages: string[] = [];
  let send = true;
  const announce = async (_g: string, text: string) => { messages.push(text); return send; };
  return { db, settings, stats, members, member, client, messages, fetches, announce,
    fail: (value: boolean) => { fail = value; }, send: (value: boolean) => { send = value; },
    run: () => publishWeeklyReports(client, stats, settings, announce) };
}

it('waits until Monday 09:00, restores every holder and awards only eligible humans once', async (t) => {
  const s = setup(); t.after(() => s.db.close());
  t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS - 1);
  await s.run(); assert.equal(s.messages.length, 0); assert.equal(s.fetches.length, 0);
  t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS);
  await s.run();
  for (const m of s.members.slice(0, 2)) {
    assert.ok(m.roles.has('default')); assert.ok(!m.roles.has('weekly'));
  }
  assert.ok(s.members[2]!.roles.has('weekly')); assert.ok(!s.members[2]!.roles.has('default'));
  assert.match(s.messages.join('\n'), /MVP недели\*\* — <@3>/);
  assert.doesNotMatch(s.messages.join('\n'), /MVP недели\*\* — <@5>/);
  const count = s.messages.length; await s.run(); assert.equal(s.messages.length, count);
});

it('retries failed role changes and delivery independently', async (t) => {
  const s = setup(); t.after(() => s.db.close()); t.mock.method(Date, 'now', () => monday + 10 * HOUR_MS);
  s.fail(true); await s.run(); assert.equal(s.settings.get('g').lastReportedWeek, null);
  s.fail(false); s.send(false); await s.run(); assert.ok(s.members[2]!.roles.has('weekly'));
  assert.equal(s.settings.get('g').lastReportedWeek, null);
  s.send(true); await s.run(); assert.equal(s.settings.get('g').lastReportedWeek, monday - WEEK_MS);
});

it('runs role rotation without an announcement channel', async (t) => {
  const s = setup(); t.after(() => s.db.close()); t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS);
  s.settings.update('g', { announceChannelId: null }); await s.run();
  assert.ok(s.members[2]!.roles.has('weekly'));
});

it('restores old winners without awarding anyone when there is no voice activity', async (t) => {
  const s = setup(); t.after(() => s.db.close()); t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS);
  s.db.exec('DELETE FROM weekly_stats'); await s.run();
  assert.ok(s.members.every((m) => !m.roles.has('weekly')));
  assert.ok(s.members[0]!.roles.has('default'));
});

it('fetches every page, including role holders beyond the first 1000', async (t) => {
  const s = setup(); t.after(() => s.db.close()); t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS);
  for (let id = 6; id <= 1001; id++) s.members.push(s.member(String(id), id === 1001 ? ['weekly'] : []));
  await s.run();
  assert.equal(s.fetches.length, 2);
  assert.deepEqual(s.fetches[1], { limit: 1000, after: '1000' });
  assert.ok(s.members[1000]!.roles.has('default'));
  assert.ok(!s.members[1000]!.roles.has('weekly'));
});

it('allows the old winner to win again and resolves ties by numeric ID', async (t) => {
  const s = setup(); t.after(() => s.db.close()); t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS);
  s.stats.add('g', '1', monday - WEEK_MS, { voice_ms: HOUR_MS });
  await s.run();
  assert.ok(s.members[0]!.roles.has('weekly'));
  assert.ok(!s.members[0]!.roles.has('default'));
  assert.match(s.messages.join('\n'), /MVP недели\*\* — <@1>/);
});

it('keeps the selected winner after restart and a partial role change', async (t) => {
  const s = setup(); t.after(() => s.db.close()); t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS);
  const remove = s.members[1]!.roles.remove;
  s.members[1]!.roles.remove = async () => { throw new Error('temporary failure'); };
  await s.run();
  assert.equal(s.settings.get('g').pendingWinnerId, '3');
  assert.ok(!s.members[0]!.roles.has('weekly'));
  s.stats.add('g', '1', monday - WEEK_MS, { voice_ms: 100 * HOUR_MS });
  s.members[1]!.roles.remove = remove;
  await publishWeeklyReports(s.client, s.stats, new SettingsStore(s.db), s.announce);
  assert.ok(s.members[2]!.roles.has('weekly'));
  assert.equal(s.settings.get('g').pendingWeek, null);
});

it('serializes overlapping calls and never repeats roles when announcement fails', async (t) => {
  const s = setup(); t.after(() => s.db.close()); t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS);
  s.send(false);
  await Promise.all([s.run(), s.run()]);
  assert.equal(s.fetches.length, 1);
  s.send(true); await s.run();
  assert.equal(s.fetches.length, 1);
  assert.equal(s.settings.get('g').lastReportedWeek, monday - WEEK_MS);
});

it('does not mutate stale roles if an admin disables the contest during member fetch', async (t) => {
  const s = setup(); t.after(() => s.db.close()); t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS);
  const guild = await s.client.guilds.resolve('g');
  const original = guild.members.fetch.bind(guild.members);
  guild.members.fetch = (async (options: unknown) => {
    s.settings.update('g', { defaultRoleId: null });
    return original(options as never);
  }) as typeof guild.members.fetch;
  s.client.guilds.resolve = async () => guild;
  await s.run();
  assert.ok(s.members[0]!.roles.has('weekly'));
  assert.equal(s.settings.get('g').pendingWeek, null);
});

it('blocks admin role changes while a rotation is fetching members', async (t) => {
  const s = setup(); t.after(() => s.db.close()); t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS);
  const guild = await s.client.guilds.resolve('g');
  const original = guild.members.fetch.bind(guild.members);
  const context = { guildId: 'g', args: ['off'], message: { reply: async () => {} }, app: { settings: s.settings } } as unknown as CommandContext;
  guild.members.fetch = (async (options: unknown) => {
    await adminCommands.find((c) => c.name === 'default_role')!.run(context);
    return original(options as never);
  }) as typeof guild.members.fetch;
  s.client.guilds.resolve = async () => guild;
  await s.run();
  assert.equal(s.settings.get('g').defaultRoleId, 'default');
  assert.ok(s.members[2]!.roles.has('weekly'));
});

it('does not award a sole active eligible participant, even with inactive holders and active outsiders', async (t) => {
  const s = setup(); t.after(() => s.db.close()); t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS);
  s.db.prepare('DELETE FROM weekly_stats WHERE user_id IN (?, ?)').run('1', '2');
  s.stats.add('g', '1', monday - WEEK_MS, { messages: 10 });
  await s.run();
  assert.ok(s.members.every((m) => !m.roles.has('weekly')));
  assert.ok(s.members.slice(0, 3).every((m) => m.roles.has('default')));
  assert.equal(s.settings.get('g').weeklyUserId, null);
  assert.match(s.messages.join('\n'), /нет победителя/);
  assert.doesNotMatch(s.messages.join('\n'), /MVP недели/);
  const count = s.messages.length;
  await s.run(); assert.equal(s.messages.length, count);
});

it('awards the best of exactly two active eligible participants', async (t) => {
  const s = setup(); t.after(() => s.db.close()); t.mock.method(Date, 'now', () => monday + 9 * HOUR_MS);
  s.db.prepare('DELETE FROM weekly_stats WHERE user_id = ?').run('2');
  await s.run();
  assert.ok(s.members[2]!.roles.has('weekly'));
  assert.equal(s.settings.get('g').weeklyUserId, '3');
});

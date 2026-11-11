import assert from 'node:assert/strict';
import { it } from 'node:test';
import { openDatabase } from '../db.js';
import { SettingsStore } from '../settings.js';
import { adminCommands } from './admin.js';
import type { CommandContext } from './types.js';

it('role configuration and announcement channel are admin-only', () => {
  for (const name of ['default_role', 'weekly_role', 'channel']) {
    assert.equal(adminCommands.find((c) => c.name === name)?.admin, true);
  }
});

it('validates role IDs and saves different roles; keeps the existing alias', async () => {
  const db = openDatabase(':memory:');
  try {
    const settings = new SettingsStore(db);
    const replies: string[] = [];
    const context = {
      guildId: '100', args: ['<@&101>'], message: { reply: async (s: string) => { replies.push(s); } },
      app: { prefix: '!', settings, client: { guilds: { resolve: async () => ({
        fetchRoles: async () => {}, roles: new Map([['101', {}], ['102', {}]]),
      }) } } },
    } as unknown as CommandContext;
    const defaultCommand = adminCommands.find((c) => c.name === 'default_role')!;
    const weeklyCommand = adminCommands.find((c) => c.name === 'weekly_role')!;
    await defaultCommand.run(context); assert.equal(settings.get('100').defaultRoleId, '101');
    await weeklyCommand.run(context); assert.equal(settings.get('100').weeklyRoleId, null);
    context.args = ['999']; await weeklyCommand.run(context); assert.equal(settings.get('100').weeklyRoleId, null);
    context.args = ['102']; await weeklyCommand.run(context); assert.equal(settings.get('100').weeklyRoleId, '102');
    assert.ok(weeklyCommand.aliases?.includes('mvprole'));
    context.args = ['off']; await defaultCommand.run(context); assert.equal(settings.get('100').defaultRoleId, null);
  } finally { db.close(); }
});

it('allows admins to cancel a failed pending award with off', async () => {
  const db = openDatabase(':memory:');
  try {
    const settings = new SettingsStore(db);
    settings.update('g', { defaultRoleId: 'deleted', weeklyRoleId: 'weekly', pendingWeek: 42, pendingWinnerId: '1' });
    const context = { guildId: 'g', args: ['off'], message: { reply: async () => {} }, app: { settings } } as unknown as CommandContext;
    await adminCommands.find((c) => c.name === 'default_role')!.run(context);
    assert.equal(settings.get('g').defaultRoleId, null);
    assert.equal(settings.get('g').pendingWeek, null);
    assert.equal(settings.get('g').pendingWinnerId, null);
  } finally { db.close(); }
});

it('rechecks pending state after fetching roles before saving configuration', async () => {
  const db = openDatabase(':memory:');
  try {
    const settings = new SettingsStore(db);
    settings.update('g', { defaultRoleId: '101', weeklyRoleId: '102' });
    const context = {
      guildId: 'g', args: ['103'], message: { reply: async () => {} },
      app: { prefix: '!', settings, client: { guilds: { resolve: async () => ({
        fetchRoles: async () => settings.update('g', { pendingWeek: 42, pendingWinnerId: '1' }),
        roles: new Map([['103', {}]]),
      }) } } },
    } as unknown as CommandContext;
    await adminCommands.find((c) => c.name === 'weekly_role')!.run(context);
    assert.equal(settings.get('g').weeklyRoleId, '102');
    assert.equal(settings.get('g').pendingWeek, 42);
  } finally { db.close(); }
});

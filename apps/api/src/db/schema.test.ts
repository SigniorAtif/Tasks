// Checks the migrations did what the schema says, against real Postgres.

import type { Rule } from '@tasks/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDb, testPool } from '../test/database.ts';
import {
  authAccount,
  authSession,
  authUser,
  occurrenceOverride,
  profile,
  scheduleGroup,
  series,
} from './schema.ts';

beforeEach(() => resetDatabase());

async function insertUser(email: string) {
  const [user] = await testDb.insert(authUser).values({ name: 'Alice', email }).returning();
  if (!user) throw new Error('insert returned nothing');
  return user;
}

describe('the first migration', () => {
  it('creates the four auth tables, profile and the three calendar tables', async () => {
    const { rows } = await testPool.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    expect(rows.map((row) => row.tablename)).toEqual([
      'auth_account',
      'auth_session',
      'auth_user',
      'auth_verification',
      'occurrence_override',
      'profile',
      'schedule_group',
      'series',
    ]);
  });

  it('falls back to a UUIDv7 id when the app does not supply one', async () => {
    const user = await insertUser('alice@example.com');
    // The 13th hex digit of a UUID is its version.
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('gives a new profile the default zone and day boundary', async () => {
    const user = await insertUser('alice@example.com');
    await testDb.insert(profile).values({ userId: user.id });
    const [row] = await testDb.select().from(profile).where(eq(profile.userId, user.id));
    expect(row).toMatchObject({ tzid: 'Asia/Kolkata', dayBoundary: '04:00:00' });
  });

  it("deletes a user's sessions, accounts and profile along with the user", async () => {
    const user = await insertUser('alice@example.com');
    await testDb.insert(profile).values({ userId: user.id });
    await testDb.insert(authSession).values({
      userId: user.id,
      token: 'token-1',
      expiresAt: new Date('2026-11-11T00:00:00Z'),
    });
    await testDb
      .insert(authAccount)
      .values({ userId: user.id, providerId: 'google', accountId: 'google-sub-1' });

    await testDb.delete(authUser).where(eq(authUser.id, user.id));

    expect(await testDb.select().from(profile)).toEqual([]);
    expect(await testDb.select().from(authSession)).toEqual([]);
    expect(await testDb.select().from(authAccount)).toEqual([]);
  });

  it('lets one Google identity belong to only one user', async () => {
    const alice = await insertUser('alice@example.com');
    const bob = await insertUser('bob@example.com');
    await testDb
      .insert(authAccount)
      .values({ userId: alice.id, providerId: 'google', accountId: 'google-sub-1' });
    await expect(
      testDb
        .insert(authAccount)
        .values({ userId: bob.id, providerId: 'google', accountId: 'google-sub-1' }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The calendar tables (migrations 0001 and 0002)
// ---------------------------------------------------------------------------

const weekly: Rule = { freq: 'weekly', interval: 1, byDay: ['MO'] };

async function insertGroup(userId: string, name = 'Classes') {
  const [group] = await testDb
    .insert(scheduleGroup)
    .values({ userId, name, activeFrom: '2026-07-13' })
    .returning();
  if (!group) throw new Error('insert returned nothing');
  return group;
}

function seriesRow(userId: string, groupId: string) {
  return {
    userId,
    groupId,
    title: 'DS',
    subject: 'Data Structures',
    rule: weekly,
    startDate: '2026-07-13',
    startTime: '10:00',
    durationMin: 60,
    tzid: 'Asia/Kolkata',
  };
}

describe('the calendar tables', () => {
  it('refuse a rule the engine cannot run', async () => {
    const alice = await insertUser('alice@example.com');
    const group = await insertGroup(alice.id);
    const bad = [
      { freq: 'monthly', interval: 1 },
      { freq: 'weekly', interval: 1, byDay: [] },
      { freq: 'weekly', interval: 1 },
      { freq: 'daily', interval: '1' },
    ];
    for (const rule of bad) {
      await expect(
        testDb.insert(series).values({ ...seriesRow(alice.id, group.id), rule: rule as never }),
      ).rejects.toThrow();
    }
  });

  it("won't let a series join another user's group (composite foreign key)", async () => {
    const alice = await insertUser('alice@example.com');
    const bob = await insertUser('bob@example.com');
    const bobsGroup = await insertGroup(bob.id);
    await expect(testDb.insert(series).values(seriesRow(alice.id, bobsGroup.id))).rejects.toThrow();
  });

  it('keeps one override per generated occurrence, and any number of extras', async () => {
    const alice = await insertUser('alice@example.com');
    const group = await insertGroup(alice.id);
    const [ds] = await testDb.insert(series).values(seriesRow(alice.id, group.id)).returning();
    if (!ds) throw new Error('insert returned nothing');
    const cancelled = {
      userId: alice.id,
      seriesId: ds.id,
      kind: 'modified' as const,
      originalDate: '2026-10-12',
      status: 'cancelled' as const,
      cancelReason: 'not_held' as const,
    };
    await testDb.insert(occurrenceOverride).values(cancelled);
    await expect(testDb.insert(occurrenceOverride).values(cancelled)).rejects.toThrow();
    const extra = {
      userId: alice.id,
      seriesId: ds.id,
      kind: 'extra' as const,
      newDate: '2026-10-17',
      newStartTime: '10:00',
    };
    await testDb.insert(occurrenceOverride).values([extra, extra]);
    expect(await testDb.select().from(occurrenceOverride)).toHaveLength(3);
  });

  it('deletes series and overrides with their group', async () => {
    const alice = await insertUser('alice@example.com');
    const group = await insertGroup(alice.id);
    const [ds] = await testDb.insert(series).values(seriesRow(alice.id, group.id)).returning();
    if (!ds) throw new Error('insert returned nothing');
    await testDb.insert(occurrenceOverride).values({
      userId: alice.id,
      seriesId: ds.id,
      kind: 'modified',
      originalDate: '2026-10-12',
      note: 'Bring the lab manual',
    });
    await testDb.delete(scheduleGroup).where(eq(scheduleGroup.id, group.id));
    expect(await testDb.select().from(series)).toEqual([]);
    expect(await testDb.select().from(occurrenceOverride)).toEqual([]);
  });
});

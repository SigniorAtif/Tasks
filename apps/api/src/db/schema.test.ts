// Checks the migrations did what the schema says, against real Postgres.

import type { Rule } from '@tasks/core';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDb, testPool } from '../test/database.ts';
import type { Database } from './client.ts';
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

/**
 * Runs `fn` the way the API does for calendar data: in a transaction, as the
 * `tasks_app` role, with `app.user_id` naming one user (null = nobody).
 */
async function asUser<T>(userId: string | null, fn: (tx: Database) => Promise<T>): Promise<T> {
  return testDb.transaction(async (tx) => {
    if (userId !== null) await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`set local role tasks_app`);
    return fn(tx as unknown as Database);
  });
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

describe('row-level security on the calendar tables', () => {
  it('is enabled and forced on all three, and nowhere else', async () => {
    const { rows } = await testPool.query<{ relname: string; on: boolean; forced: boolean }>(
      `select relname, relrowsecurity as on, relforcerowsecurity as forced
         from pg_class join pg_namespace on pg_namespace.oid = relnamespace
        where nspname = 'public' and relkind = 'r' and relrowsecurity
        order by relname`,
    );
    expect(rows).toEqual([
      { relname: 'occurrence_override', on: true, forced: true },
      { relname: 'schedule_group', on: true, forced: true },
      { relname: 'series', on: true, forced: true },
    ]);
  });

  it("shows a query with no WHERE only the current user's rows", async () => {
    const alice = await insertUser('alice@example.com');
    const bob = await insertUser('bob@example.com');
    await insertGroup(alice.id, 'Alice classes');
    await insertGroup(bob.id, 'Bob classes');

    // A query that "forgot" to filter by user: RLS filters it anyway.
    const seenByAlice = await asUser(alice.id, (tx) => tx.select().from(scheduleGroup));
    expect(seenByAlice.map((group) => group.name)).toEqual(['Alice classes']);
    // Nobody signed in: nothing at all.
    expect(await asUser(null, (tx) => tx.select().from(scheduleGroup))).toEqual([]);
    // The owner connection (used by migrations and tests) still sees both.
    expect(await testDb.select().from(scheduleGroup)).toHaveLength(2);
  });

  it("can't write, change or delete another user's rows", async () => {
    const alice = await insertUser('alice@example.com');
    const bob = await insertUser('bob@example.com');
    const bobsGroup = await insertGroup(bob.id, 'Bob classes');

    // Inserting a row that claims to be Bob's fails the WITH CHECK. Drizzle wraps
    // Postgres' error; the original is its `cause`.
    const refused = await asUser(alice.id, (tx) =>
      tx.insert(scheduleGroup).values({ userId: bob.id, name: 'x', activeFrom: '2026-07-13' }),
    ).catch((error: unknown) => error);
    expect((refused as Error).cause).toMatchObject({
      code: '42501',
      message: expect.stringMatching(/violates row-level security policy/),
    });
    // Updates and deletes simply don't find Bob's row.
    const renamed = await asUser(alice.id, (tx) =>
      tx.update(scheduleGroup).set({ name: 'Mine now' }).returning(),
    );
    const deleted = await asUser(alice.id, (tx) => tx.delete(scheduleGroup).returning());
    expect(renamed).toEqual([]);
    expect(deleted).toEqual([]);
    const [still] = await testDb
      .select()
      .from(scheduleGroup)
      .where(eq(scheduleGroup.id, bobsGroup.id));
    expect(still?.name).toBe('Bob classes');
  });

  it('forgets the user when the transaction ends', async () => {
    const alice = await insertUser('alice@example.com');
    await insertGroup(alice.id);
    await asUser(alice.id, (tx) => tx.select().from(scheduleGroup));
    // Same pool, later transaction, no user set: the old setting is gone ('' → nobody).
    expect(await asUser(null, (tx) => tx.select().from(scheduleGroup))).toEqual([]);
  });
});

// `withUser` against real Postgres: the role switch, the user setting, and that
// both end with the transaction.

import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDb } from '../test/database.ts';
import { testDatabaseUrl } from '../test/env.ts';
import { createDb } from './client.ts';
import { authUser, scheduleGroup } from './schema.ts';
import { withUser } from './user-scope.ts';

beforeEach(() => resetDatabase());

async function insertUser(email: string): Promise<string> {
  const [user] = await testDb.insert(authUser).values({ name: email, email }).returning();
  if (!user) throw new Error('insert returned nothing');
  return user.id;
}

async function insertGroup(userId: string, name: string): Promise<void> {
  await testDb.insert(scheduleGroup).values({ userId, name, activeFrom: '2026-07-13' });
}

describe('withUser', () => {
  it('runs as tasks_app with app.user_id naming the user', async () => {
    const alice = await insertUser('alice@example.com');
    const inside = await withUser(testDb, alice, async ({ tx }) => {
      const { rows } = await tx.execute<{ role: string; userId: string }>(
        sql`select current_user as role, current_setting('app.user_id') as "userId"`,
      );
      return rows[0];
    });
    expect(inside).toEqual({ role: 'tasks_app', userId: alice });
  });

  it('hands the connection back as the owner, naming nobody', async () => {
    const alice = await insertUser('alice@example.com');
    // A pool of one connection, so the next query surely reuses the same one.
    const pool = new Pool({ connectionString: testDatabaseUrl(), max: 1 });
    try {
      await withUser(createDb(pool), alice, ({ tx }) => tx.select().from(scheduleGroup));
      const { rows } = await pool.query<{ role: string; userId: string | null }>(
        `select current_user as role, current_setting('app.user_id', true) as "userId"`,
      );
      // The login role from the URL (the owner), no longer tasks_app.
      expect(rows[0]?.role).toBe(new URL(testDatabaseUrl()).username);
      // After a SET LOCAL ends, an unset setting reads back as '' rather than NULL.
      expect(rows[0]?.userId).toBe('');
    } finally {
      await pool.end();
    }
  });

  it("shows a query with no WHERE only the user's own rows", async () => {
    const alice = await insertUser('alice@example.com');
    const bob = await insertUser('bob@example.com');
    await insertGroup(alice, 'Alice classes');
    await insertGroup(bob, 'Bob classes');

    const seen = await withUser(testDb, bob, ({ tx }) => tx.select().from(scheduleGroup));
    expect(seen.map((group) => group.name)).toEqual(['Bob classes']);
    expect(await testDb.select().from(scheduleGroup)).toHaveLength(2);
  });

  it('rolls everything back when the function throws', async () => {
    const alice = await insertUser('alice@example.com');
    const failed = withUser(testDb, alice, async ({ tx, userId }) => {
      await tx
        .insert(scheduleGroup)
        .values({ userId, name: 'Half done', activeFrom: '2026-07-13' });
      throw new Error('something went wrong halfway');
    });
    await expect(failed).rejects.toThrow('something went wrong halfway');
    expect(await testDb.select().from(scheduleGroup)).toEqual([]);
  });

  it("refuses to write a row that claims to be someone else's", async () => {
    const alice = await insertUser('alice@example.com');
    const bob = await insertUser('bob@example.com');
    const refused = await withUser(testDb, alice, ({ tx }) =>
      tx.insert(scheduleGroup).values({ userId: bob, name: 'x', activeFrom: '2026-07-13' }),
    ).catch((error: unknown) => error);
    // Drizzle wraps Postgres' error; the original is its `cause`.
    expect((refused as Error).cause).toMatchObject({ code: '42501' });
  });
});

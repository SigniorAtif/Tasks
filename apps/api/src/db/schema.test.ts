// Checks the first migration did what the schema says, against real Postgres.

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDb, testPool } from '../test/database.ts';
import { authAccount, authSession, authUser, profile } from './schema.ts';

beforeEach(() => resetDatabase());

async function insertUser(email: string) {
  const [user] = await testDb.insert(authUser).values({ name: 'Alice', email }).returning();
  if (!user) throw new Error('insert returned nothing');
  return user;
}

describe('the first migration', () => {
  it('creates the four auth tables and profile', async () => {
    const { rows } = await testPool.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    expect(rows.map((row) => row.tablename)).toEqual([
      'auth_account',
      'auth_session',
      'auth_user',
      'auth_verification',
      'profile',
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

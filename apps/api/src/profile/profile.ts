// The `profile` table: one row of app settings per user. Every function takes
// the user id as its first argument and filters by it, so one user's request
// can never read another user's row (A10: no row-level security yet; this
// rule, and the cross-user test, stand in for it).

import { DEFAULT_PROFILE, type Profile } from '@tasks/core';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { profile } from '../db/schema.ts';

/** Creates the user's profile with the defaults, unless it already exists. */
export async function ensureProfile(db: Database, userId: string): Promise<void> {
  await db.insert(profile).values({ userId }).onConflictDoNothing();
}

/** The user's settings, or `undefined` if they have no profile row. */
export async function findProfile(db: Database, userId: string): Promise<Profile | undefined> {
  const [row] = await db
    .select({ tzid: profile.tzid, dayBoundary: profile.dayBoundary })
    .from(profile)
    .where(eq(profile.userId, userId));
  if (!row) return undefined;
  // Postgres returns `time` as `HH:MM:SS`; the contract's WallTime is `HH:MM`.
  return { tzid: row.tzid, dayBoundary: row.dayBoundary.slice(0, 5) };
}

/**
 * The user's settings, creating the defaults first if the row is missing (say,
 * the sign-in hook that normally creates it failed). Reading never fails just
 * because a profile was never written.
 */
export async function getProfile(db: Database, userId: string): Promise<Profile> {
  const existing = await findProfile(db, userId);
  if (existing) return existing;
  await ensureProfile(db, userId);
  return (await findProfile(db, userId)) ?? DEFAULT_PROFILE;
}

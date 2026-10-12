// The `profile` table: one row of app settings per user. Every function takes
// the user id as its first argument and filters by it, so one user's request
// can never read another user's row (A10: no row-level security yet; this
// rule, and the cross-user test, stand in for it).

import type { Database } from '../db/client.ts';
import { profile } from '../db/schema.ts';

/** Creates the user's profile with the defaults, unless it already exists. */
export async function ensureProfile(db: Database, userId: string): Promise<void> {
  await db.insert(profile).values({ userId }).onConflictDoNothing();
}

// Writes a timetable file (D-020, `packages/core/src/timetable.ts`) into the
// local database for one user: how Atif's real timetable gets onto his own
// machine without ever being committed. `scripts/seed.ts` is the command;
// this is the part tests can call.
//
// The rows go through the same create schemas and repository functions as
// `POST /api/v1/groups` and `/series`, inside `withUser`, so row-level security
// applies and the seed can't write anything the API itself would refuse.

import {
  createGroupSchema,
  createSeriesSchema,
  timetableFileSchema,
  timetableToRows,
} from '@tasks/core';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { isLocalOrigin } from '../auth/dev-session.ts';
import type { Database } from '../db/client.ts';
import { authUser } from '../db/schema.ts';
import { withUser } from '../db/user-scope.ts';
import type { Env } from '../env.ts';
import { createGroup, deleteGroupsNamed } from './groups.ts';
import { createSeries } from './series.ts';

/** A seed that can't go ahead. The message is for the person at the terminal. */
export class SeedError extends Error {
  override name = 'SeedError';
}

/** This machine. A URL keeps the brackets around an IPv6 address: `postgres://[::1]:5432`. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Why the seed must not run with these settings, or `undefined` if it may.
 * Both the database and the app must be on this machine: a seed is for
 * development, never a way to write into a server's database.
 */
export function seedRefusal(
  env: Pick<Env, 'DATABASE_URL' | 'BETTER_AUTH_URL'>,
): string | undefined {
  const host = new URL(env.DATABASE_URL).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    return `DATABASE_URL points at ${host}, and seeding is only for a database on this machine`;
  }
  if (!isLocalOrigin(env.BETTER_AUTH_URL)) {
    return `BETTER_AUTH_URL is ${env.BETTER_AUTH_URL}, and seeding is only for a local app`;
  }
  return undefined;
}

export interface SeedResult {
  email: string;
  groups: number;
  series: number;
  /** Groups deleted first because the file has groups with their names. */
  replaced: number;
}

/**
 * Checks `file` (parsed JSON) and writes it for the user with `email` (default:
 * the first allowed email), in one transaction: their groups with the same
 * names are deleted, then the file's groups and series are inserted. Running
 * it twice leaves the same timetable, with new ids.
 */
export async function seedTimetable(
  deps: { env: Env; db: Database },
  file: unknown,
  email: string = deps.env.AUTH_ALLOWED_EMAILS[0] ?? '',
): Promise<SeedResult> {
  const refusal = seedRefusal(deps.env);
  if (refusal) throw new SeedError(`seed refuses to run: ${refusal}.`);

  // Paths and rules only: the messages never repeat a value from the file.
  const parsed = timetableFileSchema.safeParse(file);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(the whole file)'}: ${issue.message}`,
    );
    throw new SeedError(['The timetable file has problems:', ...lines].join('\n'));
  }

  const address = email.trim().toLowerCase();
  const [user] = await deps.db
    .select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.email, address));
  if (!user) {
    throw new SeedError(
      `There is no user ${address} yet: sign in once or run \`pnpm --filter @tasks/api dev:session ${address}\` first.`,
    );
  }

  // Exactly what `POST` would store: the create schemas fill defaults and normalise.
  const rows = timetableToRows(parsed.data, uuidv7);
  const groups = rows.groups.map((group) => createGroupSchema.parse(group));
  const series = rows.series.map((row) => {
    const checked = createSeriesSchema.parse(row);
    return { ...checked, tzid: checked.tzid ?? parsed.data.tzid };
  });

  const replaced = await withUser(deps.db, user.id, async (scope) => {
    const deleted = await deleteGroupsNamed(
      scope,
      groups.map((group) => group.name),
    );
    for (const group of groups) await createGroup(scope, group);
    for (const row of series) await createSeries(scope, row);
    return deleted;
  });
  return { email: address, groups: groups.length, series: series.length, replaced };
}

/** "Seeded 2 groups and 20 series for you@example.com." Counts only, never names. */
export function describeSeed(result: SeedResult): string {
  const groups = (n: number) => `${n} group${n === 1 ? '' : 's'}`;
  const replaced = result.replaced > 0 ? `, replacing ${groups(result.replaced)}` : '';
  return `Seeded ${groups(result.groups)} and ${result.series} series for ${result.email}${replaced}.`;
}

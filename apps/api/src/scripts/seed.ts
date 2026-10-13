// pnpm --filter @tasks/api seed <file.json> [email]
// pnpm --filter @tasks/api seed:sample [email]    fixtures/sample-timetable.json (made up)
// pnpm --filter @tasks/api seed:private [email]   private/kiit-sem3.json (git-ignored)
//
// Writes a timetable file into the LOCAL database for one user, by default the
// first AUTH_ALLOWED_EMAILS entry, who must have signed in once (or have a
// dev:session). Run it again after editing the file: it replaces that user's
// groups with the same names. A relative path is read from the repo root,
// wherever the command runs. It prints counts only, never the file's contents,
// and refuses to run unless the database and the app are on this machine.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describeSeed, SeedError, seedRefusal, seedTimetable } from '../calendar/seed.ts';
import { createDb } from '../db/client.ts';
import { pgErrorOf } from '../db/pg-errors.ts';
import { createPool } from '../db/pool.ts';
import { loadEnv } from '../env.ts';

/** apps/api/src/scripts → the repo root. */
const repoRoot = path.resolve(import.meta.dirname, '../../../..');

const [fileArg, email] = process.argv.slice(2);
if (!fileArg) {
  console.error('usage: pnpm --filter @tasks/api seed <file.json> [email]');
  process.exit(2);
}

const env = loadEnv();
// Checked before anything connects, so a wrong database is never touched.
const refusal = seedRefusal(env);
if (refusal) {
  console.error(`seed refuses to run: ${refusal}.`);
  process.exit(1);
}

const filePath = path.resolve(repoRoot, fileArg);
const shownPath = path.relative(repoRoot, filePath);
let file: unknown;
try {
  file = JSON.parse(await readFile(filePath, 'utf8'));
} catch (error) {
  // Not the parser's message: it quotes the text around the mistake.
  const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
  console.error(`seed: ${shownPath} ${missing ? 'does not exist' : 'is not valid JSON'}.`);
  process.exit(1);
}

const pool = createPool(env.DATABASE_URL);
try {
  const result = await seedTimetable({ env, db: createDb(pool) }, file, email);
  console.log(describeSeed(result));
} catch (error) {
  if (error instanceof SeedError) console.error(error.message);
  // It all happens in one transaction, so a failure halfway leaves no half timetable.
  else console.error(`seed failed: ${reason(error)}. Nothing was written.`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

/**
 * What went wrong, without the file's contents. A failed query's message
 * includes its parameters (the titles and rooms being inserted), so only
 * Postgres' code or the connection error underneath is shown.
 */
function reason(error: unknown): string {
  const pg = pgErrorOf(error);
  if (pg) return `Postgres error ${pg.code}${pg.constraint ? ` (${pg.constraint})` : ''}`;
  if (error instanceof DrizzleQueryError) {
    return error.cause instanceof Error ? error.cause.message : 'a database query failed';
  }
  return error instanceof Error ? error.message : String(error);
}

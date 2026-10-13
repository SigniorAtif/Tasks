// Applies the SQL files in `apps/api/drizzle/` that this database hasn't seen
// yet, in order, each inside a transaction. Drizzle records what it applied in
// the `drizzle.__drizzle_migrations` table, so running it twice is harmless.

import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { createDb } from './client.ts';

/**
 * Found relative to this file, not the current directory, so it works from
 * `apps/api` (pnpm scripts), the repo root (tests) and `/app` in the image.
 */
export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

export async function runMigrations(pool: Pool): Promise<void> {
  await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_FOLDER });
}

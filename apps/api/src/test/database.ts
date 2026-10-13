import type { Pool } from 'pg';
import { afterAll } from 'vitest';
import { createDb } from '../db/client.ts';
import { createPool } from '../db/pool.ts';
import { testDatabaseUrl } from './env.ts';

/** One pool per test file, connected to the test database and closed when the file is done. */
export const testPool = createPool(testDatabaseUrl());
afterAll(() => testPool.end());

export const testDb = createDb(testPool);

/**
 * Empties every table in the `public` schema (the migration bookkeeping lives
 * in the `drizzle` schema and stays). Listing the tables from Postgres means a
 * new table can never be forgotten here.
 */
export async function resetDatabase(pool: Pool = testPool): Promise<void> {
  const { rows } = await pool.query<{ name: string }>(
    `select format('%I', tablename) as name from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  await pool.query(`truncate ${rows.map((row) => row.name).join(', ')} cascade`);
}

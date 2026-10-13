// Drizzle on top of the pg pool: queries written in TypeScript, checked
// against the schema at compile time, sent as plain SQL over the pool.

import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema.ts';

export function createDb(pool: Pool) {
  return drizzle({ client: pool, schema });
}

export type Database = ReturnType<typeof createDb>;

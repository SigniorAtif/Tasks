// `pnpm db:migrate`, or `node apps/api/src/db/migrate.ts` in the image:
// bring the database at DATABASE_URL up to date, then exit.

import { loadEnv } from '../env.ts';
import { createLogger } from '../logger.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrations.ts';
import { createPool } from './pool.ts';

const env = loadEnv();
const logger = createLogger(env);
const pool = createPool(env.DATABASE_URL);

try {
  await runMigrations(pool);
  logger.info({ folder: MIGRATIONS_FOLDER }, 'migrations applied');
} catch (error) {
  logger.error({ err: error }, 'migrations failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}

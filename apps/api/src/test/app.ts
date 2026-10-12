import { createApp } from '../app.ts';
import { createAuth } from '../auth/auth.ts';
import type { Env } from '../env.ts';
import { testDb, testPool } from './database.ts';
import { testEnv } from './env.ts';
import { captureLogs } from './logs.ts';

/** The fixed "now" every test app reports. */
export const TEST_NOW = new Date('2026-10-12T04:30:00.000Z');

/** Builds the real app against the test database, with a fixed clock and captured logs. */
export function createTestApp(options: { env?: Env } = {}) {
  const env = options.env ?? testEnv();
  const logs = captureLogs();
  const auth = createAuth({ env, db: testDb, logger: logs.logger });
  const app = createApp({
    env,
    logger: logs.logger,
    pool: testPool,
    db: testDb,
    auth,
    now: () => TEST_NOW,
  });
  return { app, env, auth, logs };
}

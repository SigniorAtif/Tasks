import { afterAll } from 'vitest';
import { createApp } from '../app.ts';
import { createPool } from '../db/pool.ts';
import type { Env } from '../env.ts';
import { testDatabaseUrl, testEnv } from './env.ts';
import { captureLogs } from './logs.ts';

/** The fixed "now" every test app reports. */
export const TEST_NOW = new Date('2026-10-12T04:30:00.000Z');

/** One pool per test file, closed when the file is done. */
const pool = createPool(testDatabaseUrl());
afterAll(() => pool.end());

/** Builds the real app against the test database, with a fixed clock and captured logs. */
export function createTestApp(options: { env?: Env } = {}) {
  const env = options.env ?? testEnv();
  const logs = captureLogs();
  const app = createApp({ env, logger: logs.logger, pool, now: () => TEST_NOW });
  return { app, env, pool, logs };
}

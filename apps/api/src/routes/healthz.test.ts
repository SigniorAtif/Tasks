import type { Healthz } from '@tasks/core';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createAuth } from '../auth/auth.ts';
import { createDb } from '../db/client.ts';
import { createPool } from '../db/pool.ts';
import { createTestApp, TEST_NOW } from '../test/app.ts';
import { testEnv } from '../test/env.ts';
import { captureLogs } from '../test/logs.ts';

describe('GET /healthz', () => {
  it('reports the commit, a working database and the time in UTC', async () => {
    const { app } = createTestApp({ env: testEnv({ GIT_SHA: 'abc1234' }) });
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()) as Healthz).toEqual({
      sha: 'abc1234',
      dbOk: true,
      time: '2026-10-12T04:30:00.000Z',
    });
  });

  describe('when the database is unreachable', () => {
    // Nothing listens on port 1, so every connection attempt is refused at once.
    const deadPool = createPool('postgres://tasks:tasks@127.0.0.1:1/tasks_test');
    afterAll(() => deadPool.end());

    it('answers 503 with the same shape', async () => {
      const env = testEnv();
      const { logger } = captureLogs();
      const db = createDb(deadPool);
      const auth = createAuth({ env, db, logger });
      const app = createApp({ env, logger, pool: deadPool, db, auth, now: () => TEST_NOW });
      const response = await app.request('/healthz');
      expect(response.status).toBe(503);
      expect((await response.json()) as Healthz).toEqual({
        sha: 'dev',
        dbOk: false,
        time: '2026-10-12T04:30:00.000Z',
      });
    });
  });
});

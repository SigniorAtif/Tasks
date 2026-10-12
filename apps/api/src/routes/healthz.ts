// `GET /healthz`: is this server up, which commit is it, and can it reach the
// database? Docker's health check, the deploy smoke test and uptime monitors
// call it. Public: it reveals nothing a visitor couldn't learn anyway.

import { type Healthz, paths } from '@tasks/core';
import type { Hono } from 'hono';
import type { Pool } from 'pg';
import { pingDatabase } from '../db/pool.ts';
import type { Env } from '../env.ts';
import type { AppEnv } from '../http/context.ts';

export function healthzRoute(
  app: Hono<AppEnv>,
  deps: { env: Env; pool: Pool; now: () => Date },
): void {
  app.get(paths.healthz, async (c) => {
    const dbOk = await pingDatabase(deps.pool);
    const body: Healthz = {
      sha: deps.env.GIT_SHA,
      dbOk,
      // toISOString() is always UTC with a `Z`, as the contract requires.
      time: deps.now().toISOString(),
    };
    // A stale cached "healthy" would defeat the point.
    c.header('Cache-Control', 'no-store');
    // 503 = "temporarily unable": monitors and `docker compose --wait` treat it as unhealthy.
    return c.json(body, dbOk ? 200 : 503);
  });
}

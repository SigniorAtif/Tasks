// `GET /api/v1/me`: who is signed in, their settings, and the server's clock.
// The PWA calls it on start-up: a 200 means "show the app", a 401 means "show
// the login screen". It sits behind `requireSession`, so `c.get('user')` is set.

import { type Me, paths } from '@tasks/core';
import type { Hono } from 'hono';
import type { Database } from '../db/client.ts';
import type { AppEnv } from '../http/context.ts';
import { getProfile } from '../profile/profile.ts';

export function meRoute(app: Hono<AppEnv>, deps: { db: Database; now: () => Date }): void {
  app.get(paths.me, async (c) => {
    // The user id comes from the session, never from the request: nobody can
    // ask for someone else's profile by changing a URL or a body.
    const user = c.get('user');
    const body: Me = {
      user,
      profile: await getProfile(deps.db, user.id),
      serverTime: deps.now().toISOString(),
    };
    // Personal data: never store it in a shared cache.
    c.header('Cache-Control', 'private, no-store');
    return c.json(body);
  });
}

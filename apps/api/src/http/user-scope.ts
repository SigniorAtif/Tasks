// The middleware in front of the calendar routes. It comes after
// `requireSession`, so the user is known, and gives handlers `c.var.asUser(fn)`:
// `withUser` bound to that user. A handler can't pick a different user id,
// because it never passes one.
//
// Everything these routes answer is one person's timetable, so it also marks
// every response, errors included, as never to be stored in a shared cache.

import type { MiddlewareHandler } from 'hono';
import type { Database } from '../db/client.ts';
import { withUser } from '../db/user-scope.ts';
import type { AppEnv } from './context.ts';

export function userScope(db: Database): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const userId = c.get('user').id;
    c.set('asUser', (fn) => withUser(db, userId, fn));
    await next();
    // After `next()`, so it lands on whatever response was made, 204s and
    // problem responses too (like the request id in `requestContext`).
    c.header('Cache-Control', 'private, no-store');
  };
}

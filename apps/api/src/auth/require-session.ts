// The gate in front of the API: every `/api/*` request except Better Auth's
// own `/api/auth/*` routes needs a valid session cookie. No session → 401,
// even for paths that don't exist, so a stranger can't map out our routes.

import { paths } from '@tasks/core';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../http/context.ts';
import { AppError } from '../http/errors.ts';
import { isEmailAllowed } from './allowlist.ts';
import type { Auth } from './auth.ts';

export function requireSession(
  auth: Auth,
  allowedEmails: readonly string[],
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.path.startsWith(`${paths.auth}/`)) return next();

    // Reads the cookie, checks its signature, looks the session up in Postgres
    // and, once a day, pushes its expiry 30 days out (the "sliding" part).
    const { headers, response: session } = await auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    // When the expiry slides, Better Auth re-sends the cookie with a fresh
    // Max-Age; when the session is gone, it clears the cookie. Pass either on,
    // or the browser would drop the cookie 30 days after sign-in regardless.
    for (const cookie of headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });

    if (!session) throw new AppError('unauthenticated');
    // Taken off the allowlist after signing in: the session still exists, but it's no longer enough.
    if (!isEmailAllowed(allowedEmails, session.user.email)) {
      throw new AppError('forbidden', {
        detail: 'This account is no longer allowed to use the app.',
      });
    }

    c.set('user', {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image ?? null,
    });
    await next();
  };
}

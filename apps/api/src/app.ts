// Builds the HTTP app from its dependencies. Nothing here opens a port or reads
// `process.env`: `main.ts` does that. Tests build the same app with their own
// dependencies (a test database, a fixed clock) and call `app.request(...)`
// directly, with no network involved.

import { paths } from '@tasks/core';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import type { Pool } from 'pg';
import type { Auth } from './auth/auth.ts';
import { requireSession } from './auth/require-session.ts';
import type { Database } from './db/client.ts';
import type { Env } from './env.ts';
import { type AppEnv, requestContext } from './http/context.ts';
import { onError, onNotFound } from './http/errors.ts';
import type { Logger } from './logger.ts';
import { healthzRoute } from './routes/healthz.ts';

export interface AppDeps {
  env: Env;
  logger: Logger;
  pool: Pool;
  db: Database;
  auth: Auth;
  /** The clock. Tests pass a fixed one so responses are predictable. */
  now: () => Date;
}

/** Bigger bodies are refused before anyone reads them (413). */
const MAX_BODY_BYTES = 256 * 1024;

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const { env, logger, pool, auth, now } = deps;
  const app = new Hono<AppEnv>();

  // Middleware runs top to bottom on the way in and bottom to top on the way
  // out, like layers of an onion. The request context goes first so that
  // every later step (and every error) has a request id to log and return.
  app.use(requestContext(logger));
  app.use(secureHeaders());
  app.use(bodyLimit({ maxSize: MAX_BODY_BYTES }));

  // Public.
  healthzRoute(app, { env, pool, now });

  // Better Auth's routes: sign-in, the Google callback, sign-out, get-session.
  // It checks the origin of state-changing requests itself.
  app.on(['GET', 'POST'], `${paths.auth}/*`, (c) => auth.handler(c.req.raw));

  // Everything else under /api needs a session.
  app.use('/api/*', requireSession(auth, env.AUTH_ALLOWED_EMAILS));
  // Our own routes refuse form-style POSTs from other sites (CSRF). JSON
  // requests from another site can't happen without CORS, which we never allow.
  app.use(`${paths.apiV1}/*`, csrf({ origin: env.BETTER_AUTH_URL }));

  app.notFound(onNotFound);
  app.onError(onError);
  return app;
}

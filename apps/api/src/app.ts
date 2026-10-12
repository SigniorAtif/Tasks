// Builds the HTTP app from its dependencies. Nothing here opens a port or reads
// `process.env`: `main.ts` does that. Tests build the same app with their own
// dependencies (a test database, a fixed clock) and call `app.request(...)`
// directly, with no network involved.

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { Env } from './env.ts';
import { type AppEnv, requestContext } from './http/context.ts';
import { onError, onNotFound } from './http/errors.ts';
import type { Logger } from './logger.ts';

export interface AppDeps {
  env: Env;
  logger: Logger;
  /** The clock. Tests pass a fixed one so responses are predictable. */
  now: () => Date;
}

/** Bigger bodies are refused before anyone reads them (413). */
const MAX_BODY_BYTES = 256 * 1024;

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const { logger } = deps;
  const app = new Hono<AppEnv>();

  // Middleware runs top to bottom on the way in and bottom to top on the way
  // out, like layers of an onion. The request context goes first so that
  // every later step (and every error) has a request id to log and return.
  app.use(requestContext(logger));
  app.use(secureHeaders());
  app.use(bodyLimit({ maxSize: MAX_BODY_BYTES }));

  app.notFound(onNotFound);
  app.onError(onError);
  return app;
}

// What every request carries through the middleware chain, and the first
// middleware, which sets it up: a request id, a logger tagged with that id,
// and one access-log line when the response is ready.

import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { Logger } from '../logger.ts';

/** The signed-in user, as `requireSession` leaves it for route handlers. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

/** Hono's typed "context variables": `c.get('requestId')` and friends. */
export interface AppEnv {
  Variables: {
    requestId: string;
    /** A child logger: every line it writes includes this request's id. */
    log: Logger;
    /** Set by `requireSession`; only routes behind it may read it. */
    user: SessionUser;
  };
}

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** A caller-supplied id is reused only if it's short and plain (no spaces or quotes to inject into logs). */
const SAFE_REQUEST_ID = /^[\w-]{1,128}$/;

export function requestContext(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    const log = logger.child({ requestId });
    c.set('requestId', requestId);
    c.set('log', log);

    const started = performance.now();
    await next();
    // Errors were already turned into a response by `onError` further in, so
    // `c.res` is always the final response here, including for 404s and 500s.
    // Setting the header after `next()` also covers responses a handler built
    // itself (Better Auth returns its own `Response` objects).
    c.header(REQUEST_ID_HEADER, requestId);

    const status = c.res.status;
    // The path only, never the query string: OAuth callbacks carry one-time codes there.
    log[status >= 500 ? 'error' : 'info'](
      {
        method: c.req.method,
        path: c.req.path,
        status,
        durationMs: Math.round((performance.now() - started) * 10) / 10,
      },
      'request',
    );
  };
}

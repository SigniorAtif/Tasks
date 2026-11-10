# Middleware

> **Builds on:** [[HTTP basics]]

A **middleware** is a function every request passes through on its way to the route that answers it. It can look at the request, add something to it, stop it with an answer of its own, or let it continue by calling `next()`. Code after `await next()` runs on the way back, once the response exists.

```ts
app.use(async (c, next) => {
  const started = performance.now();   // on the way in
  await next();                         // everything further in runs here
  log(c.res.status, performance.now() - started); // on the way out
});
```

## The onion

Picture the KIIT campus gate, then the building's reception, then the classroom door. You pass all three on the way in, and all three on the way out, in reverse order. A middleware stack works the same way: the first one registered is the outermost layer.

Our stack, outermost first (the full table is in [[API server]]): request id → security headers → body size limit → (routes for `/healthz` and `/api/auth/*`) → session gate → CSRF check → the `/me` route.

What each kind of middleware does:

| Middleware | Kind | Example |
|---|---|---|
| `requestContext` | Adds to the request, then acts on the response | Sets `requestId`; after `next()`, writes the log line and the `X-Request-Id` header |
| `secureHeaders()` | Acts on the response | Adds `X-Content-Type-Options: nosniff` to every answer |
| `bodyLimit` | Can stop the request | A 300 KB upload never reaches a route: 413 |
| `requireSession` | Can stop the request; adds to it | No cookie → 401; otherwise sets `user` for the route |

Here's the real `requestContext`, cut down to its shape. Compare it with the sketch at the top of this note:

*From `apps/api/src/http/context.ts` (shortened):*
```ts
export function requestContext(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // … pick a request id
    c.set('requestId', requestId);
    c.set('log', log);

    const started = performance.now();
    await next();
    // …
    c.header(REQUEST_ID_HEADER, requestId);
    // … then one log line with the method, path, status and time taken
  };
}
```

What to notice:
- `requestContext(logger)` isn't the middleware itself; it *returns* one (the `async (c, next) => …` function). That's how a middleware gets settings, here the logger, while keeping the `(c, next)` shape Hono expects.
- `c` is the **context**: this one request, plus a place to put things. `c.set('requestId', …)` before `next()` lets every later layer read it with `c.get('requestId')`.
- `c.header(...)` after `next()` changes the response that came back up through the layers.

## Why not put this code in each route?

Because then every route has to remember it. Forget the session check once, and that route is open to the internet. A middleware on `/api/*` protects every route under it, including the ones written next year. The same goes for logging and request ids: one place, always on.

## Order matters

The session gate runs **before** the routes under `/api/v1`, so a route can trust `c.get('user')`. The request-id layer is **outermost**, so even an error thrown deep inside has an id to log and return.

In our app, the order is simply the order of the lines in `createApp`:

*From `apps/api/src/app.ts` (shortened):*
```ts
  app.use(requestContext(logger));
  app.use(secureHeaders({ strictTransportSecurity: false }));
  app.use(bodyLimit({ maxSize: MAX_BODY_BYTES }));
  // …
  app.use('/api/*', requireSession(auth, env.AUTH_ALLOWED_EMAILS));
  // …
  app.use(`${paths.apiV1}/*`, csrf({ origin: env.BETTER_AUTH_URL }));
  meRoute(app, { db, now });
```

The first argument, when there is one, says where a middleware applies: none means every request, and `'/api/*'` means every path under `/api`. Move the `meRoute` line above `requireSession`, and the gate would never run for `/me`. The route would answer first, find no `user` set, and crash with a 500. A route that didn't need `user` would quietly answer strangers.

## Check yourself
- `requestContext` measures the duration around `await next()`. If the session gate rejects a request with 401, is that request logged? With which status?
- Where would you add a middleware that rejects requests from clients older than version 0.2 (03 §5.6's `Planner-Client` header), and why there?
- What would go wrong if `bodyLimit` were registered after the routes?

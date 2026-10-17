# Structured logging

> **Builds on:** [[Middleware]]

A **log** is the program's diary: one line per notable event, written to standard output, kept by Docker on the server. **Structured** logging means each line is data (a JSON object) rather than a sentence.

Plain text:
```
GET /api/v1/me 200 16ms
```
Structured (what the API writes):
```json
{"level":30,"time":1791804583025,"requestId":"b227…","method":"GET","path":"/api/v1/me","status":200,"durationMs":16.4,"msg":"request"}
```

The second is uglier to read and far easier to *search*: "every request with `status` ≥ 500 yesterday", "everything that happened under `requestId` `b227…`". Tools filter on fields; nobody writes regular expressions over sentences. In development, `pino-pretty` prints the same lines as coloured, indented text, so you get both.

## Levels

Each line has a level: `trace` < `debug` < `info` < `warn` < `error` < `fatal` (pino writes them as numbers, 30 = info). `LOG_LEVEL=info` keeps `info` and above. Our access log line is `info` (or `error` for a 5xx); an unexpected exception is `error` with its stack.

## The request id ties it together

Every request gets an id. It's in every log line written while handling the request (a **child logger** adds it automatically), in the `X-Request-Id` response header, and in the `requestId` field of every error body ([[Error responses]]). When your phone shows "Something went wrong (request b227…)", that id finds the exact stack trace in the server log.

In our app, the child logger and the access-log line both come from the first middleware:

*From `apps/api/src/http/context.ts` (shortened):*
```ts
    const log = logger.child({ requestId });
    c.set('log', log);
    // …
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
```

What to notice:
- `logger.child({ requestId })` makes a logger that adds `requestId` to every line it writes. It's stored on the request (`c.set('log', …)`), so routes and the error handler log through the same one.
- pino's call shape is `log.info(fields, message)`: the object becomes the JSON fields and the text becomes `msg`. Together they make exactly the structured line at the top of this note.
- `status >= 500 ? 'error' : 'info'` picks the level: a 5xx is logged as `error` (pino's 50), everything else as `info` (30).

## Never log secrets

Logs get copied, shipped, pasted into issues. So:
- The access log records the **path without the query string**: Google's callback URL carries a one-time `code`.
- Cookies, `Authorization` headers and secrets are never logged by our code, and pino's **redaction** replaces them with `[redacted]` if someone logs a whole object by mistake (`logger.info({ headers })`). A test checks this.
- Better Auth's own messages go through pino too, keeping only the message and any error.

The redaction list, and where it's switched on:

*From `apps/api/src/logger.ts` (shortened):*
```ts
const REDACT_PATHS = [
  'cookie',
  'authorization',
  'password',
  'secret',
  'token',
  'headers.cookie',
  // …
  '*.headers["set-cookie"]',
  'BETTER_AUTH_SECRET',
  // …
];
// …
  const options = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
```

What to notice:
- Each entry is a path into the object being logged: `'headers.cookie'` is the `cookie` field inside `headers`, and `*` means "any field", so `'*.headers["set-cookie"]'` catches it one level further down. (`["set-cookie"]` because of the `-` in the name.)
- pino replaces the value with `'[redacted]'` before the line is written. The field name stays, so you can still see *that* a cookie was there.
- `level: env.LOG_LEVEL` is the filter from "Levels" above.

## Check yourself
- Your friend reports an error on their phone at 21:40 with request id `9f1e…`. Describe how you'd find the cause.
- Why is logging `c.req.url` instead of `c.req.path` a security bug on this app specifically?
- In which `NODE_ENV` does pino-pretty run, and why not in production?

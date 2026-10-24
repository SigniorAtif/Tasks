# Error responses

> **Builds on:** [[HTTP basics]] · [[Middleware]]

When a request fails, the API answers with an **HTTP status code** (a three-digit number the client checks first) and a **body** explaining what went wrong. The shape of that body is a contract, because clients write code against it.

## Status codes we use

| Status | Meaning | Our `code` | Example |
|---|---|---|---|
| 400 | Your request is broken | `malformed_request` | Body isn't valid JSON |
| 401 | Who are you? | `unauthenticated` | No session cookie |
| 403 | I know who you are; no | `forbidden` | Taken off the allowlist; a cross-site form post |
| 404 | No such thing | `not_found` | Unknown route, or a row that isn't yours |
| 409 | Clashes with what's stored | `conflict` | A create whose client-made id is already taken by a row you can't see (v0.2, [[Idempotency and retries]]) |
| 413 | Too big | `malformed_request` | Body over 256 KB |
| 422 | Valid JSON, wrong content | `validation_failed` | `durationMin: "sixty"` |
| 500 | Our fault | `internal_error` | A bug, or the database fell over |
| 503 | Temporarily unavailable | (none: `/healthz` only) | Database unreachable |

The rule of thumb: **4xx means the client should change something; 5xx means the server should.** Nobody retries a 4xx as-is, while a 5xx or 503 may succeed later.

## One shape for all of them (RFC 9457)

Every error body is a **problem**, sent with `Content-Type: application/problem+json` (D-043):

```json
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 422,
  "code": "validation_failed",
  "detail": "Some fields are missing or invalid.",
  "requestId": "63c5f601-…",
  "errors": [{ "path": "durationMin", "message": "Invalid input: expected number, received string" }]
}
```

- `code` is for programs. The PWA branches on it (`unauthenticated` → show login), and never on `title` or `detail`, which are for people and may get reworded.
- `requestId` matches the `X-Request-Id` header and the log line ([[Structured logging]]).
- `errors` lists each bad field, so a form can highlight it.

The shape lives in `packages/core/src/api.ts`, shared with the PWA, so a renamed field breaks the type check instead of your phone.

In our app, one function builds every one of these bodies:

*From `apps/api/src/http/errors.ts`:*
```ts
export function problemResponse(c: Context<AppEnv>, error: AppError): Response {
  const body: Problem = {
    type: 'about:blank',
    title: CODES[error.code].title,
    status: error.status,
    code: error.code,
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    requestId: c.get('requestId'),
    ...(error.errors === undefined ? {} : { errors: error.errors }),
  };
  return c.body(JSON.stringify(body), error.status, {
    'Content-Type': 'application/problem+json',
  });
}
```

What to notice:
- `const body: Problem` uses that shared type, so forgetting a required field, or misspelling one, is a type error.
- `...(x === undefined ? {} : { detail: x })` is a spread trick for "add this field only when there's a value". The JSON never contains `"detail": null` or an empty `errors`.
- `c.body(text, status, headers)` sends the text with our own `Content-Type`, `application/problem+json`, which tells a client it's an error body before it reads a byte of it.

## One place turns errors into responses

Code anywhere throws `new AppError('forbidden', { detail: 'Not your calendar.' })`, and nothing builds error responses itself. `app.onError` in `http/errors.ts` catches everything and maps it:

- `AppError` → its code and status.
- Hono's own errors (body too large, CSRF) → the matching code, by status.
- A zod validation error → 422 with `errors[]`.
- **Anything else** → 500 `internal_error`. The stack trace goes to the log under the request id, and the client gets only the id. A test throws an error that mentions a password and checks the client never sees it.

A real throw, and the handler that catches it:

```ts
// apps/api/src/auth/require-session.ts: one of the places that throw
      throw new AppError('forbidden', {
        detail: 'This account is no longer allowed to use the app.',
      });
// apps/api/src/http/errors.ts
export const onError: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof AppError) return problemResponse(c, error);
  if (error instanceof HTTPException) return problemResponse(c, fromHttpException(error));
  if (error instanceof ZodError) return problemResponse(c, validationFailed(error));
  // Anything else is a bug or an outage. The stack goes to the log, under the
  // request id; the client gets the id and nothing about our internals.
  c.get('log').error({ err: error }, 'unhandled error');
  return problemResponse(c, new AppError('internal_error'));
};
```

What to notice:
- The code that throws names only the `code` and, if it likes, a `detail`. The status (403) and the title come from one table in `errors.ts` (shown in [[HTTP basics]]).
- Each `instanceof` line ("was this error made by that class?") handles one kind. An error that falls through all three is unexpected, so its stack goes to the log, and the client gets a brand-new `internal_error` carrying nothing from the original.

One exception: Better Auth's routes (`/api/auth/*`) answer with Better Auth's own `{ code, message }` JSON, and failed Google sign-ins become redirects to `/login?error=<code>` ([[Auth]]).

Status codes and their families (2xx, 4xx, 5xx) are explained in [[HTTP basics]].

## Check yourself
- `/api/v1/series/123` where series 123 belongs to someone else: 403 or 404? Why do we pick the one we pick? (03 §5.6.)
- Why must the 500 body never include `error.message`?
- The PWA receives `{"code":"rate_limited"}`, a code it has never heard of. What should it do? (Hint: the comment at the top of `packages/core/src/api.ts`.)

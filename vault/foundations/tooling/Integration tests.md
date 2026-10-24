# Integration tests

> **Builds on:** [[Testing pure code]] · [[Postgres and SQL basics]]

[[Testing pure code]] covered **unit tests**: call a function, check its answer, nothing else involved. An **integration test** checks several real pieces working together: our routes, the middleware, Better Auth, Drizzle and a **real Postgres**. D-017 puts it plainly: "API integration tests run against real Postgres… no mocked DB."

## Why a real database instead of a fake?

A fake database answers however you programmed it, so it can't catch the bugs that matter here: a wrong column name, a missing foreign key, a unique constraint, `time` coming back as `04:00:00` instead of `04:00`, a cascade that doesn't cascade. All of those were checked against Postgres in v0.0. The cost is that the tests need a Postgres. On your laptop, their setup starts the compose one if it isn't running (so it needs Docker); in CI, the workflow starts a throwaway one for each run ([[CI and CD]]).

## How the API tests are set up

| Piece | File | What it does |
|---|---|---|
| Global setup | `src/test/global-setup.ts` | Runs once: creates `tasks_test` if missing, applies the migrations |
| Test env | `src/test/env.ts` | A fixed environment; only `TEST_DATABASE_URL` comes from outside. Tests never touch `DATABASE_URL` |
| Test database | `src/test/database.ts` | A pool to `tasks_test`; `resetDatabase()` empties every table before each test |
| Test app | `src/test/app.ts` | The real `createApp` with a fixed clock and a log-capturing logger |
| Fake Google | `src/test/google.ts` | Replaces `fetch`: answers Google's token endpoint, fails on any other outbound call |
| Sign-in driver | `src/test/sign-in.ts` | Plays the browser through the whole Google flow |

Each test starts from empty tables, so no test can depend on another's leftovers. Test files run **one at a time** (`fileParallelism: false`), because they share one database: one file emptying it while another reads it would cause random failures.

Both settings live in the API's Vitest config:

*From `apps/api/vitest.config.ts` (shortened):*
```ts
  test: {
    include: ['src/**/*.test.ts'],
    env: { NODE_ENV: 'test' },
    // Creates the test database before any test runs.
    globalSetup: ['src/test/global-setup.ts'],
    // The integration tests share one real Postgres database (D-017) and wipe
    // it between tests, so test files must not run at the same time.
    fileParallelism: false,
  },
```

`globalSetup` runs once for the whole run, before any test file, and that's where the database is created and migrated. Compare core's config, which has no `globalSetup` and keeps Vitest's default of running files in parallel: pure tests share nothing, so they can.

## Mock at the edge, not in the middle

The only fake is Google, because it's outside our system and can't be called from a test. Everything from the HTTP request to the SQL is real. The fake sits at the outermost possible point, the network call, so Better Auth's real code still builds the request, checks `state`, decodes the token and writes the rows.

The fake replaces `fetch` itself, the function every outgoing request goes through:

*From `apps/api/src/test/google.ts` (shortened):*
```ts
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === 'POST' && request.url === GOOGLE_TOKEN_URL) {
      tokenRequests.push(new URLSearchParams(await request.text()));
      return Response.json({
        // …
        id_token: fakeIdToken(clientId, user),
      });
    }
    throw new Error(`unexpected outbound request in a test: ${request.method} ${request.url}`);
  });
```

- `vi.stubGlobal('fetch', …)` swaps the global `fetch` for this function until the test undoes it.
- It answers exactly one request, the one Better Auth makes to Google's token endpoint, with a made-up token for the test's user.
- Anything else throws, so a test can never quietly reach the real internet.

## What v0.0's tests cover (77 tests)

Environment parsing; problem bodies and request ids; `/healthz` up and down; the migration (defaults, cascades, uniqueness); the session gate; the Google flow end to end (allowed, refused, removed from the list, forged `state`); cookie attributes; sliding expiry; CSRF; `/me`; **the cross-user test**; static file serving and caching; the dev-session helper and its localhost guard.

The cross-user test signs in two users and checks that each sees only their own profile. In v0.0 that was our stand-in for row-level security. Since v0.2 the calendar tables have the real thing, and its tests prove that a query with no filter still sees only one user's rows ([[Row-level security in our database]]).

## Check yourself
- A test passes alone but fails when the whole suite runs. Name two causes this setup is designed to prevent.
- Why does the fake Google *fail the test* on unexpected outbound requests instead of returning something harmless?
- `/me` reports `serverTime`. How can a test assert its exact value when the real clock moves?

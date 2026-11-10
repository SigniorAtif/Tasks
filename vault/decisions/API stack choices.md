# API stack choices

The pieces behind `apps/api` in v0.0, with versions (latest stable on 2026-10-12, pinned exactly) and what lost. What they do together: [[API server]], [[Database and migrations]], [[Auth]]. Earlier choices: [[Tooling choices]], [[Why no Next.js]], [[v0.0 contracts]].

| Piece | Version | Job |
|---|---|---|
| Hono + `@hono/node-server` | 4.13.13 + 2.1.4 | Routing and middleware |
| zod | 4.6.5 | Checking the environment (and request bodies from v0.2) |
| pino (+ pino-pretty in dev) | 10.4.0 (+ 13.2.0) | Logs |
| Drizzle ORM + drizzle-kit | 0.45.4 + 0.31.11 | Queries in TypeScript; migrations |
| pg (node-postgres) | 8.23.1 | The Postgres driver and pool |
| Better Auth | 1.7.7 | Google sign-in, sessions, cookies |
| uuid | 14.0.3 | UUIDv7 ids |
| Postgres (Docker) | 18.6 | The database |
| Vitest | 5.0.3 | Tests (same version as `packages/core`) |

## Hono for HTTP

Hono is small, fast and typed, and it's built on the web's standard `Request`/`Response`, so the same code runs on Node, Bun or Cloudflare. `app.request()` lets tests call the app with no server and no port. The plan picked it (03 §4).

What lost:
- Express, the one every course teaches: an older callback style, weaker types, and extra packages for what Hono has built in.
- Fastify: excellent and fast, but a heavier plugin system, and Node-only.
- NestJS: a full framework with classes and decorators. Too much ceremony for one person.

The concepts ([[Middleware]], routes, handlers) carry over to all of them.

## zod for the environment

One schema both checks the variables and produces a typed `Env` object, and a wrong `.env` stops the server at start-up with the variable's name ([[Environment variables and config]]). The same library will validate request bodies, and the plan shares zod schemas with the PWA (D-041).

Why 4.6.5 and not 4.6.6? 4.6.6 came out 19 hours earlier, and pnpm's supply-chain rule refuses packages younger than a day (a hijacked release is usually caught within hours). So it was skipped on purpose. Bump it later.

What lost: `envalid` or `@t3-oss/env-core` (env-only libraries, one more dependency for what zod already does), and reading `process.env` wherever needed (the classic way to discover a typo in production).

## pino for logs

JSON lines, very fast, built-in redaction of paths like `headers.cookie`, and child loggers that stamp every line with the request id ([[Structured logging]]).

What lost: `console.log` (plain text, no levels, nothing to search by), Winston (older, slower, more configuration), and Hono's `logger()` middleware (prints text to the console; no JSON, no redaction).

## RFC 9457 problem details for errors

It's a published standard (`application/problem+json`), so any client, including a future shell script or native app, can read our errors. One mapper in `http/errors.ts` (D-043) means every failure has the same shape, and the same `requestId` as the log line ([[Error responses]]).

What lost: an ad-hoc `{ error: "…" }`, where every route invents its own and clients parse messages; and GraphQL-style errors, since we don't use GraphQL.

One judgement call: a body over 256 KB gets HTTP **413** with code `malformed_request`, because the contract has no "too large" code. If the PWA ever needs to tell them apart, add a `payload_too_large` code to `packages/core` (an additive change).

## Drizzle 0.45 + pg

The schema is TypeScript, queries look like SQL (`db.select().from(profile).where(eq(profile.userId, id))`), and drizzle-kit writes plain `.sql` migration files you can read and review ([[Database migrations]]). It's thin: you can always see the SQL. Why 0.45 and not 1.0? 1.0 is still a release candidate, and the plan pins 0.45.

What lost:
- Prisma: great tooling, but its own schema language and a heavier engine, and migrations are less transparent.
- Kysely: a lovely typed query builder, but no schema-to-migration generator.
- Raw SQL with `pg`: the most transparent, but no types for results, and migrations by hand.

The driver is `pg`, the long-standing Node Postgres driver, and its `Pool` is what Better Auth and Drizzle both expect. `postgres` (postgres.js) is the other good option.

## Better Auth (D-058–D-060)

The risky parts of sign-in (OAuth `state`, PKCE, cookie signing, session expiry) come from a widely used library that runs *inside* our API and stores everything in *our* Postgres. No outside service holds your users.

What lost:
- Auth.js (NextAuth), which is centred on Next.js.
- Lucia, which is now a learning guide rather than a library.
- A hosted provider (Clerk, WorkOS, Supabase Auth): fast to start, but another company in the login path, and the data lives elsewhere.
- Writing it by hand: educational, and the classic way to ship a security bug.

The settings that matter: email+password off (D-059); `cookieCache` off, so every request checks the database and sign-out is instant (D-060); 30-day sliding sessions; a host-only cookie; `Secure` exactly when the origin is https; and origin checks kept on, even in tests.

The allowlist works through database hooks: `user.create.before` (no row for strangers) and `session.create.before` (no new sessions for someone removed). Better Auth 1.7 also has a `user.validateUserInfo` hook, but it only runs during sign-in flows. The database hooks also cover `dev:session`, so they won.

The cost (D-058): we own patching. Watch its security advisories, bump it monthly, and run the auth tests before every upgrade.

## Table names with an `auth_` prefix

Better Auth's `session` table would clash with v1's work sessions, so all four identity tables are `auth_*` (D-058), and Better Auth's model names are set to match the table names. See [[Database and migrations]].

## UUIDv7 ids, made in the app (D-034)

They're made without asking the database (an offline phone can create a row and keep its id), they're time-ordered (tidy indexes, and "newest first" for free), and they're fit to become the user's permanent id across a future `accounts.ahmedatif.in` (D-063).

What lost: serial integers (`1, 2, 3`: guessable, and a phone can't make one offline), UUIDv4 (random, so no ordering and scattered index writes), and ULIDs (the same idea as v7, but not a UUID, so Postgres can't store them in its 16-byte `uuid` type).

## No row-level security yet, and one cross-user test (A10)

RLS is a Postgres feature where the *database* hides rows that don't belong to the current user, even if a query forgets to filter.

It's not in v0.0. With one real user, the setup (roles, policies, passing the user id into every connection) costs a day or two and protects nobody. Instead, every query filters by the session's `user_id`, and `routes/me.test.ts` signs in two users with different profiles and checks that each sees only their own. RLS arrives before a second real person signs in.

## Check yourself
- Which of these choices would you have to revisit first if the git hook (a shell script) became a client of the API? Which ones were made with it in mind?
- What exactly would break if `cookieCache` were turned on, and when would you notice?
- Explain to a friend why a UUIDv4 primary key makes inserts slower than UUIDv7 in a large table.

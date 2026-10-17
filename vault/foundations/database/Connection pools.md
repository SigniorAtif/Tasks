# Connection pools

> **Builds on:** [[HTTP basics]] · [[Postgres and SQL basics]]

To talk to Postgres, a program opens a **connection**: a network link plus a login. Opening one takes several round trips (tens of milliseconds, more if the database is far away) and Postgres spends memory on each one it holds open.

A **connection pool** opens a few connections and keeps them. A request **borrows** one, runs its queries, and **gives it back** for the next request. Like the college library's reading room: a fixed number of seats, people sit, read, leave; nobody builds a new chair per visitor.

## Our settings (`apps/api/src/db/pool.ts`)

| Setting | Value | Why |
|---|---|---|
| `max` | 10 | One user; plenty. Postgres allows 100 by default, leaving room for migrations and psql |
| `connectionTimeoutMillis` | 5 s | When the database is down, fail fast instead of hanging the request |
| `idleTimeoutMillis` | 30 s | Close connections nobody has used for a while |

If all 10 are busy, the 11th request waits in line until one is returned (or the 5 s timeout hits).

*From `apps/api/src/db/pool.ts`:*
```ts
export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    // One user and one small server: 10 connections is plenty, and Postgres
    // allows 100 by default, so migrations and psql still get in.
    max: 10,
    // Give up quickly when the database is down, instead of hanging requests.
    connectionTimeoutMillis: 5_000,
    // Close connections nobody has used for 30 s.
    idleTimeoutMillis: 30_000,
  });
}
```

`Pool` comes from `pg`, the Postgres driver for Node. Creating it opens nothing yet: connections are opened the first time a query needs one, up to `max`. `5_000` is just `5000`; the underscore is a digit separator for readability.

## Things that follow from pooling

- **One pool per process**, created in `main.ts` and passed around. Drizzle and Better Auth both use it.
- **Idle connections can break** (Postgres restarts, the network blips). The pool reports this as an `error` event; without a listener Node would crash, so `main.ts` logs it.
- **Close it on shutdown** (`pool.end()`), or the process waits for open connections and Docker eventually kills it.
- **The health check borrows one too:** `/healthz` runs `select 1` with a 2-second cap and answers 503 if it doesn't come back.
- **Tests use their own pool** to `tasks_test`, one per test file, closed when the file ends.

The first three, as `main.ts` does them:

*From `apps/api/src/main.ts` (shortened):*
```ts
const pool = createPool(env.DATABASE_URL);
// An idle pooled connection can break (say, Postgres restarts). pg reports it
// here; without a listener Node would treat it as a crash.
pool.on('error', (error) => logger.error({ err: error }, 'idle database connection failed'));

const db = createDb(pool);
const auth = createAuth({ env, db, logger });
// … (in shutdown, once Docker sends SIGTERM)
  server.close(async (error) => {
    if (error) logger.error({ err: error }, 'error while closing the HTTP server');
    await pool.end();
    process.exit(error ? 1 : 0);
  });
```

What to notice:
- One `createPool` call for the whole process. Drizzle (`createDb`) wraps it, and Better Auth gets that same `db`, so both borrow from the same 10 connections.
- `pool.on('error', …)` registers a listener for the pool's `error` event: the error is logged instead of crashing the server.
- `server.close` first stops taking new requests and waits for the running ones; only then does `pool.end()` close the connections.

## Check yourself
- Postgres goes down for a minute. What does `/healthz` answer during that minute, and how long does each request take to find out?
- Why would creating a new `Pool` inside each request handler be a bug, even though it "works" in development?
- You run 4 copies of the API behind a load balancer. How many connections can they hold at most, and does that still fit Postgres's default limit?

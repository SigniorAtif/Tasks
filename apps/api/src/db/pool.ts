// The connection pool: a handful of open connections to Postgres that requests
// borrow and give back. Opening a connection costs a network round trip and a
// login (tens of milliseconds); borrowing one from the pool costs nothing.

import { Pool } from 'pg';

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

/**
 * Asks Postgres `select 1` and reports whether it answered within `timeoutMs`.
 * Never throws: a health check must answer "no" rather than crash.
 */
export async function pingDatabase(pool: Pool, timeoutMs = 2_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(resolve, timeoutMs, false);
  });
  const answered = pool.query('select 1').then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([answered, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

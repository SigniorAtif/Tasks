// Running queries as one user, so Postgres' row-level security applies (A10, D-034).
//
// The API's pool connects as the database owner, and the owner skips row-level
// security. `withUser` opens a transaction, names the user, and switches to the
// `tasks_app` role (migration 0002) before running anything else. From then on,
// until the transaction ends, every query can only see and write that user's
// rows in the calendar tables, even one that forgot its `where user_id = …`.
//
// Repository functions for those tables take a `UserScope`, which only
// `withUser` can make, so they can't be handed the plain owner `db` by mistake.
// They still filter by `scope.userId` themselves: two locks, so one forgotten
// filter is never a leak.

import { sql } from 'drizzle-orm';
import type { Database } from './client.ts';

/** The transaction object Drizzle passes to `db.transaction(async (tx) => …)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// A marker that exists only in the type system (it's erased before Node runs
// the file). Nothing outside this module can name it, so nothing outside it
// can build a `UserScope` without a cast.
declare const scoped: unique symbol;

/** One user's view of the database: the transaction `withUser` opened, and whose it is. */
export interface UserScope {
  /** Runs as `tasks_app` with `app.user_id` set: queries see only this user's rows. */
  readonly tx: Transaction;
  /** The signed-in user. Repositories filter by it too (defence in depth). */
  readonly userId: string;
  readonly [scoped]: true;
}

/** `withUser` with the user already filled in: what route handlers get as `c.var.asUser`. */
export type AsUser = <T>(fn: (scope: UserScope) => Promise<T>) => Promise<T>;

/**
 * Runs `fn` in one transaction as `userId`. Commits if `fn` resolves, rolls back
 * if it throws. Keep `fn` short: it holds a pooled connection until it's done.
 */
export function withUser<T>(
  db: Database,
  userId: string,
  fn: (scope: UserScope) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // `true` = local: both settings end with this transaction, so the pooled
    // connection goes back to the pool as the owner again, naming nobody.
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`set local role tasks_app`);
    return fn({ tx, userId } as UserScope);
  });
}

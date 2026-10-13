// Recognising Postgres' own errors. Postgres tags every failure with a
// five-character SQLSTATE code (`23505` = "that unique value already exists"),
// and for constraint failures it also names the constraint. Both are stable,
// unlike the English message, so code branches on them.

import { DatabaseError } from 'pg';

/** The SQLSTATE codes the API reacts to. The full list is in Postgres' docs, appendix A. */
export const SQLSTATE = {
  /** A FOREIGN KEY points at a row that isn't there (for us: another user's group). */
  foreignKeyViolation: '23503',
  /** A UNIQUE or PRIMARY KEY value is taken. */
  uniqueViolation: '23505',
  /** A CHECK constraint said no. */
  checkViolation: '23514',
} as const;

/**
 * The Postgres error behind `error`, if there is one. Drizzle wraps the
 * driver's error in its own (adding the SQL), so look through the `cause` chain.
 */
export function pgErrorOf(error: unknown): DatabaseError | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current instanceof DatabaseError) return current;
  }
  return undefined;
}

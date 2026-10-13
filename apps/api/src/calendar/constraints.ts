// When Postgres refuses a write to a calendar table, which field should the
// client fix? zod catches nearly everything first, but some rules need data
// the request doesn't carry: a PATCH that sends only `activeTo` is checked
// against the `activeFrom` already stored, and only the database has both.
// The constraint names come from migration 0001 (`apps/api/drizzle/`).

import { pgErrorOf, SQLSTATE } from '../db/pg-errors.ts';
import { AppError } from '../http/errors.ts';

interface FieldProblem {
  path: string;
  message: string;
}

/**
 * CHECK constraint → the field to name. A check that compares two fields lists
 * both sides: the one the request actually sent gets the blame.
 */
const CHECKS: Record<string, FieldProblem[]> = {
  schedule_group_name_length: [{ path: 'name', message: 'must be 1 to 80 characters' }],
  schedule_group_color_token: [
    { path: 'colorToken', message: 'must be one of the palette colours' },
  ],
  schedule_group_active_range: [
    { path: 'activeTo', message: 'must be on or after activeFrom' },
    { path: 'activeFrom', message: 'must be on or before activeTo' },
  ],
  schedule_group_attendance_threshold_pct: [
    { path: 'attendanceThresholdPct', message: 'must be from 0 to 100' },
  ],
  series_rule_freq: [{ path: 'rule', message: 'must be a daily or weekly rule' }],
  series_rule_interval: [{ path: 'rule', message: 'must have a number as its interval' }],
  series_rule_weekly_days: [{ path: 'rule', message: 'a weekly rule needs at least one day' }],
  series_title_length: [{ path: 'title', message: 'must be 1 to 80 characters' }],
  series_subject_length: [{ path: 'subject', message: 'must be 1 to 120 characters' }],
  series_until_date: [
    { path: 'untilDate', message: 'must be on or after startDate' },
    { path: 'startDate', message: 'must be on or before untilDate' },
  ],
  series_duration_min: [{ path: 'durationMin', message: 'must be from 1 to 1440 minutes' }],
};

/**
 * FOREIGN KEY constraint → the field to name. A series points at
 * `(user_id, group_id)`, so another user's group id fails exactly like an id
 * that doesn't exist: nobody learns which ids other people use.
 */
const FOREIGN_KEYS: Record<string, FieldProblem> = {
  series_group_fk: { path: 'groupId', message: 'must be one of your groups' },
};

/**
 * Turns "Postgres refused this write" into a 422 that names the field, or
 * returns `undefined` for any other error, which then stays a 500: a bug or
 * an outage, not something the client can fix. `sent` lists the fields the
 * request set.
 */
export function rejectedWrite(error: unknown, sent: readonly string[]): AppError | undefined {
  const pg = pgErrorOf(error);
  if (!pg?.constraint) return undefined;

  let problem: FieldProblem | undefined;
  if (pg.code === SQLSTATE.checkViolation) {
    const sides = CHECKS[pg.constraint] ?? [];
    problem = sides.find((side) => sent.includes(side.path)) ?? sides[0];
  } else if (pg.code === SQLSTATE.foreignKeyViolation) {
    problem = FOREIGN_KEYS[pg.constraint];
  } else {
    return undefined;
  }

  if (!problem) {
    // A constraint added later and not listed above: still the client's
    // input, still a 422, just without a field to point at.
    return new AppError('validation_failed', {
      detail: `The database refused these values (${pg.constraint}).`,
      cause: error,
    });
  }
  return new AppError('validation_failed', {
    detail: 'Some fields are missing or invalid.',
    errors: [problem],
    cause: error,
  });
}

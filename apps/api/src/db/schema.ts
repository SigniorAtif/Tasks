// The database tables, written as TypeScript. Drizzle uses this file twice:
// at runtime to build type-safe queries, and in `pnpm db:generate`, where
// drizzle-kit compares it with the last migration and writes the SQL that
// gets from there to here (into `apps/api/drizzle/`).
//
// Naming: TypeScript property names are camelCase (`emailVerified`), the
// Postgres columns are snake_case (`email_verified`). Better Auth finds
// columns by the TypeScript names, so those must match its field names.

import {
  type CancelReason,
  COLOR_TOKENS,
  type ColorToken,
  DEFAULT_COLOR_TOKEN,
  DEFAULT_PROFILE,
  type Rule,
} from '@tasks/core';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Shared column helpers
// ---------------------------------------------------------------------------

/**
 * A UUIDv7 primary key (D-034). The app generates ids itself (Better Auth's
 * `generateId`), so the database default is only a fallback for rows typed
 * in by hand; `uuidv7()` is built into Postgres 18.
 */
const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);

/** A moment in time. `timestamptz` stores an instant (UTC inside), never a local wall time. */
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const createdAt = () => instant('created_at').notNull().defaultNow();
const updatedAt = () => instant('updated_at').notNull().defaultNow();

/** A calendar day with no time or zone. Kept as the `YYYY-MM-DD` string the contract uses. */
const day = (name: string) => date(name, { mode: 'string' });

/** The owner of a row: every app table has one, and every query is limited to it. */
const ownerId = () =>
  uuid('user_id')
    .notNull()
    .references(() => authUser.id, { onDelete: 'cascade' });

/** `'a', 'b', 'c'`: a fixed list of values written into a CHECK constraint. */
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

// ---------------------------------------------------------------------------
// Identity: Better Auth's four tables (D-058). Better Auth reads and writes
// them; our code only reads `auth_user` and `auth_session` through Better Auth
// or for the allowlist check. The `auth_` prefix keeps them apart from the
// app's own tables, and `auth_session` never clashes with v1's work sessions.
// ---------------------------------------------------------------------------

/** One row per person who has signed in. Email is an attribute, not the key (06 §5.2). */
export const authUser = pgTable('auth_user', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * One row per signed-in browser (D-060). The cookie carries `token` plus a
 * signature, so deleting the row signs that browser out immediately.
 */
export const authSession = pgTable(
  'auth_session',
  {
    id: id(),
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    expiresAt: instant('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('auth_session_user_id_idx').on(table.userId)],
);

/**
 * How a user signs in: one row per provider identity (for now, their Google
 * account). Holds Google's tokens; `password` stays empty because email and
 * password sign-in is switched off (D-059), but Better Auth expects the column.
 */
export const authAccount = pgTable(
  'auth_account',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    /** `google` */
    providerId: text('provider_id').notNull(),
    /** The provider's id for this person (Google's `sub`). */
    accountId: text('account_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: instant('access_token_expires_at'),
    refreshTokenExpiresAt: instant('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('auth_account_user_id_idx').on(table.userId),
    // One Google identity can belong to only one user.
    unique('auth_account_provider_account_unique').on(table.providerId, table.accountId),
  ],
);

/**
 * Short-lived, single-use values. During Google sign-in it holds the OAuth
 * `state` and PKCE verifier for the ten minutes between "go to Google" and
 * "Google sent you back".
 */
export const authVerification = pgTable(
  'auth_verification',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: instant('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('auth_verification_identifier_idx').on(table.identifier)],
);

// ---------------------------------------------------------------------------
// The app's own tables. Every one carries `user_id` and every query filters
// by it (D-016). The calendar tables below also have row-level security
// (A10): migration 0002 makes Postgres itself hide other users' rows.
// ---------------------------------------------------------------------------

/** App settings for one user, separate from the identity tables (D-058). */
export const profile = pgTable('profile', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => authUser.id, { onDelete: 'cascade' }),
  /** IANA zone used for "today" and the calendar, e.g. `Asia/Kolkata`. */
  tzid: text('tzid').notNull().default(DEFAULT_PROFILE.tzid),
  /** When one day rolls over into the next, as a wall time in `tzid` (D-035). */
  dayBoundary: time('day_boundary').notNull().default(DEFAULT_PROFILE.dayBoundary),
  createdAt: createdAt(),
  updatedAt: updatedAt().$onUpdate(() => new Date()),
});

// ---------------------------------------------------------------------------
// The calendar (v0.2): groups own series; occurrences are computed from series
// on every read and never stored (D-021). A row in `occurrence_override` exists
// only when something was said about one occurrence (cancel, move, note).
//
// Row-level security: migration 0002 turns it on for these three tables. The
// API reads and writes them as the `tasks_app` role, inside a transaction that
// names the signed-in user, so a query can only ever see that user's rows.
//
// Composite foreign keys: a series points at `(user_id, group_id)`, not just
// `group_id`, so it can only belong to a group of the same user. Postgres checks
// foreign keys without row-level security, so this is the guard for links
// between rows; RLS is the guard for reading them.
// ---------------------------------------------------------------------------

/** "Classes · Sem 3", "Health". Decides when its series are active (D-004, D-030). */
export const scheduleGroup = pgTable(
  'schedule_group',
  {
    id: id(),
    userId: ownerId(),
    name: text('name').notNull(),
    /** One of the ten palette tokens (`COLOR_TOKENS` in core), never a hex value. */
    colorToken: text('color_token').$type<ColorToken>().notNull().default(DEFAULT_COLOR_TOKEN),
    /** First active day, inclusive. */
    activeFrom: day('active_from').notNull(),
    /** Last active day, inclusive. `null` = open-ended. */
    activeTo: day('active_to'),
    /** Whether holidays and days off cancel this group's occurrences. */
    observesHolidays: boolean('observes_holidays').notNull().default(true),
    attendance: boolean('attendance').notNull().default(true),
    attendanceThresholdPct: integer('attendance_threshold_pct').notNull().default(75),
    attendanceTrackingFrom: day('attendance_tracking_from'),
    archivedAt: instant('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt().$onUpdate(() => new Date()),
  },
  (table) => [
    // The target of the composite foreign key from `series`. Its index also
    // serves "all of this user's groups", so `user_id` needs no index of its own.
    unique('schedule_group_user_id_id_unique').on(table.userId, table.id),
    check('schedule_group_name_length', sql`char_length(${table.name}) between 1 and 80`),
    check('schedule_group_color_token', sql`${table.colorToken} in (${sqlList(COLOR_TOKENS)})`),
    check(
      'schedule_group_active_range',
      sql`${table.activeTo} is null or ${table.activeTo} >= ${table.activeFrom}`,
    ),
    check(
      'schedule_group_attendance_threshold_pct',
      sql`${table.attendanceThresholdPct} between 0 and 100`,
    ),
  ],
);

/** One timing pattern: "DS, Fridays 11:00 for 60 minutes in Asia/Kolkata" (D-021, D-024, D-025). */
export const series = pgTable(
  'series',
  {
    id: id(),
    userId: ownerId(),
    groupId: uuid('group_id').notNull(),
    title: text('title').notNull(),
    /** What attendance is counted by (B8). Defaults to the title when created. */
    subject: text('subject').notNull(),
    location: text('location'),
    /** `{ freq: 'daily', interval }` or `{ freq: 'weekly', interval, byDay }`. */
    rule: jsonb('rule').$type<Rule>().notNull(),
    startDate: day('start_date').notNull(),
    untilDate: day('until_date'),
    /** A wall-clock time in `tzid`. Postgres returns `HH:MM:SS`; the contract says `HH:MM`. */
    startTime: time('start_time').notNull(),
    durationMin: integer('duration_min').notNull(),
    tzid: text('tzid').notNull(),
    /** Set on the newer half of a split (D-023, v0.3b). */
    previousSeriesId: uuid('previous_series_id').references((): AnyPgColumn => series.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt().$onUpdate(() => new Date()),
  },
  (table) => [
    unique('series_user_id_id_unique').on(table.userId, table.id),
    // Deleting a group deletes its series.
    foreignKey({
      name: 'series_group_fk',
      columns: [table.userId, table.groupId],
      foreignColumns: [scheduleGroup.userId, scheduleGroup.id],
    }).onDelete('cascade'),
    index('series_user_id_group_id_idx').on(table.userId, table.groupId),
    // The database's own last check on the rule's shape; the API validates it
    // properly with zod first (ruleSchema in core).
    check('series_rule_freq', sql`${table.rule}->>'freq' in ('daily', 'weekly')`),
    check('series_rule_interval', sql`jsonb_typeof(${table.rule}->'interval') = 'number'`),
    check(
      'series_rule_weekly_days',
      sql`case when ${table.rule}->>'freq' <> 'weekly' then true
        when jsonb_typeof(${table.rule}->'byDay') = 'array'
          then jsonb_array_length(${table.rule}->'byDay') > 0
        else false end`,
    ),
    check('series_title_length', sql`char_length(${table.title}) between 1 and 80`),
    check('series_subject_length', sql`char_length(${table.subject}) between 1 and 120`),
    check(
      'series_until_date',
      sql`${table.untilDate} is null or ${table.untilDate} >= ${table.startDate}`,
    ),
    check('series_duration_min', sql`${table.durationMin} between 1 and 1440`),
  ],
);

/**
 * Something said about one occurrence (D-021, D-022). `modified` rows are keyed by
 * the date the rule generated (`original_date`); `extra` rows are one-off
 * occurrences the rule never generated, such as a make-up class (D-031).
 * v0.2 only reads this table; v0.3 starts writing it (cancel and skip).
 */
export const occurrenceOverride = pgTable(
  'occurrence_override',
  {
    id: id(),
    userId: ownerId(),
    seriesId: uuid('series_id').notNull(),
    kind: text('kind', { enum: ['modified', 'extra'] }).notNull(),
    originalDate: day('original_date'),
    newDate: day('new_date'),
    newStartTime: time('new_start_time'),
    /** `null` = inherit from the series. */
    status: text('status', { enum: ['scheduled', 'cancelled'] }),
    cancelReason: text('cancel_reason').$type<CancelReason>(),
    durationMin: integer('duration_min'),
    confirmedAt: instant('confirmed_at'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt().$onUpdate(() => new Date()),
  },
  (table) => [
    // One override per generated occurrence (B1). Extras have no original date,
    // and Postgres treats NULLs as different, so any number of extras fit.
    unique('occurrence_override_series_id_original_date_unique').on(
      table.seriesId,
      table.originalDate,
    ),
    // Deleting a series deletes what was said about its occurrences.
    foreignKey({
      name: 'occurrence_override_series_fk',
      columns: [table.userId, table.seriesId],
      foreignColumns: [series.userId, series.id],
    }).onDelete('cascade'),
    index('occurrence_override_user_id_idx').on(table.userId),
    check('occurrence_override_kind', sql`${table.kind} in ('modified', 'extra')`),
    check(
      'occurrence_override_shape',
      sql`(${table.kind} = 'modified' and ${table.originalDate} is not null)
        or (${table.kind} = 'extra' and ${table.originalDate} is null
          and ${table.newDate} is not null and ${table.newStartTime} is not null)`,
    ),
    check(
      'occurrence_override_status',
      sql`${table.status} is null or ${table.status} in ('scheduled', 'cancelled')`,
    ),
    check(
      'occurrence_override_cancel_reason',
      sql`${table.cancelReason} is null
        or (${table.status} = 'cancelled' and ${table.cancelReason} in ('not_held', 'skipped'))`,
    ),
    check(
      'occurrence_override_duration_min',
      sql`${table.durationMin} is null or ${table.durationMin} between 1 and 1440`,
    ),
  ],
);

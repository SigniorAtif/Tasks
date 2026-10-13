// The database tables, written as TypeScript. Drizzle uses this file twice:
// at runtime to build type-safe queries, and in `pnpm db:generate`, where
// drizzle-kit compares it with the last migration and writes the SQL that
// gets from there to here (into `apps/api/drizzle/`).
//
// Naming: TypeScript property names are camelCase (`emailVerified`), the
// Postgres columns are snake_case (`email_verified`). Better Auth finds
// columns by the TypeScript names, so those must match its field names.

import { DEFAULT_PROFILE } from '@tasks/core';
import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, time, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

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
// by it (D-016, A10).
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

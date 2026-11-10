# Database and migrations

> **Background:** [[Postgres and SQL basics]] · [[Database migrations]] · [[Connection pools]]

How the API stores data: one Postgres 18 database, eight tables, five migrations. v0.0 made the five identity and settings tables, v0.2 added the three calendar tables and row-level security, and v0.3 took a group's first day away (`0003`) and moved the day start to midnight (`0004`). Concepts behind it: [[Database migrations]], [[Connection pools]], [[Row-level security]]. Choices: [[API stack choices]], [[v0.2 contracts]].

New to databases? Read [[Postgres and SQL basics]] first: tables, keys, indexes, transactions, and how to open `psql` on our database.

## Files

| File | What it does |
|---|---|
| `compose.yaml` (repo root) | Development Postgres: image `postgres:18.6`, user/password/database `tasks`, port `127.0.0.1:5432`, a named volume, a health check |
| `apps/api/drizzle.config.ts` | Settings for drizzle-kit: schema file in, `drizzle/` out |
| `apps/api/src/db/schema.ts` | The tables, written in TypeScript |
| `apps/api/drizzle/0000_init.sql` | v0.0: the auth tables and `profile`, generated from the schema, reviewed and committed |
| `apps/api/drizzle/0001_calendar_tables.sql` | v0.2: `schedule_group`, `series`, `occurrence_override`, generated the same way |
| `apps/api/drizzle/0002_calendar_rls.sql` | v0.2: row-level security, **written by hand** (drizzle-kit can't express it). Read its comments: they explain each statement |
| `apps/api/drizzle/meta/` | drizzle-kit's bookkeeping: a snapshot of the schema after each migration, and a journal listing them in order. Generated; commit it, never edit it |
| `apps/api/src/db/pool.ts` | `createPool` (the [[Connection pools]] settings) and `pingDatabase` (`select 1`, used by `/healthz`) |
| `apps/api/src/db/client.ts` | `createDb(pool)`: Drizzle on top of the pool; `Database` is its type |
| `apps/api/src/db/migrations.ts` | `runMigrations(pool)`; finds `drizzle/` relative to its own file |
| `apps/api/src/db/migrate.ts` | The `db:migrate` command |
| `apps/api/src/db/user-scope.ts` | `withUser`: runs queries in one transaction as one user, so row-level security applies ([[Row-level security in our database]]) |
| `apps/api/src/db/pg-errors.ts` | Reads Postgres' error codes (`23505` duplicate, `23503` foreign key, `23514` check) out of Drizzle's wrapped errors |
| `apps/api/src/db/schema.test.ts` | Checks the migrations against real Postgres: defaults, cascades, uniqueness, the rule CHECKs, the composite foreign keys, and that row-level security is on and works |

## The tables

How the tables connect (only the important columns shown). `||--o{` reads "one user has zero or more sessions", and `||--o|` reads "zero or one profile".

```mermaid
erDiagram
  auth_user ||--o{ auth_session : "is signed in by"
  auth_user ||--o{ auth_account : "signs in with"
  auth_user ||--o| profile : "has settings in"
  auth_user {
    uuid id PK
    text name
    text email UK
    boolean email_verified
    text image
    timestamptz created_at
  }
  auth_session {
    uuid id PK
    text token UK
    uuid user_id FK
    timestamptz expires_at
    text ip_address
    text user_agent
  }
  auth_account {
    uuid id PK
    uuid user_id FK
    text provider_id
    text account_id
    text id_token
  }
  auth_verification {
    uuid id PK
    text identifier
    text value
    timestamptz expires_at
  }
  profile {
    uuid user_id PK, FK
    text tzid
    time day_boundary
  }
```

| Table | One row per | Written by | Notes |
|---|---|---|---|
| `auth_user` | person who signed in | Better Auth | `email` unique (Better Auth lower-cases it). Email is an attribute, not the key: KIIT addresses die after graduation |
| `auth_session` | signed-in browser | Better Auth | `token` unique (looked up on every request), `expires_at`, `ip_address`, `user_agent` |
| `auth_account` | way of signing in (your Google account) | Better Auth | `(provider_id, account_id)` unique: one Google identity → one user. Holds Google's tokens. `password` stays empty: passwords are off |
| `auth_verification` | short-lived secret | Better Auth | Holds the OAuth `state` and PKCE verifier for 10 minutes during sign-in ([[OAuth sign-in]]) |
| `profile` | user | our code | `tzid` (default `Asia/Kolkata`), `day_boundary` (default `00:00` since migration `0004`, `04:00` before) |

### The calendar tables (v0.2; groups changed in v0.3)

```mermaid
erDiagram
  auth_user ||--o{ schedule_group : owns
  schedule_group ||--o{ series : "contains (user_id, group_id)"
  series ||--o{ occurrence_override : "exceptions (user_id, series_id)"
  schedule_group {
    uuid id PK
    uuid user_id FK
    text name
    text color_token
    date until_date "null = open-ended"
  }
  series {
    uuid id PK
    uuid user_id FK
    uuid group_id FK
    text title
    text subject
    jsonb rule
    date start_date
    time start_time
    int duration_min
    text tzid
  }
  occurrence_override {
    uuid id PK
    uuid user_id FK
    uuid series_id FK
    text kind
    date original_date
  }
```

| Table | One row per | Notes |
|---|---|---|
| `schedule_group` | group ("Classes · Sem 3") | `color_token` must be one of the ten palette names; `until_date` is the group's last day, null = open-ended. No first day since migration `0003` (below) |
| `series` | repeating class ("DS, Wednesdays 10:00, 60 min") | `rule` is JSON (`{"freq": "weekly", "interval": 1, "byDay": ["WE"]}`); `start_time` is a wall-clock time in `tzid`, never an instant |
| `occurrence_override` | thing said about one occurrence | Unique on `(series_id, original_date)`; empty until v0.3's cancel button |

Three things are new compared with the v0.0 tables:
- **CHECK constraints** are rules Postgres checks on every write. `series` refuses a `freq` other than daily or weekly, a weekly rule with no days, an end date before the start, and a duration outside 1–1440 minutes. The API's zod rules catch all of these first; the CHECKs are the last line of defence if some future code forgets.
- **Composite foreign keys**: a series points at the *pair* `(user_id, group_id)` in `schedule_group`, not just at `group_id`. So a series can only belong to a group of the same user, and the database refuses "my class in your group" by itself. `schedule_group` has a unique `(user_id, id)` so that the pair can be pointed at.
- **Row-level security** on all three ([[Row-level security in our database]]): even a query with no `where` sees only the current user's rows.

The first two, as they're written in the schema:

*From `apps/api/src/db/schema.ts` (shortened):*
```ts
// in scheduleGroup: the pair (user_id, id) is unique, so it can be pointed at
    unique('schedule_group_user_id_id_unique').on(table.userId, table.id),
// in series:
    foreignKey({
      name: 'series_group_fk',
      columns: [table.userId, table.groupId],
      foreignColumns: [scheduleGroup.userId, scheduleGroup.id],
    }).onDelete('cascade'),
    // …
    check('series_rule_freq', sql`${table.rule}->>'freq' in ('daily', 'weekly')`),
    // …
    check('series_duration_min', sql`${table.durationMin} between 1 and 1440`),
```

What to notice:
- `columns: [userId, groupId]` must match `foreignColumns: [scheduleGroup.userId, scheduleGroup.id]` *as a pair*. Your `user_id` with Bob's group id is a pair that doesn't exist, so Postgres refuses it.
- ``sql`…` `` is Drizzle's way of writing raw SQL, and `${table.rule}` becomes the column's name. `->>'freq'` is Postgres for "the `freq` field of this JSON, as text".
- Every constraint has a name (`'series_duration_min'`). When Postgres refuses a write, its error names the constraint, and `calendar/constraints.ts` turns that name into a 422 for the right field (`durationMin`).

Deleting a group deletes its series, and deleting a series deletes its overrides (`on delete cascade`).

What's **not** stored: the occurrences themselves. "DS on 14 Oct" is computed from the series on every request ([[Recurrence engine]]).

Every table has `created_at` and `updated_at` as `timestamptz`: an instant, stored in UTC, never a wall-clock time ([[Dates, times and instants]]).

Every `user_id` column is a **foreign key** to `auth_user.id` with `on delete cascade`. A foreign key is a promise the database enforces, "this value must exist over there", so you can't create a profile for a user who doesn't exist. Cascade means deleting a user deletes their sessions, accounts and profile in the same statement, so nothing is left pointing at nobody. `schema.test.ts` checks it.

Here's `profile` in TypeScript, then the SQL drizzle-kit generated from it:

*From `apps/api/src/db/schema.ts`:*
```ts
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
```

*From `apps/api/drizzle/0000_init.sql` (shortened):*
```sql
CREATE TABLE "profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tzid" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"day_boundary" time DEFAULT '04:00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- …
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
```

What to notice:
- `.references(() => authUser.id, { onDelete: 'cascade' })` became the separate `ALTER TABLE … FOREIGN KEY … ON DELETE cascade` at the end of the file. drizzle-kit creates every table first and adds the foreign keys after, so the order of the tables doesn't matter.
- `DEFAULT_PROFILE.tzid` (from `packages/core`) was copied into the SQL as the plain text `'Asia/Kolkata'` when the migration was generated. Changing it in core later changes nothing in the database until a new migration is generated.
- `.$onUpdate(() => new Date())` has no SQL at all. Drizzle fills `updated_at` itself when *our code* updates a row, and an `UPDATE` typed into psql leaves it alone.

**Indexes** (a sorted copy of one column that makes lookups fast, like the index at the back of a textbook) exist on every `user_id`, on `auth_session.token` and on `auth_verification.identifier`: the columns queries search by.

### Why the `auth_` prefix?

Better Auth would call its tables `user`, `session`, `account` and `verification`. In v1 the app gets *work sessions* (a timer running while you study), and "session" would mean two things. D-058 renamed them. The prefix also makes the identity tables easy to spot and keep separate from the app's own ones, which is the boundary a future shared login at `accounts.ahmedatif.in` would cut along (D-063).

### Why UUIDv7 ids?

An id looks like `01a1307f-b42d-7297-9423-bf3e74a4aa70`. A **UUID** is a 128-bit random-looking id that any computer can make without asking the database, with no realistic chance of two being equal. **Version 7** starts with the current time in milliseconds, so ids made later sort later: Postgres's index stays tidy, and "newest first" is just "biggest id first". The app makes them (the `uuid` package, through Better Auth's `generateId`), and the columns also default to Postgres 18's built-in `uuidv7()` in case a row is ever typed in by hand. Alternatives in [[API stack choices]].

```ts
// apps/api/src/db/schema.ts: every table's id column
const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
// apps/api/src/auth/auth.ts: the ids Better Auth makes for its rows
      database: { generateId: () => uuidv7() },
```

There are two different `uuidv7()`s here. In `schema.ts` it's SQL text (inside ``sql`…` ``), copied into each migration as `DEFAULT uuidv7()` for Postgres to run. In `auth.ts` it's the `uuid` package's function (`import { v7 as uuidv7 } from 'uuid'`), run by Node. Same kind of id either way.

## Naming

TypeScript uses camelCase (`emailVerified`), and Postgres uses snake_case (`email_verified`). `schema.ts` maps each one explicitly: `emailVerified: boolean('email_verified')`. Better Auth finds columns by the TypeScript names, so those must match its own field names.

*From `apps/api/src/db/schema.ts`:*
```ts
export const authUser = pgTable('auth_user', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
```

Each line reads `nameInTypeScript: columnType('name_in_postgres')`, then the rules: `.notNull()`, `.unique()` and `.default(false)` become `NOT NULL`, `UNIQUE` and `DEFAULT false` in the SQL. `id()`, `createdAt()` and `updatedAt()` are small helpers at the top of the file, so every table spells those columns the same way.

## Changing the schema (the routine)

```mermaid
flowchart LR
  edit["edit src/db/schema.ts"] --> gen["pnpm db:generate<br/>drizzle-kit writes drizzle/000N_name.sql"]
  gen --> review["read the SQL line by line<br/>fix the schema if anything is odd"]
  review --> commit["commit schema, SQL and meta/ together"]
  commit --> apply["applied by pnpm db:migrate (dev)<br/>or deploy.sh's migrate step (server)"]
  apply --> log[("drizzle.__drizzle_migrations<br/>remembers what already ran")]
```

1. Edit `src/db/schema.ts`.
2. `pnpm --filter @tasks/api db:generate --name add_reminders` writes the next file, e.g. `drizzle/0004_add_reminders.sql`.
3. **Read the SQL line by line.** It's what will run on your real data. Look for a `DROP` you didn't mean, a `NOT NULL` column added to a table that already has rows (it fails), or a missing index.
4. `pnpm db:migrate`, run the tests, and commit the schema change, the SQL and `meta/` together.

   `db:migrate` (and the server's deploy step) ends up here:

   *From `apps/api/src/db/migrations.ts`:*
   ```ts
   export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

   export async function runMigrations(pool: Pool): Promise<void> {
     await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_FOLDER });
   }
   ```

   `import.meta.dirname` is the folder this file sits in (`apps/api/src/db`), so `../../drizzle` is always `apps/api/drizzle`, whichever folder you run the command from. `migrate` is Drizzle's: it reads the journal in `drizzle/meta/`, checks `drizzle.__drizzle_migrations` for what this database already has, and runs only the newer files, in order.

Never edit a migration that has already been applied anywhere. Write a new one.

**SQL drizzle-kit can't write** (row-level security, roles, functions): `pnpm --filter @tasks/api db:generate --custom --name <what>` makes an empty numbered file that you fill by hand, which is how `0002_calendar_rls.sql` was made. It's applied in order like the others. Statements are separated by a `--> statement-breakpoint` line, because Drizzle runs them one by one.

*From `apps/api/drizzle/0002_calendar_rls.sql` (shortened):*
```sql
CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
-- …
ALTER TABLE series ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE series FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY series_owner ON series
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
```

To Postgres, `--> statement-breakpoint` is just a comment (anything after `--`); to Drizzle, it's the cut between two statements. What the function and the policy mean is in [[Row-level security in our database]].

### A rename drizzle-kit has to ask about: migration `0003`

In v0.3 a group stopped having a first day (ADR v0.3). In `schema.ts` that was three edits to `scheduleGroup`: delete `activeFrom` and `archivedAt`, and turn `activeTo: day('active_to')` into `untilDate: day('until_date')`, the name the series already uses for its own last day.

Run `db:generate` after that and drizzle-kit stops to ask a question. It compares `schema.ts` with the last snapshot in `drizzle/meta/` and sees one column gone (`active_to`) and one new (`until_date`). That could mean two very different things:

| drizzle-kit's guess | The SQL | What happens to the data |
|---|---|---|
| a **rename** | `RENAME COLUMN "active_to" TO "until_date"` | Every semester keeps its last day; only the label changes |
| a **drop and an add** | `DROP COLUMN "active_to"` then `ADD COLUMN "until_date" date` | Every last day is deleted, and the new column starts empty |

It can't tell which you meant, so it asks, with an arrow-key menu. That menu needs a **TTY**, a real terminal you can type into. Our agent's shell has none, so `db:generate` stopped with "Interactive prompts require a TTY terminal". In your own terminal you'd pick "rename" and get the SQL below written for you.

Without a terminal, the way through was the custom route from above:
1. `db:generate --custom --name groups_without_first_day` writes an empty `0003_groups_without_first_day.sql`, the journal entry, and `meta/0003_snapshot.json`. That snapshot is a copy of the previous one, so it still has the old columns.
2. Write the SQL by hand.
3. Edit the snapshot to match the new schema: drop the two columns and the check, and rename `active_to`.
4. Run `db:generate` again. "No schema changes, nothing to migrate" proves the snapshot and `schema.ts` agree, so the next migration will be computed from the right starting point.

*From `apps/api/drizzle/0003_groups_without_first_day.sql`:*
```sql
ALTER TABLE "schedule_group" DROP CONSTRAINT "schedule_group_active_range";--> statement-breakpoint
ALTER TABLE "schedule_group" DROP COLUMN "active_from";--> statement-breakpoint
ALTER TABLE "schedule_group" DROP COLUMN "archived_at";--> statement-breakpoint
-- The series' column for the same idea is `until_date`, so the group's matches it.
ALTER TABLE "schedule_group" RENAME COLUMN "active_to" TO "until_date";
```

What to notice:
- The check goes first. `schedule_group_active_range` compared `active_to` with `active_from`; once `active_from` is gone, the check has nothing to compare.
- Two of these lines **delete data** on purpose: every group's first day and archive time. That is the "read the SQL line by line" step earning its keep: each `DROP` here is meant.
- The rename keeps every value. An old group that ended on 27 Nov still ends on 27 Nov.

**The rule this migration breaks, once.** D-066 says migrations are **expand-only**: they add, never remove. The reason is rollback. `deploy.sh` migrates the database, starts the new app, and if the health check fails, it starts the *old* app again. The database stays migrated: nothing un-runs a migration. So the old app must still work against the new tables. An added column is harmless to old code, which never asks for it. A dropped column is not: the old app's `select` names `active_from`, and Postgres answers "column does not exist" on every request.

The safe way is **expand/contract**, over two releases:
1. **Expand.** Add `until_date`, copy `active_to` into it, and make the new app read and write `until_date`. The old columns stay, so the old app still runs if you roll back.
2. **Contract**, a release later, once nobody will roll back past step 1. Drop `active_from`, `active_to` and `archived_at`.

v0.3 did it in one step because nothing is deployed yet: there's no server and no older app to roll back to, and the only copy of the data is on this laptop, where the seed can rebuild it. ADR v0.3's "Contradicts" line records the exception. Once the server holds your real semester, a change like this gets the two releases.

### A changed default, and the rows it doesn't reach: migration `0004`

The day boundary's default moved from 04:00 to midnight ([[The user's day]], [[Groups screen choices]]). In code that's one value, `DEFAULT_PROFILE.dayBoundary` in `packages/core/src/api.ts`. As the `0000` notes above say, the database doesn't follow core by itself: `schema.ts` reads that value, so `db:generate --name midnight_day_start` saw a new default and wrote the `ALTER`. The `UPDATE` was added by hand.

*From `apps/api/drizzle/0004_midnight_day_start.sql`:*
```sql
ALTER TABLE "profile" ALTER COLUMN "day_boundary" SET DEFAULT '00:00';--> statement-breakpoint
-- Nothing in the app can set a day boundary yet, so every 04:00 is the old
-- default, not a choice: move those profiles to midnight too.
UPDATE "profile" SET "day_boundary" = '00:00' WHERE "day_boundary" = '04:00';
```

What to notice:
- A column's `DEFAULT` is only used when a row is **inserted** without a value. Your profile was made on your first sign-in with `04:00` written into it, so changing the default alone would leave you on 04:00. That's why the `UPDATE` is there.
- drizzle-kit compares schemas, never data, so it can't know existing rows should change. A data change in a migration is always written by hand, and read twice.
- `WHERE "day_boundary" = '04:00'` moves only the old default. A profile set to 03:00 (a test sets one) stays as it is, because that would have been someone's choice.
- It's expand-safe, unlike `0003` above: the old app reads `day_boundary` exactly as before, it just gets `00:00`.

`schema.test.ts` checks it: it makes one profile on 04:00 and one on 03:00, runs the file's statements over them, and expects `00:00:00` and `03:00:00`. With the `UPDATE` line removed, the test fails with `expected '04:00:00' to be '00:00:00'`.

## Check yourself
- You delete Alice's row from `auth_user` in psql. Which other rows disappear, and which rule makes it happen?
- `auth_session.token` has a unique constraint. Besides preventing duplicates, why does that make every API request faster?
- You add `week_starts smallint not null` to `profile` and generate a migration. It works on the test database but fails in production. Why, and what would you change?
- Why is `drizzle/` committed to git, when it's generated from `schema.ts`?
- A bug makes the API insert a series with your `user_id` but Bob's `group_id`. Which rule refuses it, and would it still be refused if row-level security were switched off?
- drizzle-kit asks whether `until_date` is a rename of `active_to`. You pick "create column" by mistake and deploy. What happens to every group's last day, and which line of the generated SQL should have stopped you?
- Migration `0004` sets the default to `'00:00'`. Without its `UPDATE` line, which profiles would still start their day at 04:00, and why? Why does the `UPDATE` leave a 03:00 profile alone?
- After migration `0003`, the server's new app fails its health check and `deploy.sh` rolls back to the old app. What does the old app's first `GET /api/v1/groups` answer, and why? How would expand/contract have avoided it?

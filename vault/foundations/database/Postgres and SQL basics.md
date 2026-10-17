# Postgres and SQL basics

> **Builds on:** nothing. A starting point.

What a database actually is, the words around it, and how to look inside ours. The files and the migration routine are in [[Database and migrations]]; this note is the background those notes assume.

## What Postgres is

**Postgres** (PostgreSQL) is a program, a **database server**, that keeps data on disk safely and answers questions about it. Our API never touches the data files; it connects to Postgres over the network (port 5432) and sends it **SQL**, the language for asking. Postgres does the work and sends back rows.

One Postgres server holds several **databases**. Locally ours holds `tasks` (what `pnpm dev` uses) and `tasks_test` (what the tests create, fill and wipe). Each database has **schemas**, folders of tables. Our tables live in the default one, `public`; Drizzle keeps its log of applied migrations in a schema of its own, `drizzle`.

It's a **relational** database: data lives in **tables**, and tables point at each other by id. The alternative family, document databases like MongoDB (in your course), store nested JSON documents instead. D-038 explains why we chose Postgres: the hardest queries here are about time, and Postgres is strongest at those.

## Tables, rows, columns, types

A table is a grid. Here is `profile`, one row per user:

| user_id (uuid) | tzid (text) | day_boundary (time) | created_at (timestamptz) | updated_at (timestamptz) |
|---|---|---|---|---|
| `0199d8a2-…` | `Asia/Kolkata` | `04:00:00` | `2026-10-12 14:41:02+00` | `2026-10-12 14:41:02+00` |

Every column has a **type**, and Postgres refuses values of the wrong type. The ones we use:

| Type | Holds | Example column |
|---|---|---|
| `uuid` | A 128-bit id | every `id` (UUIDv7: ids that sort by creation time) |
| `text` | Any string | `email`, `tzid` |
| `boolean` | true/false | `auth_user.email_verified` |
| `timestamptz` | One moment in time, stored as UTC | `created_at`, `auth_session.expires_at` |
| `time` | A wall-clock time with no date | `profile.day_boundary` |

`NOT NULL` means the column must have a value. `NULL` is SQL's "no value": `auth_user.image` is `NULL` for an account with no photo. `DEFAULT` gives the value used when an insert doesn't say (`tzid` defaults to `Asia/Kolkata`).

## Keys and constraints: rules Postgres enforces for us

A **constraint** is a rule the database checks on every write. Code can have bugs; constraints still hold.

- **Primary key:** the column that identifies a row. It must be unique and not null. `auth_user.id`, and `profile.user_id` (one profile per user, so the user id *is* the key).
- **Unique constraint:** no two rows may share this value. `auth_user.email`, `auth_session.token`, and the pair `(provider_id, account_id)` on `auth_account` (one Google account can't be linked twice).
- **Foreign key:** "this column must match an id in that table". `auth_session.user_id` → `auth_user.id`. Postgres refuses a session for a user who doesn't exist.
  - `ON DELETE CASCADE`: delete a user and their sessions, accounts and profile are deleted with them, so nothing is left orphaned.
- **CHECK constraint** (from v0.2): a condition on the values, such as `rule->>'freq' IN ('daily', 'weekly')`.

In our app, here is `profile` as the first migration creates it, and one of v0.2's CHECKs:

*From `apps/api/drizzle/0000_init.sql` and `0001_calendar_tables.sql` (shortened):*
```sql
-- apps/api/drizzle/0000_init.sql
CREATE TABLE "profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tzid" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"day_boundary" time DEFAULT '04:00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- …
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- apps/api/drizzle/0001_calendar_tables.sql
	CONSTRAINT "series_rule_freq" CHECK ("series"."rule"->>'freq' in ('daily', 'weekly')),
```

What to notice:
- Each column line is name, type, then rules: `PRIMARY KEY`, `NOT NULL`, `DEFAULT …`. `timestamp with time zone` is the long name of `timestamptz`, and `DEFAULT now()` fills in the moment of the insert.
- The foreign key is added afterwards with `ALTER TABLE … ADD CONSTRAINT`, once every table exists. It has a name (`profile_user_id_auth_user_id_fk`), which is what Postgres quotes when it refuses a write.
- `"rule"->>'freq'` reads the `freq` field out of the JSON column `rule`, as text. `--> statement-breakpoint` is a marker for Drizzle, between statements; to Postgres it's a comment.

## Indexes: how lookups stay fast

Without an index, finding "all sessions of user X" means reading every row: a **sequential scan**. An **index** is a sorted side structure (a *B-tree*) mapping a column's values to row locations, like the index at the back of a textbook. With it, Postgres jumps straight to the right rows.

Ours: `auth_session_user_id_idx`, `auth_account_user_id_idx`, `auth_verification_identifier_idx`. Every primary key and unique constraint gets an index automatically, which is why looking a session up by its token on every request is instant.

The cost: every insert and update also updates the indexes. So you index the columns you search by, not everything.

## SQL in five statements

On our tables:

```sql
-- Read: who signed up?
select id, email, created_at from auth_user order by created_at;

-- Read with a filter and a join: the sessions of one email, newest first.
select s.id, s.expires_at
from auth_session s
join auth_user u on u.id = s.user_id      -- "match each session to its user"
where u.email = 'you@example.com'
order by s.created_at desc;

-- Write: insert, update, delete.
insert into profile (user_id) values ('0199d8a2-…');              -- the defaults fill the rest
update profile set tzid = 'Europe/London' where user_id = '0199d8a2-…';
delete from auth_session where expires_at < now();
```

`where` is the filter. Forget it in an `update` or a `delete` and the change hits **every row**. Forgetting `where user_id = …` in a read is exactly the bug row-level security catches, since v0.2: see [[Row-level security]].

## Transactions: all or nothing

A **transaction** groups statements so they either all happen or none do:

```sql
begin;
insert into auth_user (…) values (…);
insert into auth_account (…) values (…);
commit;           -- or `rollback;` to undo both
```

Better Auth does exactly this when you first sign in (`transaction: true` in `auth.ts`): the user row and their Google-account row are written together. A crash between the two inserts leaves neither, never a user with no way to sign in. Migrations also run in one transaction, which is why a failed migration changes nothing ([[Deploy and CI]], "When something fails").

## How our code sends SQL: Drizzle

We don't write SQL strings in the app. **Drizzle** lets us write queries in TypeScript, checked against the table definitions in `apps/api/src/db/schema.ts`:

*From `apps/api/src/profile/profile.ts` (`findProfile`):*
```ts
  const [row] = await db
    .select({ tzid: profile.tzid, dayBoundary: profile.dayBoundary })
    .from(profile)
    .where(eq(profile.userId, userId));
```

`profile.tzid` and `profile.userId` are the columns as declared in `schema.ts`, so a misspelt column is a type error, not a failed query. The answer is an array of rows; `const [row] = …` takes the first one, or `undefined` if there's none.

Drizzle turns that into roughly:

```sql
select "tzid", "day_boundary" from "profile" where "profile"."user_id" = $1
```

and sends `userId` *separately* as parameter `$1`. Postgres never mixes the value into the SQL text, so a malicious value can't change the query. That attack is **SQL injection**, and parameters make it impossible.

- **ORM vs query builder:** an ORM (Prisma, from your course) hides SQL behind objects (`user.sessions`). A query builder (Drizzle, mostly) mirrors SQL closely: if you can read the TypeScript, you can predict the SQL. That's one reason we chose it (A8).
- The query travels over a connection borrowed from the pool ([[Connection pools]]).
- Changes to tables go through migrations ([[Database migrations]]).

## Looking inside our database

`psql` is Postgres's own command-line client. It's inside the database container, so you don't need to install anything:

```sh
docker compose up -d --wait db                     # if it isn't running
docker compose exec db psql -U tasks tasks         # open a SQL prompt on the dev database
```

Inside `psql`:

| Command | What it does |
|---|---|
| `\dt` | List tables |
| `\d profile` | Show one table's columns, types, indexes and foreign keys |
| `\di` | List indexes |
| `select * from auth_user;` | Any SQL; end it with `;` |
| `\x` | Toggle one-column-per-line output (handy for wide rows) |
| `\c tasks_test` | Switch to the test database |
| `\q` | Quit |

Try it: run `pnpm --filter @tasks/api dev:session you@example.com`, then `select * from auth_session;` and find the row it just made.

## Check yourself
- `auth_session.user_id` has a foreign key with `ON DELETE CASCADE`. You `delete from auth_user where email = 'you@example.com';`. What happens to that user's sessions, account row and profile?
- Why does `auth_session.token` need an index (look in `\d auth_session`: which constraint already gives it one)?
- Write the SQL for "how many sessions does each user have?" (hint: `join` and `group by`). Run it in `psql`.
- Your first sign-in writes two rows. Why would a crash between them be bad without a transaction?

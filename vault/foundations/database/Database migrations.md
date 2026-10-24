# Database migrations

> **Builds on:** [[Postgres and SQL basics]]

A **migration** is a numbered file of SQL that moves the database's structure one step forward: "create table `profile`", later "add column `week_starts`". Applied in order to an empty database, the migrations rebuild today's structure exactly.

## Why not just create the tables once by hand?

Because there are many copies of the database: your laptop, the test database, CI's throwaway one, production. Each must end up with the same structure, and production already holds your data, so it can't be wiped and recreated. Migrations are the shared, replayable recipe:

| Database | How it gets the tables |
|---|---|
| Your laptop | `pnpm db:migrate` (also run by `pnpm --filter @tasks/api dev`) |
| `tasks_test` | The tests' global setup migrates it before every run |
| CI | A fresh Postgres per run; every migration applies from zero |
| Production | The deploy script runs `node apps/api/src/db/migrate.ts` before starting the new version |

The database remembers what it has applied (Drizzle keeps a list in `drizzle.__drizzle_migrations`), so running the command twice changes nothing the second time.

In our app, all four rows of that table end up in one small function:

*From `apps/api/src/db/migrations.ts`:*
```ts
export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

export async function runMigrations(pool: Pool): Promise<void> {
  await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_FOLDER });
}
```

What to notice:
- `migrate` is Drizzle's. It reads the folder's list of migrations (`drizzle/meta/_journal.json`), compares it with `drizzle.__drizzle_migrations`, and runs only the missing files, in order.
- `import.meta.dirname` is the folder this file sits in, so the path is right whether the command runs from `apps/api`, the repo root, or `/app` in the Docker image.
- Your laptop (`src/db/migrate.ts`), the tests' global setup and the production image all call this same `runMigrations`.

## Where the SQL comes from

We write the tables in TypeScript (`src/db/schema.ts`). `pnpm --filter @tasks/api db:generate --name <change>` makes **drizzle-kit** compare the schema with its last snapshot and write the difference as SQL (`drizzle/0001_<change>.sql`). The generated file is committed and **reviewed by a human**, because it's the exact thing that will run against your real data. In v0.0, that review is how `0000_init.sql` was checked: five tables, uuid ids with `uuidv7()` defaults, `timestamptz` everywhere, cascading foreign keys, and indexes on every `user_id`.

Not every migration is generated. drizzle-kit only writes what it can describe in `schema.ts`, so v0.2's row-level security was written by hand. It sits in the same folder, in the same numbered list, and runs like any other:

*From `apps/api/drizzle/0002_calendar_rls.sql` (shortened):*
```sql
-- Row-level security for the calendar tables (A10, D-034). Written by hand:
-- drizzle-kit can't express FORCE ROW LEVEL SECURITY or create the role.
-- …
ALTER TABLE series ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE series FORCE ROW LEVEL SECURITY;
```

`--> statement-breakpoint` tells Drizzle where one statement ends and the next begins. The hand-written file uses it too, so Drizzle runs it one statement at a time, like the generated ones. What these statements do is in [[Row-level security]].

## Rules that keep production safe

- **Never edit a migration that has run somewhere.** Production won't re-run it, so your edit silently never happens there. Write a new one.
- **Expand, then contract.** To rename a column: add the new one, deploy code that writes both, copy the data, deploy code that reads the new one, and *then* drop the old one. Each step works with both the old and the new app version, so a deploy never needs both to switch at the same instant (07 §5.12).
- **No down-migrations in production.** An "undo" script that has never run is untested code, waiting for your worst moment. Roll back the *app*, and fix the schema forward.
- Each migration runs in a transaction. If it fails halfway, Postgres undoes the half.

## Check yourself
- Production is on migration 0003. You pull a branch with 0004 and 0005 and deploy. Which files run, and how does Drizzle know?
- You notice a typo in a column name inside `0000_init.sql`, which production already applied. What do you do?
- Why does the test suite migrate `tasks_test` from the same files instead of creating tables some quicker way?

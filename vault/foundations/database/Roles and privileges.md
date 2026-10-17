# Roles and privileges

> **Builds on:** [[Postgres and SQL basics]] · [[Transactions]]

Who is allowed to do what inside Postgres. Until v0.0 this didn't matter: the API logged in as one all-powerful user and did everything. From v0.2 the API gives most of that power up for each request, and [[Row-level security]] builds on that.

## Roles: users and groups are the same thing

Postgres has one kind of account, the **role**. A role that can log in is what you'd call a *user*; a role that can't is a *group* that other roles join. Same command for both:

```sql
create role api login password '…';   -- can open a connection: a "user"
create role tasks_app nologin;        -- can't log in: a "group" to switch into
```

- **`LOGIN` / `NOLOGIN`:** whether a client may connect as this role. Try `psql -U tasks_app` and Postgres says `role "tasks_app" is not permitted to log in`. A `NOLOGIN` role is a bundle of permissions that some other role switches into.
- **Membership:** `grant tasks_app to api;` makes `api` a member of `tasks_app`, so `api` may act as it. Since Postgres 16 a membership has options: whether the member may *switch into* the role (`SET`, the one we need) and whether it gets the role's permissions automatically (`INHERIT`). Both are on by default.
- `\du` in `psql` lists the roles and their attributes.

## Superusers skip every check

A **superuser** is a role with the `SUPERUSER` attribute. Postgres doesn't check its permissions at all: it can read and drop every table, become any role, and it **ignores row-level security**. The official Postgres Docker image creates `POSTGRES_USER` as a superuser, so `tasks`, the role our API logs in as (locally and in `deploy/compose.prod.yaml`), is one.

That's normal for a one-person project, and fine for migrations, which need to create tables. It's also why switching role per request (below) is what makes RLS work at all here.

## Owners

Whoever creates a table **owns** it. The owner can always `ALTER` or `DROP` it and decide who else gets access. Ours are created by migrations running as `tasks`, so `tasks` owns them. Owners also skip row-level security by default, unless the table says `FORCE ROW LEVEL SECURITY` ([[Row-level security]]).

## Privileges: GRANT and REVOKE

A **privilege** is one permission on one object. Every role except owners and superusers starts with almost none, and gets them with `GRANT`:

```sql
grant usage on schema public to tasks_app;           -- may look inside the "public" folder of tables
grant select, insert, update, delete
  on schedule_group, series, occurrence_override
  to tasks_app;                                       -- may read and write rows in these three
revoke delete on series from tasks_app;               -- (example) take one back
```

| Privilege | On | Allows |
|---|---|---|
| `SELECT`, `INSERT`, `UPDATE`, `DELETE` | a table | Reading and writing rows |
| `USAGE` | a schema | Seeing the tables inside it at all (they still need their own grants) |
| `CREATE` | a schema | Making new tables in it |
| `ALTER`, `DROP` | (not grantable) | Only the owner or a superuser |

What a role without a privilege gets, all tried on Postgres 18:
- `select * from t;` on a table it wasn't granted: `permission denied for table t`.
- a table in a schema it has no `USAGE` on: `permission denied for schema …`.
- `drop table schedule_group;`: `must be owner of table schedule_group`.

**New tables aren't granted automatically.** A migration that adds a table must also grant it to the app role, or the first query fails with "permission denied". (`ALTER DEFAULT PRIVILEGES` can grant future tables in advance; doing it per migration keeps each grant visible in the review.)

## Switching role: SET ROLE and SET LOCAL ROLE

A connection has two identities:
- **`session_user`:** who logged in (`tasks`).
- **`current_user`:** whose permissions are checked right now. Usually the same.

`SET ROLE tasks_app` changes `current_user`, so from then on Postgres checks `tasks_app`'s privileges and policies, not `tasks`'s. You may switch to a role you're a member of; a superuser may switch to any role.

`SET LOCAL ROLE tasks_app` does the same until the end of the current transaction ([[Transactions]]), then the connection is `tasks` again. Behind a pool that's the version you want: a plain `SET ROLE` would stay on the connection for the next borrower.

```sql
begin;
set local role tasks_app;
select session_user, current_user;   -- tasks | tasks_app
-- … the request's queries, with tasks_app's limits …
commit;
select current_user;                  -- tasks again
```

**The limit of this trick.** Postgres checks role switches against the **session** user. So code running on that connection can say `reset role` (or `set role tasks`) and get the superuser back. Switching role protects you from **your own mistakes** (a query that forgets a filter, a handler that touches the wrong table). It doesn't protect against an attacker who can run any SQL they like on the connection. Parameters (`$1`) are what keep attackers' SQL out ([[Postgres and SQL basics]]). The stronger setup is to have the API *log in* as a role that is neither superuser nor owner; that needs a second set of credentials and is a later hardening step.

## Least privilege

**Least privilege** means giving each part of a system only the permissions its job needs, so a bug or a break-in can do only that much damage. The KIIT hostel version: the mess staff's key opens the mess, not every room in the block.

For the app's request role, that means:
- **Can:** read and write rows in the tables the calendar uses.
- **Can't:** create, alter or drop tables (migrations do that, as the owner), log in on its own, or skip row-level security.

So a bug that runs `drop table series` fails with "must be owner". And with [[Row-level security]] on top, a handler bug that sends `delete from series` with no `where` deletes only the asking user's rows, not your friend's as well.

In our app: migration `0002` creates `tasks_app`, grants it the three v0.2 tables and turns on RLS; every request switches into it inside its transaction. The details: [[Row-level security in our database]].

*From `apps/api/drizzle/0002_calendar_rls.sql` (shortened):*
```sql
-- Roles belong to the whole Postgres server, not one database: the dev and test
-- databases share this one, so create it only if it isn't there yet.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'tasks_app') THEN
    CREATE ROLE tasks_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- Lets the owner switch to it with SET ROLE (superusers can anyway).
GRANT tasks_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO tasks_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_group, series, occurrence_override TO tasks_app;
```

What to notice:
- `CREATE ROLE tasks_app NOLOGIN`: the "group" kind of role from the top of this note. `DO $$ … $$` runs a small block of code inside Postgres, here so the migration can say "only if it doesn't exist yet".
- `GRANT tasks_app TO CURRENT_USER` is the membership step: `CURRENT_USER` is whoever runs the migration (`tasks`).
- Then exactly the least-privilege list: `USAGE` on the schema, four row privileges on three tables, nothing on `auth_*` or `profile`, and no `CREATE`.

## Check yourself
- `tasks_app` is `NOLOGIN`. How does any query ever run as it?
- A new migration adds a `task` table and forgets the `grant`. What does the first request that reads tasks get back, and from which layer?
- Predict: inside a transaction, after `set local role tasks_app`, a query runs `reset role; select * from series;`. Whose rows come back, and why doesn't this break the point of switching roles in our app?
- Why do migrations run as the owner while requests don't?

-- Row-level security for the calendar tables (A10, D-034). Written by hand:
-- drizzle-kit can't express FORCE ROW LEVEL SECURITY or create the role.
--
-- The API connects as the database owner, which skips row-level security. For
-- requests about calendar data it opens a transaction and runs
--   select set_config('app.user_id', '<the signed-in user id>', true);
--   set local role tasks_app;
-- so the queries in that transaction run as `tasks_app`, a role that owns
-- nothing and is limited by the policies below to that user's rows. Both
-- settings end with the transaction, so a pooled connection never carries one
-- user's identity into the next request.

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
--> statement-breakpoint

-- The signed-in user's id, or NULL when no request set one. After a SET LOCAL
-- ends, Postgres reads an unset custom setting back as '' rather than NULL, so
-- '' counts as "nobody" too. NULL matches no row: no user, no rows.
CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- ENABLE turns the policies on for ordinary roles; FORCE applies them to the
-- table's owner too. Superusers still skip them, which is why the API switches
-- to tasks_app rather than relying on FORCE alone.
--
-- USING decides which rows a query can see, update or delete; WITH CHECK
-- decides which rows it may write. Both say "only the signed-in user's own".
ALTER TABLE schedule_group ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE schedule_group FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY schedule_group_owner ON schedule_group
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE series ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE series FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY series_owner ON series
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE occurrence_override ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE occurrence_override FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY occurrence_override_owner ON occurrence_override
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

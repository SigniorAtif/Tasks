-- ADR v0.3: a group is a folder. It has no first day, so it never hides a
-- series' occurrences; only its last day ends them. "Archived" is worked out
-- from that last day, so the stored timestamp goes too.
ALTER TABLE "schedule_group" DROP CONSTRAINT "schedule_group_active_range";--> statement-breakpoint
ALTER TABLE "schedule_group" DROP COLUMN "active_from";--> statement-breakpoint
ALTER TABLE "schedule_group" DROP COLUMN "archived_at";--> statement-breakpoint
-- The series' column for the same idea is `until_date`, so the group's matches it.
ALTER TABLE "schedule_group" RENAME COLUMN "active_to" TO "until_date";

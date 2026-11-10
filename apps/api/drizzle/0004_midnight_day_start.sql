-- The user's day starts at midnight unless they set it later (D-035, amended
-- 2026-11-10 in ADR v0.3). Before, the default was 04:00, so between midnight
-- and 04:00 the series form and the Groups screen said "yesterday" while the
-- calendar already showed the new date.
ALTER TABLE "profile" ALTER COLUMN "day_boundary" SET DEFAULT '00:00';--> statement-breakpoint
-- Nothing in the app can set a day boundary yet, so every 04:00 is the old
-- default, not a choice: move those profiles to midnight too.
UPDATE "profile" SET "day_boundary" = '00:00' WHERE "day_boundary" = '04:00';

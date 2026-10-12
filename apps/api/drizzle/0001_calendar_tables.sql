CREATE TABLE "occurrence_override" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"original_date" date,
	"new_date" date,
	"new_start_time" time,
	"status" text,
	"cancel_reason" text,
	"duration_min" integer,
	"confirmed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occurrence_override_series_id_original_date_unique" UNIQUE("series_id","original_date"),
	CONSTRAINT "occurrence_override_kind" CHECK ("occurrence_override"."kind" in ('modified', 'extra')),
	CONSTRAINT "occurrence_override_shape" CHECK (("occurrence_override"."kind" = 'modified' and "occurrence_override"."original_date" is not null)
        or ("occurrence_override"."kind" = 'extra' and "occurrence_override"."original_date" is null
          and "occurrence_override"."new_date" is not null and "occurrence_override"."new_start_time" is not null)),
	CONSTRAINT "occurrence_override_status" CHECK ("occurrence_override"."status" is null or "occurrence_override"."status" in ('scheduled', 'cancelled')),
	CONSTRAINT "occurrence_override_cancel_reason" CHECK ("occurrence_override"."cancel_reason" is null
        or ("occurrence_override"."status" = 'cancelled' and "occurrence_override"."cancel_reason" in ('not_held', 'skipped'))),
	CONSTRAINT "occurrence_override_duration_min" CHECK ("occurrence_override"."duration_min" is null or "occurrence_override"."duration_min" between 1 and 1440)
);
--> statement-breakpoint
CREATE TABLE "schedule_group" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color_token" text DEFAULT 'blue' NOT NULL,
	"active_from" date NOT NULL,
	"active_to" date,
	"observes_holidays" boolean DEFAULT true NOT NULL,
	"attendance" boolean DEFAULT true NOT NULL,
	"attendance_threshold_pct" integer DEFAULT 75 NOT NULL,
	"attendance_tracking_from" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_group_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "schedule_group_name_length" CHECK (char_length("schedule_group"."name") between 1 and 80),
	CONSTRAINT "schedule_group_color_token" CHECK ("schedule_group"."color_token" in ('blue', 'sky', 'teal', 'green', 'lime', 'amber', 'orange', 'red', 'pink', 'violet')),
	CONSTRAINT "schedule_group_active_range" CHECK ("schedule_group"."active_to" is null or "schedule_group"."active_to" >= "schedule_group"."active_from"),
	CONSTRAINT "schedule_group_attendance_threshold_pct" CHECK ("schedule_group"."attendance_threshold_pct" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subject" text NOT NULL,
	"location" text,
	"rule" jsonb NOT NULL,
	"start_date" date NOT NULL,
	"until_date" date,
	"start_time" time NOT NULL,
	"duration_min" integer NOT NULL,
	"tzid" text NOT NULL,
	"previous_series_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "series_rule_freq" CHECK ("series"."rule"->>'freq' in ('daily', 'weekly')),
	CONSTRAINT "series_rule_interval" CHECK (jsonb_typeof("series"."rule"->'interval') = 'number'),
	CONSTRAINT "series_rule_weekly_days" CHECK (case when "series"."rule"->>'freq' <> 'weekly' then true
        when jsonb_typeof("series"."rule"->'byDay') = 'array'
          then jsonb_array_length("series"."rule"->'byDay') > 0
        else false end),
	CONSTRAINT "series_title_length" CHECK (char_length("series"."title") between 1 and 80),
	CONSTRAINT "series_subject_length" CHECK (char_length("series"."subject") between 1 and 120),
	CONSTRAINT "series_until_date" CHECK ("series"."until_date" is null or "series"."until_date" >= "series"."start_date"),
	CONSTRAINT "series_duration_min" CHECK ("series"."duration_min" between 1 and 1440)
);
--> statement-breakpoint
ALTER TABLE "occurrence_override" ADD CONSTRAINT "occurrence_override_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence_override" ADD CONSTRAINT "occurrence_override_series_fk" FOREIGN KEY ("user_id","series_id") REFERENCES "public"."series"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_group" ADD CONSTRAINT "schedule_group_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_previous_series_id_series_id_fk" FOREIGN KEY ("previous_series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_group_fk" FOREIGN KEY ("user_id","group_id") REFERENCES "public"."schedule_group"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "occurrence_override_user_id_idx" ON "occurrence_override" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "series_user_id_group_id_idx" ON "series" USING btree ("user_id","group_id");
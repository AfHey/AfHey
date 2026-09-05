-- Phase 2 migration (docs/phase-2-plan.md Section 4; decisions.md 2026-09-05
-- "Phase 2 migration: scheduler constraint tables, Project.domain, search
-- columns"). Hand-written for `prisma migrate deploy`. Everything here is
-- additive: the four scheduler-constraint tables owned by UserSettings, the
-- Project.domain column (areas only), and generated full-text search columns
-- with GIN indexes. Rules the DB can express are CHECK constraints and are
-- mirrored by application validators.

-- Enums
CREATE TYPE "ProjectDomain" AS ENUM ('work', 'personal');
CREATE TYPE "AvailabilityKind" AS ENUM ('general', 'job');
CREATE TYPE "WindowRecurrence" AS ENUM ('weekly', 'once');
CREATE TYPE "JobTimePolicy" AS ENUM ('unavailable', 'work_related_only', 'any');

-- Project.domain: work/personal on areas only; projects inherit their area's domain.
ALTER TABLE "project" ADD COLUMN "domain" "ProjectDomain";
ALTER TABLE "project" ADD CONSTRAINT "project_domain_area_only_chk"
  CHECK ("domain" IS NULL OR "kind" = 'area');

-- Availability windows: when the scheduler may place flexible work.
CREATE TABLE "availability_window" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_settings_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weekday" INTEGER NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "kind" "AvailabilityKind" NOT NULL DEFAULT 'general',
    "label" TEXT,

    CONSTRAINT "availability_window_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "availability_window_weekday_chk" CHECK ("weekday" BETWEEN 1 AND 7),
    CONSTRAINT "availability_window_order_chk" CHECK ("start_time" < "end_time")
);
CREATE INDEX "availability_window_user_settings_id_weekday_idx" ON "availability_window"("user_settings_id", "weekday");
ALTER TABLE "availability_window" ADD CONSTRAINT "availability_window_user_settings_id_fkey"
  FOREIGN KEY ("user_settings_id") REFERENCES "user_settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Protected windows: hard-unavailable time; weekly (weekday) or once (date).
CREATE TABLE "protected_window" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_settings_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recurrence" "WindowRecurrence" NOT NULL,
    "weekday" INTEGER,
    "on_date" DATE,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "label" TEXT,

    CONSTRAINT "protected_window_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "protected_window_weekday_chk" CHECK ("weekday" IS NULL OR "weekday" BETWEEN 1 AND 7),
    CONSTRAINT "protected_window_order_chk" CHECK ("start_time" < "end_time"),
    CONSTRAINT "protected_window_recurrence_chk" CHECK (
      ("recurrence" = 'weekly' AND "weekday" IS NOT NULL AND "on_date" IS NULL)
      OR ("recurrence" = 'once' AND "on_date" IS NOT NULL AND "weekday" IS NULL)
    )
);
CREATE INDEX "protected_window_user_settings_id_idx" ON "protected_window"("user_settings_id");
ALTER TABLE "protected_window" ADD CONSTRAINT "protected_window_user_settings_id_fkey"
  FOREIGN KEY ("user_settings_id") REFERENCES "user_settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preferred windows: soft preferences, optionally per weekday and work type.
CREATE TABLE "preferred_window" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_settings_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weekday" INTEGER,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "work_type" "WorkType",
    "label" TEXT,

    CONSTRAINT "preferred_window_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "preferred_window_weekday_chk" CHECK ("weekday" IS NULL OR "weekday" BETWEEN 1 AND 7),
    CONSTRAINT "preferred_window_order_chk" CHECK ("start_time" < "end_time")
);
CREATE INDEX "preferred_window_user_settings_id_idx" ON "preferred_window"("user_settings_id");
ALTER TABLE "preferred_window" ADD CONSTRAINT "preferred_window_user_settings_id_fkey"
  FOREIGN KEY ("user_settings_id") REFERENCES "user_settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Scheduler preferences: one row per UserSettings (product-owner defaults, 2026-09-05).
CREATE TABLE "scheduler_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_settings_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "min_block_minutes" INTEGER NOT NULL DEFAULT 25,
    "max_block_minutes" INTEGER NOT NULL DEFAULT 120,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 10,
    "daily_deep_work_cap_minutes" INTEGER NOT NULL DEFAULT 240,
    "job_time_policy" "JobTimePolicy" NOT NULL DEFAULT 'work_related_only',
    "planning_horizon_days" INTEGER NOT NULL DEFAULT 7,

    CONSTRAINT "scheduler_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scheduler_preferences_positive_chk" CHECK (
      "min_block_minutes" > 0 AND "max_block_minutes" > 0 AND "buffer_minutes" >= 0
      AND "daily_deep_work_cap_minutes" >= 0 AND "planning_horizon_days" > 0
    ),
    CONSTRAINT "scheduler_preferences_block_order_chk" CHECK ("min_block_minutes" <= "max_block_minutes")
);
CREATE UNIQUE INDEX "scheduler_preferences_user_settings_id_key" ON "scheduler_preferences"("user_settings_id");
ALTER TABLE "scheduler_preferences" ADD CONSTRAINT "scheduler_preferences_user_settings_id_fkey"
  FOREIGN KEY ("user_settings_id") REFERENCES "user_settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Full-text search (product-spec §10.7, §10.8.6): generated columns kept by
-- PostgreSQL, so no application write path can drift from the source fields.
ALTER TABLE "task" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '') || ' ' || coalesce("notes", ''))
  ) STORED;
CREATE INDEX "task_search_vector_idx" ON "task" USING GIN ("search_vector");

ALTER TABLE "project" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("name", '') || ' ' || coalesce("description", ''))
  ) STORED;
CREATE INDEX "project_search_vector_idx" ON "project" USING GIN ("search_vector");

ALTER TABLE "note" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("title", '') || ' ' || coalesce("body", ''))
  ) STORED;
CREATE INDEX "note_search_vector_idx" ON "note" USING GIN ("search_vector");

ALTER TABLE "event" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '') || ' ' || coalesce("location", ''))
  ) STORED;
CREATE INDEX "event_search_vector_idx" ON "event" USING GIN ("search_vector");

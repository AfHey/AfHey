-- CreateEnum
CREATE TYPE "CredentialKind" AS ENUM ('password', 'passkey');

-- CreateEnum
CREATE TYPE "ProjectKind" AS ENUM ('area', 'project');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "Importance" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('action', 'waiting_for', 'reminder');

-- CreateEnum
CREATE TYPE "TaskBucket" AS ENUM ('active', 'backlog', 'someday');

-- CreateEnum
CREATE TYPE "DeadlineType" AS ENUM ('hard', 'soft');

-- CreateEnum
CREATE TYPE "UserPriority" AS ENUM ('must', 'should', 'could');

-- CreateEnum
CREATE TYPE "EnergyLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "WorkType" AS ENUM ('deep', 'shallow', 'study', 'communication', 'errand', 'other');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('high', 'medium', 'needs_confirmation');

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('meeting', 'appointment', 'personal', 'block', 'other');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('fixed', 'flexible');

-- CreateEnum
CREATE TYPE "BlockState" AS ENUM ('planned', 'in_progress', 'completed', 'missed_unconfirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('local', 'synced', 'pending', 'conflict', 'error');

-- CreateEnum
CREATE TYPE "CaptureSourceType" AS ENUM ('typed', 'pasted', 'dictated');

-- CreateEnum
CREATE TYPE "CaptureProcessingStatus" AS ENUM ('received', 'redacted', 'proposed', 'processed', 'rejected', 'failed', 'no_ai');

-- CreateEnum
CREATE TYPE "ProposalOrigin" AS ENUM ('inbox', 'scheduler', 'afhey', 'user');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('pending', 'approved', 'applying', 'applied', 'rejected', 'expired', 'conflicted', 'failed', 'superseded', 'reverted');

-- CreateEnum
CREATE TYPE "ApprovalPolicy" AS ENUM ('explicit', 'tiered');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('create', 'update', 'archive', 'restore', 'delete');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('task', 'event', 'note', 'person', 'project');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_revocation_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" "CredentialKind" NOT NULL,
    "secret_hash" TEXT,
    "public_key" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "revocation_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "current_timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "ai_excluded" BOOLEAN NOT NULL DEFAULT false,
    "kind" "ProjectKind" NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "description" TEXT,
    "importance" "Importance",

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "ai_excluded" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "task_kind" "TaskKind" NOT NULL DEFAULT 'action',
    "bucket" "TaskBucket" NOT NULL DEFAULT 'active',
    "description" TEXT,
    "notes" TEXT,
    "location" TEXT,
    "context" TEXT,
    "project_id" UUID,
    "capture_id" UUID,
    "deadline_date" DATE,
    "deadline_at" TIMESTAMPTZ(3),
    "deadline_timezone" TEXT,
    "deadline_type" "DeadlineType",
    "remind_at" TIMESTAMPTZ(3),
    "reminder_timezone" TEXT,
    "waiting_for_person_id" UUID,
    "nudge_date" DATE,
    "estimated_duration_minutes" INTEGER,
    "remaining_estimate_minutes" INTEGER,
    "is_splittable" BOOLEAN NOT NULL DEFAULT false,
    "is_schedulable" BOOLEAN NOT NULL DEFAULT true,
    "user_priority" "UserPriority",
    "computed_priority_score" INTEGER NOT NULL DEFAULT 50,
    "energy_level" "EnergyLevel",
    "work_type" "WorkType",
    "earliest_start_date" DATE,
    "preferred_window_start_time" TIME(0),
    "preferred_window_end_time" TIME(0),
    "confidence" "Confidence",
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_person" (
    "task_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "role" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_person_pkey" PRIMARY KEY ("task_id","person_id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "ai_excluded" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "last_contact_at" TIMESTAMPTZ(3),
    "notes" TEXT,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_alias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "ai_excluded" BOOLEAN NOT NULL DEFAULT false,
    "person_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized_alias" TEXT NOT NULL,

    CONSTRAINT "person_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "ai_excluded" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "kind" "EventKind" NOT NULL,
    "schedule_type" "ScheduleType" NOT NULL,
    "block_state" "BlockState",
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "start_at" TIMESTAMPTZ(3),
    "end_at" TIMESTAMPTZ(3),
    "all_day_start_date" DATE,
    "all_day_end_date" DATE,
    "timezone" TEXT NOT NULL,
    "task_id" UUID,
    "project_id" UUID,
    "capture_id" UUID,
    "description" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "source_provider" TEXT,
    "external_id" TEXT,
    "external_version" TEXT,
    "last_synced_at" TIMESTAMPTZ(3),
    "sync_status" "SyncStatus" NOT NULL DEFAULT 'local',

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_person" (
    "event_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "role" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_person_pkey" PRIMARY KEY ("event_id","person_id")
);

-- CreateTable
CREATE TABLE "note" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "ai_excluded" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "title" TEXT,
    "project_id" UUID,
    "capture_id" UUID,

    CONSTRAINT "note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capture" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_text" TEXT,
    "redacted_text" TEXT,
    "source_type" "CaptureSourceType" NOT NULL,
    "processing_status" "CaptureProcessingStatus" NOT NULL DEFAULT 'received',
    "ai_excluded" BOOLEAN NOT NULL DEFAULT false,
    "raw_delete_after" TIMESTAMPTZ(3),

    CONSTRAINT "capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "glossary_entry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "ai_excluded" BOOLEAN NOT NULL DEFAULT false,
    "term" TEXT NOT NULL,
    "normalized_term" TEXT NOT NULL,
    "expands_to" TEXT NOT NULL,
    "entity_type" "EntityType",
    "entity_id" UUID,

    CONSTRAINT "glossary_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "ai_excluded" BOOLEAN NOT NULL DEFAULT false,
    "task_id" UUID NOT NULL,
    "event_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "stopped_at" TIMESTAMPTZ(3),
    "adjusted_duration_minutes" INTEGER,
    "adjustment_reason" TEXT,
    "notes" TEXT,

    CONSTRAINT "work_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "origin" "ProposalOrigin" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'pending',
    "idempotency_key" TEXT NOT NULL,
    "approval_policy" "ApprovalPolicy" NOT NULL DEFAULT 'explicit',
    "approval_tier" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "capture_id" UUID,
    "supersedes_proposal_id" UUID,
    "undoes_action_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "applied_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "conflict_details" JSONB,

    CONSTRAINT "proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_operation" (
    "operation_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "proposal_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "depends_on_operation_ids" UUID[],
    "op" "OperationType" NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "expected_revision" INTEGER,
    "after" JSONB,
    "before" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_operation_pkey" PRIMARY KEY ("operation_id")
);

-- CreateTable
CREATE TABLE "action_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "proposal_id" UUID NOT NULL,
    "origin" "ProposalOrigin" NOT NULL,
    "applied_at" TIMESTAMPTZ(3) NOT NULL,
    "operations" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "reverts_action_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "proposal_operation_id" UUID NOT NULL,
    "field_path" TEXT NOT NULL,
    "start_offset" INTEGER NOT NULL,
    "end_offset" INTEGER NOT NULL,
    "literal_text" TEXT,
    "confidence" "Confidence" NOT NULL,
    "resolver_meta" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credential_user_id_idx" ON "credential"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");

-- CreateIndex
CREATE INDEX "project_parent_id_idx" ON "project"("parent_id");

-- CreateIndex
CREATE INDEX "task_project_id_idx" ON "task"("project_id");

-- CreateIndex
CREATE INDEX "task_capture_id_idx" ON "task"("capture_id");

-- CreateIndex
CREATE INDEX "task_waiting_for_person_id_idx" ON "task"("waiting_for_person_id");

-- CreateIndex
CREATE INDEX "task_status_bucket_idx" ON "task"("status", "bucket");

-- CreateIndex
CREATE INDEX "task_person_person_id_idx" ON "task_person"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_alias_normalized_alias_key" ON "person_alias"("normalized_alias");

-- CreateIndex
CREATE INDEX "person_alias_person_id_idx" ON "person_alias"("person_id");

-- CreateIndex
CREATE INDEX "event_task_id_idx" ON "event"("task_id");

-- CreateIndex
CREATE INDEX "event_project_id_idx" ON "event"("project_id");

-- CreateIndex
CREATE INDEX "event_capture_id_idx" ON "event"("capture_id");

-- CreateIndex
CREATE INDEX "event_start_at_idx" ON "event"("start_at");

-- CreateIndex
CREATE INDEX "event_person_person_id_idx" ON "event_person"("person_id");

-- CreateIndex
CREATE INDEX "note_project_id_idx" ON "note"("project_id");

-- CreateIndex
CREATE INDEX "note_capture_id_idx" ON "note"("capture_id");

-- CreateIndex
CREATE INDEX "capture_processing_status_idx" ON "capture"("processing_status");

-- CreateIndex
CREATE INDEX "capture_raw_delete_after_idx" ON "capture"("raw_delete_after");

-- CreateIndex
CREATE UNIQUE INDEX "glossary_entry_normalized_term_key" ON "glossary_entry"("normalized_term");

-- CreateIndex
CREATE INDEX "work_session_task_id_idx" ON "work_session"("task_id");

-- CreateIndex
CREATE INDEX "work_session_event_id_idx" ON "work_session"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_idempotency_key_key" ON "proposal"("idempotency_key");

-- CreateIndex
CREATE INDEX "proposal_capture_id_idx" ON "proposal"("capture_id");

-- CreateIndex
CREATE INDEX "proposal_status_idx" ON "proposal"("status");

-- CreateIndex
CREATE INDEX "proposal_operation_entity_id_idx" ON "proposal_operation"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_operation_proposal_id_sequence_key" ON "proposal_operation"("proposal_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "action_log_proposal_id_key" ON "action_log"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_log_idempotency_key_key" ON "action_log"("idempotency_key");

-- CreateIndex
CREATE INDEX "field_evidence_proposal_operation_id_idx" ON "field_evidence"("proposal_operation_id");

-- AddForeignKey
ALTER TABLE "credential" ADD CONSTRAINT "credential_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "capture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_waiting_for_person_id_fkey" FOREIGN KEY ("waiting_for_person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_person" ADD CONSTRAINT "task_person_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_person" ADD CONSTRAINT "task_person_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_alias" ADD CONSTRAINT "person_alias_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "capture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_person" ADD CONSTRAINT "event_person_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_person" ADD CONSTRAINT "event_person_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "capture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_session" ADD CONSTRAINT "work_session_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_session" ADD CONSTRAINT "work_session_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "capture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_supersedes_proposal_id_fkey" FOREIGN KEY ("supersedes_proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_undoes_action_id_fkey" FOREIGN KEY ("undoes_action_id") REFERENCES "action_log"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_operation" ADD CONSTRAINT "proposal_operation_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_log" ADD CONSTRAINT "action_log_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_log" ADD CONSTRAINT "action_log_reverts_action_id_fkey" FOREIGN KEY ("reverts_action_id") REFERENCES "action_log"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_evidence" ADD CONSTRAINT "field_evidence_proposal_operation_id_fkey" FOREIGN KEY ("proposal_operation_id") REFERENCES "proposal_operation"("operation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added section (docs/product-spec.md §9 invariants).
-- Prisma cannot express CHECK constraints or partial unique indexes in the
-- schema, so the "exactly when", mutual-exclusion, range, and non-empty rules
-- are enforced here and mirrored by application validators.
-- ---------------------------------------------------------------------------

ALTER TABLE "app_user" ADD CONSTRAINT "app_user_revocation_version_chk" CHECK ("session_revocation_version" >= 1);

ALTER TABLE "credential" ADD CONSTRAINT "credential_kind_material_chk" CHECK (
  ("kind" = 'password' AND "secret_hash" IS NOT NULL AND "public_key" IS NULL) OR
  ("kind" = 'passkey' AND "public_key" IS NOT NULL AND "secret_hash" IS NULL)
);

ALTER TABLE "session" ADD CONSTRAINT "session_expiry_chk" CHECK ("expires_at" > "created_at");
ALTER TABLE "session" ADD CONSTRAINT "session_revocation_version_chk" CHECK ("revocation_version" >= 1);

ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_revision_chk" CHECK ("revision" >= 1);

ALTER TABLE "project" ADD CONSTRAINT "project_name_nonempty_chk" CHECK (btrim("name") <> '');
ALTER TABLE "project" ADD CONSTRAINT "project_area_no_parent_chk" CHECK ("kind" <> 'area' OR "parent_id" IS NULL);
ALTER TABLE "project" ADD CONSTRAINT "project_no_self_parent_chk" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
ALTER TABLE "project" ADD CONSTRAINT "project_revision_chk" CHECK ("revision" >= 1);

ALTER TABLE "task" ADD CONSTRAINT "task_title_nonempty_chk" CHECK (btrim("title") <> '');
ALTER TABLE "task" ADD CONSTRAINT "task_revision_chk" CHECK ("revision" >= 1);
ALTER TABLE "task" ADD CONSTRAINT "task_deadline_single_mode_chk" CHECK (NOT ("deadline_date" IS NOT NULL AND "deadline_at" IS NOT NULL));
ALTER TABLE "task" ADD CONSTRAINT "task_deadline_tz_pair_chk" CHECK (("deadline_at" IS NULL) = ("deadline_timezone" IS NULL));
ALTER TABLE "task" ADD CONSTRAINT "task_deadline_type_presence_chk" CHECK (("deadline_type" IS NOT NULL) = ("deadline_date" IS NOT NULL OR "deadline_at" IS NOT NULL));
ALTER TABLE "task" ADD CONSTRAINT "task_reminder_fields_chk" CHECK (("task_kind" = 'reminder') = ("remind_at" IS NOT NULL));
ALTER TABLE "task" ADD CONSTRAINT "task_reminder_tz_pair_chk" CHECK (("remind_at" IS NULL) = ("reminder_timezone" IS NULL));
ALTER TABLE "task" ADD CONSTRAINT "task_waiting_person_chk" CHECK (("task_kind" = 'waiting_for') = ("waiting_for_person_id" IS NOT NULL));
ALTER TABLE "task" ADD CONSTRAINT "task_nudge_only_waiting_chk" CHECK ("task_kind" = 'waiting_for' OR "nudge_date" IS NULL);
ALTER TABLE "task" ADD CONSTRAINT "task_completed_at_chk" CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL));
ALTER TABLE "task" ADD CONSTRAINT "task_priority_score_range_chk" CHECK ("computed_priority_score" BETWEEN 0 AND 100);
ALTER TABLE "task" ADD CONSTRAINT "task_estimated_duration_positive_chk" CHECK ("estimated_duration_minutes" IS NULL OR "estimated_duration_minutes" > 0);
ALTER TABLE "task" ADD CONSTRAINT "task_remaining_estimate_positive_chk" CHECK ("remaining_estimate_minutes" IS NULL OR "remaining_estimate_minutes" > 0);
ALTER TABLE "task" ADD CONSTRAINT "task_preferred_window_chk" CHECK (
  (("preferred_window_start_time" IS NULL) = ("preferred_window_end_time" IS NULL)) AND
  ("preferred_window_start_time" IS NULL OR "preferred_window_start_time" < "preferred_window_end_time")
);

ALTER TABLE "event" ADD CONSTRAINT "event_title_nonempty_chk" CHECK (btrim("title") <> '');
ALTER TABLE "event" ADD CONSTRAINT "event_revision_chk" CHECK ("revision" >= 1);
ALTER TABLE "event" ADD CONSTRAINT "event_block_state_chk" CHECK (("kind" = 'block') = ("block_state" IS NOT NULL));
ALTER TABLE "event" ADD CONSTRAINT "event_block_task_chk" CHECK (("kind" = 'block') = ("task_id" IS NOT NULL));
ALTER TABLE "event" ADD CONSTRAINT "event_time_mode_chk" CHECK (
  ("start_at" IS NOT NULL AND "end_at" IS NOT NULL AND "all_day_start_date" IS NULL AND "all_day_end_date" IS NULL) OR
  ("start_at" IS NULL AND "end_at" IS NULL AND "all_day_start_date" IS NOT NULL AND "all_day_end_date" IS NOT NULL)
);
ALTER TABLE "event" ADD CONSTRAINT "event_timed_order_chk" CHECK ("start_at" IS NULL OR "end_at" > "start_at");
ALTER TABLE "event" ADD CONSTRAINT "event_all_day_order_chk" CHECK ("all_day_start_date" IS NULL OR "all_day_end_date" > "all_day_start_date");
ALTER TABLE "event" ADD CONSTRAINT "event_fixed_not_locked_chk" CHECK (NOT ("schedule_type" = 'fixed' AND "is_locked"));

ALTER TABLE "note" ADD CONSTRAINT "note_body_nonempty_chk" CHECK (btrim("body") <> '');
ALTER TABLE "note" ADD CONSTRAINT "note_revision_chk" CHECK ("revision" >= 1);

ALTER TABLE "person" ADD CONSTRAINT "person_name_nonempty_chk" CHECK (btrim("name") <> '');
ALTER TABLE "person" ADD CONSTRAINT "person_revision_chk" CHECK ("revision" >= 1);

ALTER TABLE "person_alias" ADD CONSTRAINT "person_alias_nonempty_chk" CHECK (btrim("alias") <> '' AND btrim("normalized_alias") <> '');
ALTER TABLE "person_alias" ADD CONSTRAINT "person_alias_revision_chk" CHECK ("revision" >= 1);

ALTER TABLE "capture" ADD CONSTRAINT "capture_revision_chk" CHECK ("revision" >= 1);

ALTER TABLE "glossary_entry" ADD CONSTRAINT "glossary_nonempty_chk" CHECK (btrim("term") <> '' AND btrim("expands_to") <> '');
ALTER TABLE "glossary_entry" ADD CONSTRAINT "glossary_entity_ref_pair_chk" CHECK (("entity_type" IS NULL) = ("entity_id" IS NULL));
ALTER TABLE "glossary_entry" ADD CONSTRAINT "glossary_revision_chk" CHECK ("revision" >= 1);

ALTER TABLE "work_session" ADD CONSTRAINT "work_session_stop_after_start_chk" CHECK ("stopped_at" IS NULL OR "stopped_at" > "started_at");
ALTER TABLE "work_session" ADD CONSTRAINT "work_session_adjustment_pair_chk" CHECK (("adjusted_duration_minutes" IS NULL) = ("adjustment_reason" IS NULL));
ALTER TABLE "work_session" ADD CONSTRAINT "work_session_adjustment_positive_chk" CHECK ("adjusted_duration_minutes" IS NULL OR "adjusted_duration_minutes" > 0);
ALTER TABLE "work_session" ADD CONSTRAINT "work_session_revision_chk" CHECK ("revision" >= 1);

-- At most one active WorkSession overall (single-user system, spec §9.3).
CREATE UNIQUE INDEX "work_session_single_active_idx" ON "work_session" ((TRUE)) WHERE "stopped_at" IS NULL;

ALTER TABLE "proposal" ADD CONSTRAINT "proposal_tier_policy_chk" CHECK (("approval_policy" = 'tiered') = ("approval_tier" IS NOT NULL));
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_tier_range_chk" CHECK ("approval_tier" IS NULL OR ("approval_tier" BETWEEN 0 AND 3));
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_no_self_supersede_chk" CHECK ("supersedes_proposal_id" IS NULL OR "supersedes_proposal_id" <> "id");
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_revision_chk" CHECK ("revision" >= 1);

ALTER TABLE "proposal_operation" ADD CONSTRAINT "proposal_operation_sequence_chk" CHECK ("sequence" >= 0);
ALTER TABLE "proposal_operation" ADD CONSTRAINT "proposal_operation_expected_revision_chk" CHECK (("op" = 'create') = ("expected_revision" IS NULL));
ALTER TABLE "proposal_operation" ADD CONSTRAINT "proposal_operation_expected_rev_positive_chk" CHECK ("expected_revision" IS NULL OR "expected_revision" >= 1);
ALTER TABLE "proposal_operation" ADD CONSTRAINT "proposal_operation_create_no_before_chk" CHECK ("op" <> 'create' OR "before" IS NULL);

ALTER TABLE "action_log" ADD CONSTRAINT "action_log_no_self_revert_chk" CHECK ("reverts_action_id" IS NULL OR "reverts_action_id" <> "id");

ALTER TABLE "field_evidence" ADD CONSTRAINT "field_evidence_offsets_chk" CHECK ("start_offset" >= 0 AND "end_offset" >= "start_offset");

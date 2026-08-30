/**
 * Step 3 database suite: proves the initial migration applies from scratch,
 * creates exactly the Phase 1 migration-boundary tables (product-spec §9),
 * and that representative hand-added constraints enforce the §9 invariants
 * at the database level. Runs against TEST_DATABASE_URL and resets it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/db/generated/client";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;

beforeAll(async () => {
  // Migration-from-scratch check: rebuilds the schema and replays every
  // migration; a broken migration fails the whole suite here.
  db = await resetTestDatabase();
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

async function expectViolation(sql: string, constraint: string) {
  await expect(db.$executeRawUnsafe(sql)).rejects.toThrow(
    new RegExp(constraint),
  );
}

describe("Phase 1 migration boundary", () => {
  it("creates exactly the 19 boundary tables", async () => {
    const rows = await db.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`;
    const tables = rows
      .map((r) => r.table_name)
      .filter((n) => n !== "_prisma_migrations");
    expect(tables).toEqual(
      [
        "action_log",
        "app_user",
        "capture",
        "credential",
        "event",
        "event_person",
        "field_evidence",
        "glossary_entry",
        "note",
        "person",
        "person_alias",
        "project",
        "proposal",
        "proposal_operation",
        "session",
        "task",
        "task_person",
        "user_settings",
        "work_session",
      ].sort(),
    );
  });

  it("Proposal has no conversation_id before Phase 3b", async () => {
    const rows = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'proposal'`;
    expect(rows.map((r) => r.column_name)).not.toContain("conversation_id");
  });

  it("Event carries the reserved sync-provenance columns", async () => {
    const rows = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'event'`;
    const cols = rows.map((r) => r.column_name);
    for (const c of [
      "source_provider",
      "external_id",
      "external_version",
      "last_synced_at",
      "sync_status",
    ]) {
      expect(cols).toContain(c);
    }
  });

  it("Capture.processing_status is the full enum including rejected", async () => {
    const rows = await db.$queryRaw<Array<{ v: string }>>`
      SELECT e.enumlabel AS v
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'CaptureProcessingStatus'
      ORDER BY e.enumsortorder`;
    expect(rows.map((r) => r.v)).toEqual([
      "received",
      "redacted",
      "proposed",
      "processed",
      "rejected",
      "failed",
      "no_ai",
    ]);
  });

  it("accepts a Capture in the rejected terminal state", async () => {
    const capture = await db.capture.create({
      data: {
        rawText: "fictional declined capture",
        sourceType: "pasted",
        processingStatus: "rejected",
        rawDeleteAfter: new Date("2026-09-29T12:00:00Z"),
      },
    });
    expect(capture.processingStatus).toBe("rejected");
    expect(capture.revision).toBe(1);
  });
});

describe("Task constraints", () => {
  it("rejects a deadline in both date and instant modes", () =>
    expectViolation(
      `INSERT INTO "task" ("title", "deadline_date", "deadline_at", "deadline_timezone", "deadline_type")
       VALUES ('x', '2026-09-08', now(), 'America/New_York', 'soft')`,
      "task_deadline_single_mode_chk",
    ));

  it("rejects a deadline without a deadline_type", () =>
    expectViolation(
      `INSERT INTO "task" ("title", "deadline_date") VALUES ('x', '2026-09-08')`,
      "task_deadline_type_presence_chk",
    ));

  it("rejects a reminder task without remind_at", () =>
    expectViolation(
      `INSERT INTO "task" ("title", "task_kind") VALUES ('x', 'reminder')`,
      "task_reminder_fields_chk",
    ));

  it("rejects a waiting_for task without a person", () =>
    expectViolation(
      `INSERT INTO "task" ("title", "task_kind") VALUES ('x', 'waiting_for')`,
      "task_waiting_person_chk",
    ));

  it("rejects completed status without completed_at", () =>
    expectViolation(
      `INSERT INTO "task" ("title", "status") VALUES ('x', 'completed')`,
      "task_completed_at_chk",
    ));

  it("rejects a priority score outside 0-100", () =>
    expectViolation(
      `INSERT INTO "task" ("title", "computed_priority_score") VALUES ('x', 101)`,
      "task_priority_score_range_chk",
    ));

  it("rejects an empty title", () =>
    expectViolation(
      `INSERT INTO "task" ("title") VALUES ('   ')`,
      "task_title_nonempty_chk",
    ));
});

describe("Event constraints", () => {
  it("rejects mixing timed and all-day representations", () =>
    expectViolation(
      `INSERT INTO "event" ("title", "kind", "schedule_type", "timezone", "start_at", "end_at", "all_day_start_date", "all_day_end_date")
       VALUES ('x', 'meeting', 'fixed', 'America/New_York', now(), now() + interval '1 hour', '2026-09-05', '2026-09-06')`,
      "event_time_mode_chk",
    ));

  it("rejects a block Event without task_id", () =>
    expectViolation(
      `INSERT INTO "event" ("title", "kind", "schedule_type", "block_state", "timezone", "start_at", "end_at")
       VALUES ('x', 'block', 'flexible', 'planned', 'America/New_York', now(), now() + interval '1 hour')`,
      "event_block_task_chk",
    ));

  it("rejects a locked fixed Event", () =>
    expectViolation(
      `INSERT INTO "event" ("title", "kind", "schedule_type", "is_locked", "timezone", "start_at", "end_at")
       VALUES ('x', 'meeting', 'fixed', true, 'America/New_York', now(), now() + interval '1 hour')`,
      "event_fixed_not_locked_chk",
    ));

  it("rejects a timed Event that ends before it starts", () =>
    expectViolation(
      `INSERT INTO "event" ("title", "kind", "schedule_type", "timezone", "start_at", "end_at")
       VALUES ('x', 'meeting', 'fixed', 'America/New_York', now(), now() - interval '1 hour')`,
      "event_timed_order_chk",
    ));
});

describe("WorkSession constraints", () => {
  it("allows one active session and rejects a second", async () => {
    const task = await db.task.create({ data: { title: "ws fixture" } });
    await db.$executeRawUnsafe(
      `INSERT INTO "work_session" ("task_id", "started_at") VALUES ('${task.id}', now())`,
    );
    await expectViolation(
      `INSERT INTO "work_session" ("task_id", "started_at") VALUES ('${task.id}', now())`,
      "work_session_single_active_idx",
    );
    await db.$executeRawUnsafe(`DELETE FROM "work_session"`);
  });

  it("rejects an adjusted duration without a reason", async () => {
    const task = await db.task.create({ data: { title: "ws fixture 2" } });
    await expectViolation(
      `INSERT INTO "work_session" ("task_id", "started_at", "stopped_at", "adjusted_duration_minutes")
       VALUES ('${task.id}', now() - interval '1 hour', now(), 30)`,
      "work_session_adjustment_pair_chk",
    );
  });
});

describe("Proposal and audit constraints", () => {
  it("rejects tiered policy without a tier (and Phase 1 default is explicit)", async () => {
    await expectViolation(
      `INSERT INTO "proposal" ("origin", "idempotency_key", "approval_policy")
       VALUES ('inbox', 'test-key-tiered', 'tiered')`,
      "proposal_tier_policy_chk",
    );
    const proposal = await db.proposal.create({
      data: { origin: "inbox", idempotencyKey: "test-key-explicit" },
    });
    expect(proposal.approvalPolicy).toBe("explicit");
    expect(proposal.approvalTier).toBeNull();
  });

  it("rejects a create operation carrying expected_revision", async () => {
    const proposal = await db.proposal.create({
      data: { origin: "inbox", idempotencyKey: "test-key-op" },
    });
    await expectViolation(
      `INSERT INTO "proposal_operation" ("proposal_id", "sequence", "depends_on_operation_ids", "op", "entity_type", "entity_id", "expected_revision")
       VALUES ('${proposal.id}', 0, '{}', 'create', 'task', gen_random_uuid(), 1)`,
      "proposal_operation_expected_revision_chk",
    );
  });

  it("rejects field evidence with inverted offsets", async () => {
    const proposal = await db.proposal.create({
      data: {
        origin: "inbox",
        idempotencyKey: "test-key-evidence",
        operations: {
          create: [
            {
              sequence: 0,
              op: "create",
              entityType: "task",
              entityId: "e9999999-0000-4000-8000-000000000001",
            },
          ],
        },
      },
      include: { operations: true },
    });
    await expectViolation(
      `INSERT INTO "field_evidence" ("proposal_operation_id", "field_path", "start_offset", "end_offset", "confidence")
       VALUES ('${proposal.operations[0].operationId}', 'title', 10, 5, 'high')`,
      "field_evidence_offsets_chk",
    );
  });
});

describe("Identity and hierarchy constraints", () => {
  it("rejects a duplicate normalized person alias", async () => {
    const person = await db.person.create({
      data: {
        name: "Alias Fixture",
        aliases: { create: [{ alias: "AFix", normalizedAlias: "afix" }] },
      },
    });
    await expectViolation(
      `INSERT INTO "person_alias" ("person_id", "alias", "normalized_alias")
       VALUES ('${person.id}', 'afiX', 'afix')`,
      "person_alias_normalized_alias_key",
    );
  });

  it("rejects an area with a parent", async () => {
    const area = await db.project.create({
      data: { kind: "area", name: "Area Fixture" },
    });
    await expectViolation(
      `INSERT INTO "project" ("kind", "name", "parent_id")
       VALUES ('area', 'Nested Area', '${area.id}')`,
      "project_area_no_parent_chk",
    );
  });

  it("rejects a password credential carrying passkey material", async () => {
    const user = await db.user.create({ data: {} });
    await expectViolation(
      `INSERT INTO "credential" ("user_id", "kind", "public_key")
       VALUES ('${user.id}', 'password', '{"kty":"EC"}')`,
      "credential_kind_material_chk",
    );
  });
});

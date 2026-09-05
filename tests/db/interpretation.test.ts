/**
 * Step 11 pipeline suite: evidence bounds, dependency ordering and
 * preallocated-id linking, deterministic dates, kind downgrades with
 * warnings, duplicate warnings, FieldEvidence rows, capture status
 * transitions, end-to-end apply through the Proposal engine, and the
 * capture orchestrator over the fake provider.
 */
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExtractionResult } from "@/ai/adapters/extraction-contract";
import { FakeExtractionProvider } from "@/ai/adapters/fake-extraction";
import type { ExtractionProvider } from "@/ai/adapters/types";
import { processCaptureWithExtraction } from "@/core/captures/extract";
import { createCapture } from "@/core/captures/service";
import { interpretExtraction } from "@/core/interpretation/pipeline";
import { applyProposal } from "@/core/proposals/apply";
import { approveProposal } from "@/core/proposals/lifecycle";
import type { PrismaClient } from "@/db/generated/client";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;
let keyCounter = 0;
const nextKey = () => `interp-${++keyCounter}`;
const now = DateTime.fromISO("2026-09-01T09:00:00", { zone: "America/New_York" });

beforeAll(async () => {
  db = await resetTestDatabase();
  await db.userSettings.create({
    data: { user: { create: {} }, currentTimezone: "America/New_York" },
  });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

const evidence = (start: number, end: number) => ({ start, end });
const item = (
  overrides: Partial<ExtractionResult["items"][number]> & { item_ref: string; entity_type: ExtractionResult["items"][number]["entity_type"] },
): ExtractionResult["items"][number] => ({
  depends_on_item_refs: [],
  fields: {},
  temporal_expressions: [],
  entity_references: [],
  field_evidence: [],
  ...overrides,
});
const result = (items: ExtractionResult["items"]): ExtractionResult => ({
  schema_version: "1",
  prompt_version: "test",
  items,
});

async function newCapture(text: string) {
  return createCapture(db, { text, sourceType: "pasted" });
}

describe("interpretExtraction", () => {
  it("links a task to a proposed project, orders by dependency, records evidence, marks the capture proposed", async () => {
    const payload = "start the Orchid Grant and draft the budget by tomorrow";
    const capture = await newCapture(payload);
    const extraction = result([
      item({
        item_ref: "item-2",
        entity_type: "task",
        depends_on_item_refs: ["item-1"],
        fields: { title: "draft the budget", task_kind: "action" },
        temporal_expressions: [
          {
            field: "deadline",
            literal: "tomorrow",
            relation: "on",
            anchor_entity_id: null,
            evidence: evidence(47, 55),
            confidence: "high",
          },
        ],
        field_evidence: [{ field: "title", evidence: evidence(27, 43), confidence: "high" }],
      }),
      item({
        item_ref: "item-1",
        entity_type: "project",
        fields: { name: "Orchid Grant" },
        field_evidence: [{ field: "name", evidence: evidence(10, 22), confidence: "high" }],
      }),
    ]);

    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      extraction,
      now,
      idempotencyKey: nextKey(),
    });

    expect(outcome.skipped).toEqual([]);
    const proposal = outcome.proposal!;
    expect(proposal.status).toBe("pending");
    expect(proposal.origin).toBe("inbox");
    expect(proposal.captureId).toBe(capture.id);
    expect(proposal.operations.map((o) => o.entityType)).toEqual(["project", "task"]);
    const [projectOp, taskOp] = proposal.operations;
    expect(taskOp.dependsOnOperationIds).toEqual([projectOp.operationId]);
    expect((taskOp.after as { projectId: string }).projectId).toBe(projectOp.entityId);
    expect((taskOp.after as { deadlineDate: string }).deadlineDate).toBe("2026-09-02");
    expect((taskOp.after as { deadlineType: string }).deadlineType).toBe("soft");

    const rows = await db.fieldEvidence.findMany({
      where: { proposalOperationId: { in: proposal.operations.map((o) => o.operationId) } },
      orderBy: { startOffset: "asc" },
    });
    expect(rows.map((r) => r.literalText)).toEqual(["Orchid Grant", "draft the budget", "tomorrow"]);
    const temporalRow = rows.find((r) => r.fieldPath === "deadline")!;
    expect(temporalRow.resolverMeta).toMatchObject({ literal: "tomorrow", relation: "on" });

    const refreshed = await db.capture.findUniqueOrThrow({ where: { id: capture.id } });
    expect(refreshed.processingStatus).toBe("proposed");
    expect(refreshed.redactedText).toBe(payload);
  });

  it("skips items with out-of-bounds evidence and anything depending on them", async () => {
    const payload = "short";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      extraction: result([
        item({
          item_ref: "item-1",
          entity_type: "project",
          fields: { name: "Ghost" },
          field_evidence: [{ field: "name", evidence: evidence(0, 99), confidence: "high" }],
        }),
        item({
          item_ref: "item-2",
          entity_type: "task",
          depends_on_item_refs: ["item-1"],
          fields: { title: "orphan" },
        }),
        item({ item_ref: "item-3", entity_type: "note", fields: { body: "keep me" } }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    expect(outcome.skipped.map((s) => s.itemRef).sort()).toEqual(["item-1", "item-2"]);
    expect(outcome.proposal!.operations.map((o) => o.entityType)).toEqual(["note"]);
  });

  it("downgrades an ambiguous waiting-for to an action with a needs_confirmation warning", async () => {
    const a = await db.person.create({ data: { name: "Sarah One" } });
    const b = await db.person.create({ data: { name: "Sarah Two" } });
    const payload = "waiting on Sarah for the quote";
    const capture = await newCapture(payload);
    const build = (candidates: string[]) =>
      result([
        item({
          item_ref: "item-1",
          entity_type: "task",
          fields: { title: "quote from Sarah", task_kind: "waiting_for" },
          entity_references: [
            {
              field: "waiting_for_person_id",
              candidate_ids: candidates,
              unresolved_literal: null,
              evidence: evidence(11, 16),
              confidence: candidates.length > 1 ? "needs_confirmation" : "high",
            },
          ],
        }),
      ]);

    const ambiguous = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      extraction: build([a.id, b.id]),
      now,
      idempotencyKey: nextKey(),
    });
    const op = ambiguous.proposal!.operations[0].after as { taskKind: string; waitingForPersonId?: string };
    expect(op.taskKind).toBe("action");
    expect(op.waitingForPersonId).toBeUndefined();
    expect(ambiguous.warnings.some((w) => w.severity === "needs_confirmation" && /several matched/.test(w.message))).toBe(true);

    const capture2 = await newCapture(payload);
    const resolved = await interpretExtraction(db, {
      captureId: capture2.id,
      payloadText: payload,
      extraction: build([a.id]),
      now,
      idempotencyKey: nextKey(),
    });
    const op2 = resolved.proposal!.operations[0].after as { taskKind: string; waitingForPersonId: string };
    expect(op2).toMatchObject({ taskKind: "waiting_for", waitingForPersonId: a.id });
  });

  it("leaves a vague deadline empty with a needs_confirmation warning and suggestions", async () => {
    const payload = "finish the slides next week";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      extraction: result([
        item({
          item_ref: "item-1",
          entity_type: "task",
          fields: { title: "finish the slides" },
          temporal_expressions: [
            {
              field: "deadline",
              literal: "next week",
              relation: "on",
              anchor_entity_id: null,
              evidence: evidence(18, 27),
              confidence: "medium",
            },
          ],
        }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const after = outcome.proposal!.operations[0].after as Record<string, unknown>;
    expect(after.deadlineDate).toBeUndefined();
    expect(after.confidence).toBe("needs_confirmation");
    expect(outcome.warnings[0].message).toMatch(/2026-09-07, 2026-09-11/);
  });

  it("builds timed and all-day events, downgrading a timeless event to a task", async () => {
    const payload = "dentist tomorrow at 9am; tile delivery Friday; sometime call the plumber";
    const capture = await newCapture(payload);
    const temporal = (field: string, literal: string, start: number) => ({
      field,
      literal,
      relation: "on" as const,
      anchor_entity_id: null,
      evidence: evidence(start, start + literal.length),
      confidence: "high" as const,
    });
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      extraction: result([
        item({
          item_ref: "item-1",
          entity_type: "event",
          fields: { title: "dentist", event_kind: "appointment" },
          temporal_expressions: [temporal("start", "tomorrow at 9am", 8)],
        }),
        item({
          item_ref: "item-2",
          entity_type: "event",
          fields: { title: "tile delivery", event_kind: "personal" },
          temporal_expressions: [temporal("start", "Friday", 39)],
        }),
        item({ item_ref: "item-3", entity_type: "event", fields: { title: "call the plumber" } }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const [timed, allDay, downgraded] = outcome.proposal!.operations;
    expect(timed.entityType).toBe("event");
    expect(timed.after).toMatchObject({
      startAt: "2026-09-02T13:00:00.000Z",
      endAt: "2026-09-02T14:00:00.000Z",
      timezone: "America/New_York",
      kind: "appointment",
    });
    expect(allDay.after).toMatchObject({ allDayStartDate: "2026-09-04", allDayEndDate: "2026-09-05" });
    expect(downgraded.entityType).toBe("task");
    expect(outcome.warnings.some((w) => /kept as a task/.test(w.message))).toBe(true);
  });

  it("warns about likely duplicates of open tasks", async () => {
    await db.task.create({ data: { title: "Order backsplash tile" } });
    const payload = "order backsplash tile";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      extraction: result([
        item({ item_ref: "item-1", entity_type: "task", fields: { title: "order backsplash tile" } }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    expect(outcome.duplicates).toHaveLength(1);
    expect(outcome.duplicates[0]).toMatchObject({ existingTitle: "Order backsplash tile" });
    expect(outcome.proposal).not.toBeNull();
  });

  it("applies end to end: approve, apply, entities exist, capture processed", async () => {
    const payload = "note: grout cures in 72 hours";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      extraction: result([
        item({
          item_ref: "item-1",
          entity_type: "note",
          fields: { body: "grout cures in 72 hours" },
          field_evidence: [{ field: "body", evidence: evidence(6, 29), confidence: "high" }],
        }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const proposal = outcome.proposal!;
    await approveProposal(db, proposal.id);
    const applied = await applyProposal(db, proposal.id);
    expect(applied.outcome).toBe("applied");
    const note = await db.note.findUniqueOrThrow({ where: { id: proposal.operations[0].entityId } });
    expect(note.body).toBe("grout cures in 72 hours");
    expect(note.captureId).toBeNull(); // linkage arrives via capture_id in Step 12 wiring
    const refreshed = await db.capture.findUniqueOrThrow({ where: { id: capture.id } });
    expect(refreshed.processingStatus).toBe("processed");
    expect(refreshed.rawDeleteAfter).not.toBeNull();
  });
});

describe("processCaptureWithExtraction (fake provider)", () => {
  it("guards, resolves, extracts, and proposes with statuses received → redacted → proposed", async () => {
    const person = await db.person.create({
      data: {
        name: "Priya Raman",
        aliases: { create: [{ alias: "Priya", normalizedAlias: "priya" }] },
      },
    });
    const capture = await newCapture("email Priya about the tile order tomorrow\nnote: keep receipts");
    const outcome = await processCaptureWithExtraction(db, capture.id, new FakeExtractionProvider(), {
      now,
      idempotencyKey: nextKey(),
    });
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;
    const refreshed = await db.capture.findUniqueOrThrow({ where: { id: capture.id } });
    expect(refreshed.processingStatus).toBe("proposed");
    expect(refreshed.redactedText).toBe("email [PERSON_1] about the tile order tomorrow\nnote: keep receipts");
    expect(refreshed.redactedText).not.toContain("Priya");

    const [task, note] = outcome.proposal!.operations;
    expect(task.entityType).toBe("task");
    expect((task.after as { deadlineDate: string }).deadlineDate).toBe("2026-09-02");
    expect(note.entityType).toBe("note");
    // The people reference was kept as evidence with the resolved candidate.
    const peopleEvidence = await db.fieldEvidence.findFirst({
      where: { proposalOperationId: task.operationId, fieldPath: "people" },
    });
    expect(peopleEvidence?.resolverMeta).toMatchObject({ candidateIds: [person.id] });
    expect(peopleEvidence?.literalText).toBe("[PERSON_1]");
  });

  it("marks the capture failed when the provider fails, with no proposal", async () => {
    const failing: ExtractionProvider = {
      name: "failing",
      extract: () => Promise.reject(new Error("provider down")),
    };
    const capture = await newCapture("anything at all");
    const outcome = await processCaptureWithExtraction(db, capture.id, failing, { now });
    expect(outcome).toMatchObject({ status: "failed", reason: "provider down" });
    const refreshed = await db.capture.findUniqueOrThrow({ where: { id: capture.id } });
    expect(refreshed.processingStatus).toBe("failed");
    expect(await db.proposal.count({ where: { captureId: capture.id } })).toBe(0);
  });

  it("refuses ai_excluded captures", async () => {
    const capture = await db.capture.create({
      data: { rawText: "private", sourceType: "typed", aiExcluded: true },
    });
    await expect(
      processCaptureWithExtraction(db, capture.id, new FakeExtractionProvider(), { now }),
    ).rejects.toThrow(/ai_excluded/);
  });
});

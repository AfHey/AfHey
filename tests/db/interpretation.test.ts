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
import { withFailingMethod } from "../helpers/failing-db";
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
      mentions: [],
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
    expect(temporalRow.resolverMeta).toMatchObject({ relation: "on", resolution: { kind: "date", date: "2026-09-02" } });
    expect(JSON.stringify(temporalRow.resolverMeta)).not.toContain("tomorrow");

    const refreshed = await db.capture.findUniqueOrThrow({ where: { id: capture.id } });
    expect(refreshed.processingStatus).toBe("proposed");
    expect(refreshed.redactedText).toBe(payload);
  });

  it("recovers a date phrase the model left in context (finding A regression)", async () => {
    // Mirrors the real failure: three tasks, temporal cues emitted as
    // `context`, work_type echoing the title, no temporal_expressions.
    const payload = "Tomorrow call the plumber, order printer ink, and finish the slide deck by Friday";
    const capture = await newCapture(payload);
    const slipped = (ref: string, title: string, context: string, start: number) =>
      item({
        item_ref: ref,
        entity_type: "task",
        fields: { title, task_kind: "action", context, work_type: title },
        field_evidence: [{ field: "title", evidence: evidence(start, start + title.length), confidence: "high" }],
      });
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
      extraction: result([
        slipped("item-1", "call the plumber", "Tomorrow", 9),
        slipped("item-2", "order printer ink", "Tomorrow", 27),
        slipped("item-3", "finish the slide deck", "by Friday", 50),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const payloads = outcome.proposal!.operations.map((o) => o.after as Record<string, unknown>);
    expect(payloads.map((p) => p.deadlineDate)).toEqual(["2026-09-02", "2026-09-02", "2026-09-04"]);
    expect(payloads.map((p) => p.context)).toEqual([null, null, null]);
    expect(payloads.map((p) => p.workType)).toEqual([null, null, null]);
    expect(outcome.warnings.filter((w) => /recovered/.test(w.message))).toHaveLength(3);
  });

  it("persists field evidence only for populated, meaningful fields (finding B)", async () => {
    const payload = "call the plumber tomorrow";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
      extraction: result([
        item({
          item_ref: "item-1",
          entity_type: "task",
          fields: { title: "call the plumber", task_kind: "action", work_type: "call the plumber" },
          temporal_expressions: [
            { field: "deadline", literal: "tomorrow", relation: "on", anchor_entity_id: null, evidence: evidence(17, 25), confidence: "high" },
          ],
          field_evidence: [
            { field: "title", evidence: evidence(0, 16), confidence: "high" },
            { field: "task_kind", evidence: evidence(0, 25), confidence: "medium" },
            { field: "bucket", evidence: evidence(0, 25), confidence: "medium" },
            { field: "is_schedulable", evidence: evidence(0, 25), confidence: "medium" },
            { field: "work_type", evidence: evidence(0, 16), confidence: "medium" },
            { field: "context", evidence: evidence(17, 25), confidence: "high" },
          ],
        }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const rows = await db.fieldEvidence.findMany({
      where: { proposalOperationId: outcome.proposal!.operations[0].operationId },
      orderBy: { fieldPath: "asc" },
    });
    expect(rows.map((r) => r.fieldPath)).toEqual(["deadline", "title"]);
  });

  it("skips items with out-of-bounds evidence and anything depending on them", async () => {
    const payload = "short";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
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
      mentions: [
        { placeholder: "[PERSON_1]", entityType: "person", candidateIds: [a.id, b.id], confidence: "needs_confirmation" },
      ],
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
      mentions: [{ placeholder: "[PERSON_1]", entityType: "person", candidateIds: [a.id], confidence: "high" }],
      extraction: build([a.id]),
      now,
      idempotencyKey: nextKey(),
    });
    const op2 = resolved.proposal!.operations[0].after as { taskKind: string; waitingForPersonId: string };
    expect(op2).toMatchObject({ taskKind: "waiting_for", waitingForPersonId: a.id });
  });

  it("drops references to ids that were never offered and restores narrowed ambiguity (finding 16)", async () => {
    const offered = await db.person.create({ data: { name: "Offered Person" } });
    const twinA = await db.person.create({ data: { name: "Twin A" } });
    const twinB = await db.person.create({ data: { name: "Twin B" } });
    const existingButUnoffered = await db.person.create({ data: { name: "Existing Unoffered" } });
    const payload = "ask [PERSON_1] and [PERSON_2] about the order";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [
        { placeholder: "[PERSON_1]", entityType: "person", candidateIds: [offered.id], confidence: "high" },
        { placeholder: "[PERSON_2]", entityType: "person", candidateIds: [twinA.id, twinB.id], confidence: "needs_confirmation" },
      ],
      extraction: result([
        item({
          item_ref: "item-1",
          entity_type: "task",
          fields: { title: "ask about the order" },
          entity_references: [
            { field: "people", candidate_ids: [offered.id], unresolved_literal: null, evidence: evidence(4, 14), confidence: "high" },
            // Provider narrowed an ambiguous placeholder to one candidate.
            { field: "people", candidate_ids: [twinA.id], unresolved_literal: null, evidence: evidence(19, 29), confidence: "high" },
            // Provider invented a reference to a real but unoffered record.
            { field: "people", candidate_ids: [existingButUnoffered.id], unresolved_literal: null, evidence: evidence(0, 3), confidence: "high" },
          ],
          field_evidence: [{ field: "title", evidence: evidence(0, 3), confidence: "high" }],
        }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const after = outcome.proposal!.operations[0].after as { peopleIds: string[]; confidence: string };
    expect(after.peopleIds).toEqual([offered.id]);
    expect(after.confidence).toBe("needs_confirmation");
    expect(outcome.warnings.some((w) => /not offered/.test(w.message))).toBe(true);
    expect(outcome.warnings.some((w) => /narrowed/.test(w.message))).toBe(true);
    expect(outcome.warnings.some((w) => /several people/.test(w.message))).toBe(true);
  });

  it("carries event participants into peopleIds and persists EventPerson rows on apply (finding 19)", async () => {
    const known = await db.person.create({ data: { name: "Known Attendee" } });
    const payload = "lunch with [PERSON_1] and Dara Voss Thursday at noon";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [{ placeholder: "[PERSON_1]", entityType: "person", candidateIds: [known.id], confidence: "high" }],
      extraction: result([
        item({
          item_ref: "item-1",
          entity_type: "person",
          fields: { name: "Dara Voss" },
          field_evidence: [{ field: "name", evidence: evidence(payload.indexOf("Dara"), payload.indexOf("Dara") + 9), confidence: "high" }],
        }),
        item({
          item_ref: "item-2",
          entity_type: "event",
          depends_on_item_refs: ["item-1"],
          fields: { title: "lunch", event_kind: "meeting" },
          temporal_expressions: [
            {
              field: "start",
              literal: "Thursday at noon",
              relation: "on",
              anchor_entity_id: null,
              evidence: evidence(payload.indexOf("Thursday"), payload.length),
              confidence: "high",
            },
          ],
          entity_references: [
            { field: "people", candidate_ids: [known.id], unresolved_literal: null, evidence: evidence(11, 21), confidence: "high" },
          ],
          field_evidence: [{ field: "title", evidence: evidence(0, 5), confidence: "high" }],
        }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    expect(outcome.proposal).not.toBeNull();
    const [personOp, eventOp] = outcome.proposal!.operations;
    expect(personOp.entityType).toBe("person");
    expect(eventOp.entityType).toBe("event");
    const after = eventOp.after as { peopleIds: string[]; startAt: string };
    expect(after.peopleIds).toEqual([known.id, personOp.entityId]);
    expect(after.startAt).toBe("2026-09-03T16:00:00.000Z");

    await approveProposal(db, outcome.proposal!.id);
    expect((await applyProposal(db, outcome.proposal!.id)).outcome).toBe("applied");
    const links = await db.eventPerson.findMany({ where: { eventId: eventOp.entityId }, orderBy: { createdAt: "asc" } });
    expect(new Set(links.map((l) => l.personId))).toEqual(new Set([known.id, personOp.entityId]));
  });

  it("recovers a zone left outside the literal and resolves the end in the event's zone (eval-v2 cases 12 and 14)", async () => {
    const payload = "Design review September 12, 2026, 9am Europe/London, ending 10am there.";
    const capture = await newCapture(payload);
    const startLiteral = "September 12, 2026, 9am";
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
      extraction: result([
        item({
          item_ref: "item-1",
          entity_type: "event",
          fields: { title: "Design review", event_kind: "meeting" },
          temporal_expressions: [
            { field: "start", literal: startLiteral, relation: "on", anchor_entity_id: null, evidence: evidence(payload.indexOf(startLiteral), payload.indexOf(startLiteral) + startLiteral.length), confidence: "high" },
            { field: "end", literal: "10am", relation: "on", anchor_entity_id: null, evidence: evidence(payload.indexOf("10am"), payload.indexOf("10am") + 4), confidence: "high" },
          ],
          field_evidence: [{ field: "title", evidence: evidence(0, 13), confidence: "high" }],
        }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const after = outcome.proposal!.operations[0].after as { startAt: string; endAt: string; timezone: string };
    expect(after.timezone).toBe("Europe/London");
    expect(after.startAt).toBe("2026-09-12T08:00:00.000Z");
    expect(after.endAt).toBe("2026-09-12T09:00:00.000Z");
  });

  it("collapses a task and an event that share the same source spans, and drops a note echoing the whole capture (eval-v2 cases 2 and 15)", async () => {
    const payload = "Latest: review moved to Thursday at 2pm.";
    const capture = await newCapture(payload);
    const title = { field: "title", evidence: evidence(8, 14), confidence: "high" as const };
    const when = (field: string) => ({ field, literal: "Thursday at 2pm", relation: "on" as const, anchor_entity_id: null, evidence: evidence(24, 39), confidence: "high" as const });
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
      extraction: result([
        item({ item_ref: "item-1", entity_type: "task", fields: { title: "review" }, temporal_expressions: [when("deadline")], field_evidence: [title] }),
        item({ item_ref: "item-2", entity_type: "event", fields: { title: "review", event_kind: "meeting" }, temporal_expressions: [when("start")], field_evidence: [title] }),
        item({ item_ref: "item-3", entity_type: "note", fields: { body: payload }, field_evidence: [{ field: "body", evidence: evidence(0, payload.length), confidence: "high" }] }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    expect(outcome.proposal!.operations.map((o) => o.entityType)).toEqual(["event"]);
    expect((outcome.proposal!.operations[0].after as { startAt: string }).startAt).toBe("2026-09-03T18:00:00.000Z");
    expect(outcome.warnings.some((w) => /same source span/.test(w.message))).toBe(true);
    expect(outcome.warnings.some((w) => /repeating the whole capture/.test(w.message))).toBe(true);
  });

  it("merges a date-only start with a time-range end into one timed event (eval-v2 case 20)", async () => {
    const payload = "Meet [PERSON_1] September 12, 9am–11am.";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
      extraction: result([
        item({
          item_ref: "item-1",
          entity_type: "event",
          fields: { title: "Meet [PERSON_1]", event_kind: "meeting" },
          temporal_expressions: [
            { field: "start", literal: "September 12", relation: "on", anchor_entity_id: null, evidence: evidence(16, 28), confidence: "high" },
            { field: "end", literal: "9am–11am", relation: "on", anchor_entity_id: null, evidence: evidence(30, 38), confidence: "high" },
          ],
          field_evidence: [{ field: "title", evidence: evidence(0, 15), confidence: "high" }],
        }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const after = outcome.proposal!.operations[0].after as { startAt?: string; endAt?: string; allDayStartDate?: string };
    expect(after.allDayStartDate).toBeUndefined();
    expect(after.startAt).toBe("2026-09-12T13:00:00.000Z");
    expect(after.endAt).toBe("2026-09-12T15:00:00.000Z");
  });

  it("ignores a fabricated temporal literal and flags a title without evidence (finding 17)", async () => {
    const payload = "renew the parking permit";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
      extraction: result([
        item({
          item_ref: "item-1",
          entity_type: "task",
          fields: { title: "renew the parking permit" },
          temporal_expressions: [
            // In-bounds span that does not contain the claimed phrase.
            { field: "deadline", literal: "tomorrow", relation: "on", anchor_entity_id: null, evidence: evidence(0, 5), confidence: "high" },
          ],
          field_evidence: [{ field: "title", evidence: evidence(3, 3), confidence: "high" }],
        }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const after = outcome.proposal!.operations[0].after as Record<string, unknown>;
    expect(after.deadlineDate).toBeUndefined();
    expect(after.confidence).toBe("needs_confirmation");
    expect(outcome.warnings.some((w) => /could not be matched/.test(w.message))).toBe(true);
    expect(outcome.warnings.some((w) => /no source evidence for the title/.test(w.message))).toBe(true);
    expect(await db.fieldEvidence.count({ where: { proposalOperationId: outcome.proposal!.operations[0].operationId } })).toBe(0);
  });

  it("leaves a vague deadline empty with a needs_confirmation warning and suggestions", async () => {
    const payload = "finish the slides next week";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
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
          field_evidence: [{ field: "title", evidence: evidence(0, 17), confidence: "high" }],
        }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const after = outcome.proposal!.operations[0].after as Record<string, unknown>;
    expect(after.deadlineDate).toBeUndefined();
    expect(after.confidence).toBe("needs_confirmation");
    expect(outcome.warnings.some((w) => /2026-09-07, 2026-09-11/.test(w.message))).toBe(true);
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
      mentions: [],
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

  it("keeps explicit event ends and multi-day ranges; an unusable end gets a provisional one-hour end flagged for confirmation (finding 20)", async () => {
    const payload = "Meet on September 12, 9am–11am; retreat September 12 through September 14 inclusive, all day; sync Friday 4pm ending 3pm";
    const capture = await newCapture(payload);
    const t = (field: string, literal: string, confidence: "high" | "medium" = "high") => {
      const start = payload.indexOf(literal);
      return { field, literal, relation: "on" as const, anchor_entity_id: null, evidence: evidence(start, start + literal.length), confidence };
    };
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
      extraction: result([
        item({ item_ref: "item-1", entity_type: "event", fields: { title: "Meet", event_kind: "meeting" }, temporal_expressions: [t("start", "September 12, 9am–11am")], field_evidence: [{ field: "title", evidence: evidence(0, 4), confidence: "high" }] }),
        item({ item_ref: "item-2", entity_type: "event", fields: { title: "retreat", event_kind: "personal", all_day: true }, temporal_expressions: [t("start", "September 12 through September 14")], field_evidence: [{ field: "title", evidence: evidence(payload.indexOf("retreat"), payload.indexOf("retreat") + 7), confidence: "high" }] }),
        item({ item_ref: "item-3", entity_type: "event", fields: { title: "sync", event_kind: "meeting" }, temporal_expressions: [t("start", "Friday 4pm"), t("end", "3pm")], field_evidence: [{ field: "title", evidence: evidence(payload.indexOf("sync"), payload.indexOf("sync") + 4), confidence: "high" }] }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const [meet, retreat, sync] = outcome.proposal!.operations.map((o) => o.after as Record<string, unknown>);
    expect(meet).toMatchObject({ startAt: "2026-09-12T13:00:00.000Z", endAt: "2026-09-12T15:00:00.000Z" });
    expect(retreat).toMatchObject({ allDayStartDate: "2026-09-12", allDayEndDate: "2026-09-15" });
    // An explicit end before the start is not used silently.
    expect(sync.startAt).toBe("2026-09-04T20:00:00.000Z");
    expect(sync.endAt).toBe("2026-09-04T21:00:00.000Z");
    // Events carry no confidence column (spec §9.2); the review sees the
    // needs_confirmation warning on the operation instead.
    const syncOp = outcome.proposal!.operations[2];
    expect(syncOp.reason).toMatch(/stated end could not be used/);
    expect(outcome.warnings.some((w) => w.itemRef === "item-3" && w.severity === "needs_confirmation" && /stated end could not be used/.test(w.message))).toBe(true);
  });

  it("persists deadline firmness from the provider field or the wording (finding 21)", async () => {
    const payload = "submit the grant report — hard deadline 2026-11-30; draft the memo by Friday; file the form 2026-10-01";
    const capture = await newCapture(payload);
    const at = (literal: string) => {
      const start = payload.indexOf(literal);
      return evidence(start, start + literal.length);
    };
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
      extraction: result([
        item({ item_ref: "item-1", entity_type: "task", fields: { title: "submit the grant report" }, temporal_expressions: [{ field: "deadline", literal: "hard deadline 2026-11-30", relation: "before", anchor_entity_id: null, evidence: at("hard deadline 2026-11-30"), confidence: "high" }], field_evidence: [{ field: "title", evidence: at("submit the grant report"), confidence: "high" }] }),
        item({ item_ref: "item-2", entity_type: "task", fields: { title: "draft the memo", deadline_type: "soft" }, temporal_expressions: [{ field: "deadline", literal: "by Friday", relation: "before", anchor_entity_id: null, evidence: at("by Friday"), confidence: "high" }], field_evidence: [{ field: "title", evidence: at("draft the memo"), confidence: "high" }] }),
        item({ item_ref: "item-3", entity_type: "task", fields: { title: "file the form", deadline_type: "hard" }, temporal_expressions: [{ field: "deadline", literal: "2026-10-01", relation: "on", anchor_entity_id: null, evidence: at("2026-10-01"), confidence: "high" }], field_evidence: [{ field: "title", evidence: at("file the form"), confidence: "high" }] }),
      ]),
      now,
      idempotencyKey: nextKey(),
    });
    const types = outcome.proposal!.operations.map((o) => (o.after as { deadlineType: string; deadlineDate: string }));
    expect(types.map((p) => [p.deadlineDate, p.deadlineType])).toEqual([
      ["2026-11-30", "hard"],
      ["2026-09-04", "soft"],
      ["2026-10-01", "hard"],
    ]);
  });

  it("persists nothing when finalization fails part-way (finding 7)", async () => {
    const payload = "renew the permit tomorrow";
    const capture = await newCapture(payload);
    // The evidence insert fails after the proposal was built inside the same
    // transaction; nothing may survive.
    const failing = withFailingMethod(db, "fieldEvidence", "createMany");
    await expect(
      interpretExtraction(failing, {
        captureId: capture.id,
        payloadText: payload,
        mentions: [],
        extraction: result([
          item({
            item_ref: "item-1",
            entity_type: "task",
            fields: { title: "renew the permit" },
            temporal_expressions: [
              { field: "deadline", literal: "tomorrow", relation: "on", anchor_entity_id: null, evidence: evidence(17, 25), confidence: "high" },
            ],
            field_evidence: [{ field: "title", evidence: evidence(0, 16), confidence: "high" }],
          }),
        ]),
        now,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toThrow(/injected failure/);
    expect(await db.proposal.count({ where: { captureId: capture.id } })).toBe(0);
    const untouched = await db.capture.findUniqueOrThrow({ where: { id: capture.id } });
    expect(untouched.processingStatus).toBe("received");
    expect(untouched.redactedText).toBeNull();
  });

  it("warns about likely duplicates of open tasks", async () => {
    await db.task.create({ data: { title: "Order backsplash tile" } });
    const payload = "order backsplash tile";
    const capture = await newCapture(payload);
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
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
      mentions: [],
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
    expect(note.captureId).toBe(capture.id);
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
    expect((task.after as { peopleIds: string[] }).peopleIds).toEqual([person.id]);
    expect((task.after as { captureId: string }).captureId).toBe(capture.id);
    expect(note.entityType).toBe("note");
    const peopleEvidence = await db.fieldEvidence.findFirst({
      where: { proposalOperationId: task.operationId, fieldPath: "people" },
    });
    expect(peopleEvidence?.resolverMeta).toMatchObject({ candidateIds: [person.id] });
    expect(peopleEvidence?.literalText).toBe("[PERSON_1]");

    // Applying creates the TaskPerson link and the source linkage.
    await approveProposal(db, outcome.proposal!.id);
    expect((await applyProposal(db, outcome.proposal!.id)).outcome).toBe("applied");
    const links = await db.taskPerson.findMany({ where: { taskId: task.entityId } });
    expect(links.map((l) => l.personId)).toEqual([person.id]);
    const createdTask = await db.task.findUniqueOrThrow({ where: { id: task.entityId } });
    expect(createdTask.captureId).toBe(capture.id);
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

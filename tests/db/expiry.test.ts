/**
 * Step 13 retention suite (plan test list F): text and evidence literals are
 * nulled after raw_delete_after for processed, no-AI, and rejected captures;
 * rows and links persist; never-resolved captures are discarded 30 days
 * after creation with their proposals expired; the job is idempotent.
 */
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCapture } from "@/core/captures/service";
import { interpretExtraction } from "@/core/interpretation/pipeline";
import { applyProposal } from "@/core/proposals/apply";
import { approveProposal } from "@/core/proposals/lifecycle";
import type { PrismaClient } from "@/db/generated/client";
import { runCaptureExpiry } from "@/jobs/expire-capture-text";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;
const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-15T12:00:00Z");

beforeAll(async () => {
  db = await resetTestDatabase();
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

async function captureWithEvidence(status: "processed" | "no_ai" | "rejected", rawDeleteAfter: Date) {
  const capture = await db.capture.create({
    data: {
      rawText: "raw text",
      redactedText: "redacted text",
      sourceType: "pasted",
      processingStatus: status,
      rawDeleteAfter,
    },
  });
  const proposal = await db.proposal.create({
    data: {
      origin: "inbox",
      idempotencyKey: `exp-${capture.id}`,
      status: "applied",
      captureId: capture.id,
      operations: {
        create: [
          {
            sequence: 0,
            op: "create",
            entityType: "note",
            entityId: "e9999999-0000-4000-8000-000000000001",
            fieldEvidence: {
              create: [{ fieldPath: "body", startOffset: 0, endOffset: 8, literalText: "raw text", confidence: "high" }],
            },
          },
        ],
      },
    },
    include: { operations: true },
  });
  return { capture, operationId: proposal.operations[0].operationId };
}

describe("runCaptureExpiry", () => {
  it("clears text and evidence literals after the clock runs out, keeping rows and links", async () => {
    const due = await captureWithEvidence("processed", new Date(now.getTime() - DAY));
    const rejected = await captureWithEvidence("rejected", new Date(now.getTime() - 60 * 1000));
    const notYet = await captureWithEvidence("no_ai", new Date(now.getTime() + 5 * DAY));

    const summary = await runCaptureExpiry(db, now);
    expect(summary.expiredCaptures).toBe(2);
    expect(summary.clearedEvidenceLiterals).toBe(2);

    for (const c of [due, rejected]) {
      const row = await db.capture.findUniqueOrThrow({ where: { id: c.capture.id } });
      expect(row.rawText).toBeNull();
      expect(row.redactedText).toBeNull();
      expect(row.processingStatus).toBe(c.capture.processingStatus);
      const evidence = await db.fieldEvidence.findFirstOrThrow({ where: { proposalOperationId: c.operationId } });
      expect(evidence.literalText).toBeNull();
      expect(evidence.startOffset).toBe(0);
      expect(evidence.endOffset).toBe(8);
    }
    const kept = await db.capture.findUniqueOrThrow({ where: { id: notYet.capture.id } });
    expect(kept.rawText).toBe("raw text");
  });

  it("discards never-resolved captures 30 days after creation and expires their proposals", async () => {
    const stale = await db.capture.create({
      data: { rawText: "stale", redactedText: "stale", sourceType: "typed", processingStatus: "proposed" },
    });
    await db.capture.update({
      where: { id: stale.id },
      data: { createdAt: new Date(now.getTime() - 31 * DAY) },
    });
    const pending = await db.proposal.create({
      data: { origin: "inbox", idempotencyKey: "stale-pending", captureId: stale.id },
    });
    const fresh = await db.capture.create({
      data: { rawText: "fresh", sourceType: "typed", processingStatus: "received", createdAt: now },
    });

    const summary = await runCaptureExpiry(db, now);
    expect(summary.discardedUnprocessed).toBe(1);
    expect(summary.expiredProposals).toBe(1);
    expect((await db.proposal.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("expired");
    const discarded = await db.capture.findUniqueOrThrow({ where: { id: stale.id } });
    expect(discarded.rawText).toBeNull();
    expect(discarded.rawDeleteAfter).not.toBeNull();
    expect((await db.capture.findUniqueOrThrow({ where: { id: fresh.id } })).rawText).toBe("fresh");
  });

  it("leaves no source wording in any persisted text or JSON field after expiry (finding 8)", async () => {
    // A sentinel appears only in the capture text, as an unresolvable temporal
    // phrase and an unresolved reference; nothing derived may keep it.
    const sentinel = "zqxvsentinel";
    const payload = `renew the permit ${sentinel}`;
    const start = payload.indexOf(sentinel);
    const capture = await createCapture(db, { text: payload, sourceType: "typed" });
    const outcome = await interpretExtraction(db, {
      captureId: capture.id,
      payloadText: payload,
      mentions: [],
      extraction: {
        schema_version: "1",
        prompt_version: "test",
        items: [
          {
            item_ref: "item-1",
            depends_on_item_refs: [],
            entity_type: "task",
            fields: { title: "renew the permit" },
            temporal_expressions: [
              { field: "deadline", literal: sentinel, relation: "on", anchor_entity_id: null, evidence: { start, end: start + sentinel.length }, confidence: "medium" },
            ],
            entity_references: [
              { field: "people", candidate_ids: [], unresolved_literal: sentinel, evidence: { start, end: start + sentinel.length }, confidence: "needs_confirmation" },
            ],
            field_evidence: [{ field: "title", evidence: { start: 0, end: 16 }, confidence: "high" }],
          },
        ],
      },
      now: DateTime.fromISO("2026-09-01T09:00:00", { zone: "America/New_York" }),
      idempotencyKey: `sentinel-${sentinel}`,
    });
    expect(outcome.proposal).not.toBeNull();
    // Apply the proposal so the ActionLog snapshot exists and the scan of
    // action_log.operations below is real, not vacuous (verification item 8).
    await approveProposal(db, outcome.proposal!.id);
    expect((await applyProposal(db, outcome.proposal!.id)).outcome).toBe("applied");
    expect(await db.actionLog.count({ where: { proposalId: outcome.proposal!.id } })).toBe(1);
    await db.capture.update({ where: { id: capture.id }, data: { rawDeleteAfter: new Date(now.getTime() - 1000) } });
    await runCaptureExpiry(db, now);

    const like = `%${sentinel}%`;
    const [hits] = await db.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT (
         (SELECT count(*) FROM capture WHERE raw_text ILIKE $1 OR redacted_text ILIKE $1)
       + (SELECT count(*) FROM field_evidence WHERE literal_text ILIKE $1 OR resolver_meta::text ILIKE $1)
       + (SELECT count(*) FROM proposal_operation WHERE reason ILIKE $1 OR before::text ILIKE $1)
       + (SELECT count(*) FROM proposal WHERE conflict_details::text ILIKE $1 OR failure_reason ILIKE $1)
       + (SELECT count(*) FROM action_log WHERE operations::text ILIKE $1)
       )::int AS total`,
      like,
    );
    expect(hits.total).toBe(0);
    // The evidence row itself survives in shape.
    const rows = await db.fieldEvidence.findMany({
      where: { proposalOperationId: { in: outcome.proposal!.operations.map((o) => o.operationId) } },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.literalText === null)).toBe(true);
  });

  it("is idempotent", async () => {
    const again = await runCaptureExpiry(db, now);
    expect(again).toEqual({
      expiredCaptures: 0,
      discardedUnprocessed: 0,
      clearedEvidenceLiterals: 0,
      expiredProposals: 0,
    });
  });
});

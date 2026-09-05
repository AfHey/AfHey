/**
 * Step 13 retention suite (plan test list F): text and evidence literals are
 * nulled after raw_delete_after for processed, no-AI, and rejected captures;
 * rows and links persist; never-resolved captures are discarded 30 days
 * after creation with their proposals expired; the job is idempotent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

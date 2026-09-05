/**
 * Finding 2 (2026-09-05): capture transitions serialize through an atomic
 * processing claim. Overlapping requests are exercised with real barriers:
 * a provider that blocks until released, concurrent claims, concurrent
 * no-AI requests, and apply against a capture resolved another way.
 */
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExtractionProvider, ExtractionInput } from "@/ai/adapters/types";
import { FakeExtractionProvider } from "@/ai/adapters/fake-extraction";
import { processCaptureWithExtraction } from "@/core/captures/extract";
import {
  CaptureStateError,
  claimCaptureForProcessing,
  createCapture,
  processCaptureNoAi,
  rejectCapture,
} from "@/core/captures/service";
import { applyProposal } from "@/core/proposals/apply";
import { approveProposal } from "@/core/proposals/lifecycle";
import type { PrismaClient } from "@/db/generated/client";
import { withBarrierAfter } from "../helpers/barrier-db";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;
const now = DateTime.fromISO("2026-09-01T09:00:00", { zone: "America/New_York" });

beforeAll(async () => {
  db = await resetTestDatabase();
  await db.userSettings.create({ data: { user: { create: {} }, currentTimezone: "America/New_York" } });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

/** A provider that parks every call until `release()` is invoked. */
function gatedProvider() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inner = new FakeExtractionProvider();
  const transmitted: ExtractionInput[] = [];
  const provider: ExtractionProvider = {
    name: "gated",
    async extract(input) {
      await gate;
      transmitted.push(input);
      return inner.extract(input);
    },
  };
  return { provider, release, transmitted };
}

describe("capture processing claim", () => {
  it("two concurrent claims: exactly one wins", async () => {
    const capture = await createCapture(db, { text: "race me", sourceType: "typed" });
    const results = await Promise.allSettled([
      claimCaptureForProcessing(db, capture.id, "claim-a"),
      claimCaptureForProcessing(db, capture.id, "claim-b"),
    ]);
    const wins = results.filter((r) => r.status === "fulfilled").length;
    expect(wins).toBe(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(CaptureStateError);
  });

  it("no-AI is refused while an extraction is in flight, before anything is transmitted", async () => {
    const capture = await createCapture(db, { text: "keep or interpret", sourceType: "typed" });
    const { provider, release, transmitted } = gatedProvider();
    const extraction = processCaptureWithExtraction(db, capture.id, provider, { now });

    // Wait until the claim is held (status moves to redacted), then race.
    for (let i = 0; i < 50; i++) {
      const c = await db.capture.findUniqueOrThrow({ where: { id: capture.id } });
      if (c.processingClaimKey) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await expect(processCaptureNoAi(db, capture.id)).rejects.toThrow(/being interpreted/);
    await expect(rejectCapture(db, capture.id)).rejects.toThrow(/being interpreted/);
    expect(transmitted).toHaveLength(0);

    release();
    const outcome = await extraction;
    expect(outcome.status).toBe("proposed");
    const final = await db.capture.findUniqueOrThrow({ where: { id: capture.id } });
    expect(final.processingStatus).toBe("proposed");
    expect(final.processingClaimKey).toBeNull();
  });

  it("no-AI that wins first blocks extraction and produces exactly one note", async () => {
    const capture = await createCapture(db, { text: "private first", sourceType: "typed" });
    const results = await Promise.allSettled([processCaptureNoAi(db, capture.id), processCaptureNoAi(db, capture.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.note.count({ where: { captureId: capture.id } })).toBe(1);
    await expect(
      processCaptureWithExtraction(db, capture.id, new FakeExtractionProvider(), { now }),
    ).rejects.toThrow(/ai_excluded|not awaiting extraction/);
  });

  it("a provider failure releases the claim so no-AI can proceed afterwards", async () => {
    const capture = await createCapture(db, { text: "fails then private", sourceType: "typed" });
    const failing: ExtractionProvider = { name: "failing", extract: () => Promise.reject(new Error("down")) };
    const outcome = await processCaptureWithExtraction(db, capture.id, failing, { now });
    expect(outcome.status).toBe("failed");
    const afterFailure = await db.capture.findUniqueOrThrow({ where: { id: capture.id } });
    expect(afterFailure.processingClaimKey).toBeNull();
    const { note } = await processCaptureNoAi(db, capture.id);
    expect(note.aiExcluded).toBe(true);
  });

  it("applying a proposal whose capture was resolved another way conflicts", async () => {
    const capture = await createCapture(db, { text: "propose then reject", sourceType: "typed" });
    const outcome = await processCaptureWithExtraction(db, capture.id, new FakeExtractionProvider(), { now });
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;
    // The capture reaches `rejected` through the review path (reject-all).
    await rejectCapture(db, capture.id);
    await approveProposal(db, outcome.proposal!.id);
    const applied = await applyProposal(db, outcome.proposal!.id);
    expect(applied.outcome).toBe("conflicted");
    expect(await db.task.count({ where: { captureId: capture.id } })).toBe(0);
  });

  it("a rejection that commits between the apply's read and its write rolls the apply back (verification item 2)", async () => {
    const capture = await createCapture(db, { text: "propose, then reject mid-apply", sourceType: "typed" });
    const outcome = await processCaptureWithExtraction(db, capture.id, new FakeExtractionProvider(), { now });
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;
    const proposalId = outcome.proposal!.id;
    await approveProposal(db, proposalId);

    // Park the apply transaction right after it has read the capture as
    // `proposed`, commit a rejection on another connection, then let it go on.
    const { db: paused, barrier } = withBarrierAfter(db, "capture", "findUniqueOrThrow");
    const applying = applyProposal(paused, proposalId);
    await barrier.reached;
    await rejectCapture(db, capture.id);
    barrier.release();

    const result = await applying;
    expect(result.outcome).toBe("conflicted");
    expect((await db.capture.findUniqueOrThrow({ where: { id: capture.id } })).processingStatus).toBe("rejected");
    expect(await db.task.count({ where: { captureId: capture.id } })).toBe(0);
    expect(await db.actionLog.count({ where: { proposalId } })).toBe(0);
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("conflicted");
  });

  it("a stale claim can be taken over", async () => {
    const capture = await createCapture(db, { text: "abandoned", sourceType: "typed" });
    await claimCaptureForProcessing(db, capture.id, "crashed-worker", new Date(Date.now() - 11 * 60 * 1000));
    await expect(claimCaptureForProcessing(db, capture.id, "fresh-worker")).resolves.toMatchObject({
      processingClaimKey: "fresh-worker",
    });
  });
});

/**
 * Capture lifecycle service (product-spec §9.5). Every transition is a
 * compare-and-swap on status (and the processing claim, finding 2), so
 * concurrent requests serialize: exactly one wins and the others receive a
 * CaptureStateError instead of a duplicated outcome.
 */
import { runGuard, type GuardResult } from "@/ai/redaction/guard";
import type { CaptureSourceType } from "@/core/domain/enums";
import type { Capture, PrismaClient } from "@/db/generated/client";

export const RAW_RETENTION_DAYS = 30;
/** A claim older than this is considered abandoned (crashed worker). */
export const CLAIM_STALE_MS = 10 * 60 * 1000;

const AWAITING: Array<Capture["processingStatus"]> = ["received", "redacted", "failed"];

/** Illegal capture lifecycle transition (already resolved, being processed…). */
export class CaptureStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureStateError";
  }
}

export function retentionDeadline(from = new Date()): Date {
  return new Date(from.getTime() + RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** Creates the Capture row on receipt, before any interpretation (§3.1.5). */
export async function createCapture(
  db: PrismaClient,
  input: { text: string; sourceType: CaptureSourceType },
): Promise<Capture> {
  if (input.text.trim() === "") throw new Error("Capture text must be non-empty");
  return db.capture.create({
    data: { rawText: input.text, sourceType: input.sourceType },
  });
}

/** Guard preview for the confirmation UI; nothing is stored or transmitted. */
export function previewRedaction(text: string): GuardResult {
  return runGuard(text);
}

/**
 * Atomically claims a capture for one extraction attempt. Succeeds only when
 * the capture is awaiting processing, not ai_excluded, and either unclaimed
 * or held by a stale claim.
 */
export async function claimCaptureForProcessing(
  db: PrismaClient,
  captureId: string,
  claimKey: string,
  now = new Date(),
): Promise<Capture> {
  const claimed = await db.capture.updateMany({
    where: {
      id: captureId,
      processingStatus: { in: AWAITING },
      aiExcluded: false,
      OR: [{ processingClaimKey: null }, { processingClaimedAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } }],
    },
    data: { processingClaimKey: claimKey, processingClaimedAt: now, revision: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    const current = await db.capture.findUnique({ where: { id: captureId } });
    if (!current) throw new CaptureStateError(`Capture ${captureId} does not exist`);
    if (current.aiExcluded) throw new CaptureStateError(`Capture ${captureId} is marked ai_excluded`);
    if (!AWAITING.includes(current.processingStatus)) {
      throw new CaptureStateError(`Capture ${captureId} is not awaiting extraction (${current.processingStatus})`);
    }
    throw new CaptureStateError(`Capture ${captureId} is already being interpreted`);
  }
  return db.capture.findUniqueOrThrow({ where: { id: captureId } });
}

/** Releases a claim, applying the given transition only if the claim is still ours. */
export async function releaseCaptureClaim(
  db: PrismaClient,
  captureId: string,
  claimKey: string,
  data: { processingStatus: Capture["processingStatus"]; redactedText?: string | null; rawDeleteAfter?: Date | null },
): Promise<boolean> {
  const released = await db.capture.updateMany({
    where: { id: captureId, processingClaimKey: claimKey },
    data: { ...data, processingClaimKey: null, processingClaimedAt: null, revision: { increment: 1 } },
  });
  return released.count === 1;
}

/**
 * No-AI path (§13.5): store the capture as a plain Note, mark everything
 * ai_excluded, and start the 30-day retention clock. Refused while an
 * extraction holds the claim; at most one Note can ever result.
 */
export async function processCaptureNoAi(db: PrismaClient, captureId: string) {
  return db.$transaction(async (tx) => {
    const won = await tx.capture.updateMany({
      where: { id: captureId, processingStatus: { in: AWAITING }, processingClaimKey: null },
      data: {
        processingStatus: "no_ai",
        aiExcluded: true,
        rawDeleteAfter: retentionDeadline(),
        revision: { increment: 1 },
      },
    });
    if (won.count !== 1) {
      const current = await tx.capture.findUnique({ where: { id: captureId } });
      if (!current) throw new CaptureStateError(`Capture ${captureId} does not exist`);
      if (current.processingClaimKey) throw new CaptureStateError(`Capture ${captureId} is being interpreted; wait for it to finish`);
      throw new CaptureStateError(`Capture ${captureId} is not awaiting processing`);
    }
    const capture = await tx.capture.findUniqueOrThrow({ where: { id: captureId } });
    if (!capture.rawText) throw new CaptureStateError(`Capture ${captureId} has no raw text`);
    const note = await tx.note.create({
      data: { body: capture.rawText, captureId: capture.id, aiExcluded: true },
    });
    return { capture, note };
  });
}

/**
 * Rejected terminal state (decisions.md 2026-08-30 "Capture rejected
 * status"): the user declined at the redaction preview, or the review-flow
 * caller rejects after a Proposal was refused without re-extraction.
 * Refused while an extraction holds the claim.
 */
export async function rejectCapture(db: PrismaClient, captureId: string) {
  const won = await db.capture.updateMany({
    where: {
      id: captureId,
      processingStatus: { notIn: ["processed", "no_ai", "rejected"] },
      processingClaimKey: null,
    },
    data: { processingStatus: "rejected", rawDeleteAfter: retentionDeadline(), revision: { increment: 1 } },
  });
  if (won.count !== 1) {
    const current = await db.capture.findUnique({ where: { id: captureId } });
    if (!current) throw new CaptureStateError(`Capture ${captureId} does not exist`);
    if (current.processingClaimKey) throw new CaptureStateError(`Capture ${captureId} is being interpreted; wait for it to finish`);
    throw new CaptureStateError(`Capture ${captureId} is already resolved`);
  }
  return db.capture.findUniqueOrThrow({ where: { id: captureId } });
}

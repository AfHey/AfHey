/**
 * Capture lifecycle service (product-spec §9.5). Step 7 delivers creation,
 * the redaction preview, and the no-AI path; extraction processing and the
 * review flow arrive with the Proposal engine and Inbox steps.
 */
import { runGuard, type GuardResult } from "@/ai/redaction/guard";
import type { CaptureSourceType } from "@/core/domain/enums";
import type { Capture, PrismaClient } from "@/db/generated/client";

export const RAW_RETENTION_DAYS = 30;

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
 * No-AI path (§13.5): store the capture as a plain Note, mark everything
 * ai_excluded, and start the 30-day retention clock. No external call is
 * ever made for this Capture.
 */
export async function processCaptureNoAi(db: PrismaClient, captureId: string) {
  return db.$transaction(async (tx) => {
    const capture = await tx.capture.findUniqueOrThrow({ where: { id: captureId } });
    if (capture.processingStatus !== "received") {
      throw new Error(`Capture ${captureId} is not awaiting processing`);
    }
    if (!capture.rawText) throw new Error(`Capture ${captureId} has no raw text`);
    const note = await tx.note.create({
      data: { body: capture.rawText, captureId: capture.id, aiExcluded: true },
    });
    const updated = await tx.capture.update({
      where: { id: capture.id },
      data: {
        processingStatus: "no_ai",
        aiExcluded: true,
        rawDeleteAfter: retentionDeadline(),
        revision: { increment: 1 },
      },
    });
    return { capture: updated, note };
  });
}

/**
 * Rejected terminal state (decisions.md 2026-08-30 "Capture rejected
 * status"): the user declined at the redaction preview, or the review-flow
 * caller rejects after a Proposal was refused without re-extraction.
 */
export async function rejectCapture(db: PrismaClient, captureId: string) {
  return db.$transaction(async (tx) => {
    const capture = await tx.capture.findUniqueOrThrow({ where: { id: captureId } });
    if (["processed", "no_ai", "rejected"].includes(capture.processingStatus)) {
      throw new Error(`Capture ${captureId} is already resolved`);
    }
    return tx.capture.update({
      where: { id: capture.id },
      data: {
        processingStatus: "rejected",
        rawDeleteAfter: retentionDeadline(),
        revision: { increment: 1 },
      },
    });
  });
}

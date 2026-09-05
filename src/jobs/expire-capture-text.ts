/**
 * Retention job (product-spec §9.5, §13 rule 6): once a Capture's
 * raw_delete_after passes, null its raw and redacted text and every related
 * FieldEvidence literal — rows persist for links and audit and the UI shows
 * "source expired". Captures never resolved within 30 days of creation are
 * discarded the same way and their open proposals expire.
 */
import type { PrismaClient } from "@/db/generated/client";

export const UNPROCESSED_RETENTION_DAYS = 30;

export interface ExpirySummary {
  expiredCaptures: number;
  discardedUnprocessed: number;
  clearedEvidenceLiterals: number;
  expiredProposals: number;
}

async function clearCaptureText(
  db: PrismaClient,
  captureIds: string[],
): Promise<{ captures: number; literals: number }> {
  if (captureIds.length === 0) return { captures: 0, literals: 0 };
  return db.$transaction(async (tx) => {
    const literals = await tx.fieldEvidence.updateMany({
      where: {
        literalText: { not: null },
        operation: { proposal: { captureId: { in: captureIds } } },
      },
      data: { literalText: null },
    });
    const captures = await tx.capture.updateMany({
      where: { id: { in: captureIds } },
      data: { rawText: null, redactedText: null, revision: { increment: 1 } },
    });
    return { captures: captures.count, literals: literals.count };
  });
}

export async function runCaptureExpiry(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<ExpirySummary> {
  // 1. Resolved captures whose retention clock has run out.
  const due = await db.capture.findMany({
    where: {
      rawDeleteAfter: { lte: now },
      OR: [{ rawText: { not: null } }, { redactedText: { not: null } }],
    },
    select: { id: true },
  });
  const expired = await clearCaptureText(db, due.map((c) => c.id));

  // 2. Never-resolved captures older than the retention window.
  const cutoff = new Date(now.getTime() - UNPROCESSED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const stale = await db.capture.findMany({
    where: {
      createdAt: { lte: cutoff },
      rawDeleteAfter: null,
      processingStatus: { in: ["received", "redacted", "proposed", "failed"] },
    },
    select: { id: true },
  });
  const staleIds = stale.map((c) => c.id);
  let expiredProposals = 0;
  let discarded = { captures: 0, literals: 0 };
  if (staleIds.length > 0) {
    const proposals = await db.proposal.updateMany({
      where: { captureId: { in: staleIds }, status: { in: ["pending", "approved"] } },
      data: { status: "expired", revision: { increment: 1 } },
    });
    expiredProposals = proposals.count;
    discarded = await clearCaptureText(db, staleIds);
    await db.capture.updateMany({
      where: { id: { in: staleIds } },
      data: { rawDeleteAfter: now },
    });
  }

  return {
    expiredCaptures: expired.captures,
    discardedUnprocessed: discarded.captures,
    clearedEvidenceLiterals: expired.literals + discarded.literals,
    expiredProposals,
  };
}

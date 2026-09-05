/**
 * Capture → Proposal orchestration: claim, guard + resolve, transmit through
 * the ExtractionProvider, interpret deterministically. The claim (finding 2)
 * is taken atomically before anything is transmitted and released with the
 * final transition, so no-AI, rejection, and a second extraction cannot
 * interleave with an in-flight one. The transmitted payload is stored as
 * Capture.redacted_text before the call (spec §9.5).
 */
import { DateTime } from "luxon";
import { runGuard } from "@/ai/redaction/guard";
import type { ExtractionProvider } from "@/ai/adapters/types";
import { interpretExtraction, type InterpretationResult } from "@/core/interpretation/pipeline";
import { loadLexicon } from "@/core/resolution/lexicon";
import { prepareProviderPayload } from "@/core/resolution/resolve";
import { newUuid } from "@/lib/ids";
import type { PrismaClient } from "@/db/generated/client";
import { claimCaptureForProcessing, releaseCaptureClaim } from "./service";

export type ExtractionOutcome =
  | ({ status: "proposed" | "nothing_actionable" } & InterpretationResult)
  | { status: "failed"; reason: string }
  | { status: "superseded"; reason: string };

export async function processCaptureWithExtraction(
  db: PrismaClient,
  captureId: string,
  provider: ExtractionProvider,
  options: {
    now?: DateTime;
    idempotencyKey?: string;
    /**
     * User-edited redaction preview (spec §13.4). The whole edited text is
     * guarded again before transmission; placeholders that survive keep
     * their resolved candidates.
     */
    editedPayloadText?: string;
  } = {},
): Promise<ExtractionOutcome> {
  const claimKey = `extract:${captureId}:${newUuid()}`;
  const capture = await claimCaptureForProcessing(db, captureId, claimKey);
  if (!capture.rawText) {
    await releaseCaptureClaim(db, captureId, claimKey, { processingStatus: "failed" });
    return { status: "failed", reason: "the capture has no text" };
  }

  const settings = await db.userSettings.findFirst();
  const zone = settings?.currentTimezone ?? "America/New_York";
  const now = (options.now ?? DateTime.now()).setZone(zone);

  const lexicon = await loadLexicon(db);
  const prepared = prepareProviderPayload(capture.rawText, lexicon);
  const payloadText =
    options.editedPayloadText !== undefined
      ? runGuard(options.editedPayloadText).redactedText
      : prepared.payloadText;
  const mentions = prepared.mentions
    .filter((m) => payloadText.includes(m.placeholder))
    .map((m) => ({
      placeholder: m.placeholder,
      entityType: m.entityType,
      candidateIds: m.candidateIds,
      confidence: m.confidence,
    }));

  // Store exactly what will be transmitted while we hold the claim.
  await db.capture.updateMany({
    where: { id: captureId, processingClaimKey: claimKey },
    data: { processingStatus: "redacted", redactedText: payloadText, revision: { increment: 1 } },
  });

  let extraction;
  try {
    extraction = await provider.extract({
      payloadText,
      mentions,
      currentDateTime: now.toISO()!,
      timezone: zone,
      intentKey: options.idempotencyKey ?? claimKey,
    });
  } catch (error) {
    await releaseCaptureClaim(db, captureId, claimKey, { processingStatus: "failed" });
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }

  let result;
  try {
    result = await interpretExtraction(db, {
      captureId,
      payloadText,
      mentions,
      extraction,
      now,
      idempotencyKey: options.idempotencyKey ?? `capture:${captureId}:${newUuid()}`,
      claimKey,
    });
  } catch (error) {
    // Interpretation persists atomically (finding 7); an unexpected failure
    // left nothing behind, so release the claim as failed and report.
    await releaseCaptureClaim(db, captureId, claimKey, { processingStatus: "failed" });
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
  if (result.superseded) {
    return { status: "superseded", reason: "the capture was resolved by another action while interpreting" };
  }
  if (!result.proposal) {
    // Nothing actionable: release the claim, keep the capture reviewable.
    await releaseCaptureClaim(db, captureId, claimKey, { processingStatus: "redacted" });
    return { status: "nothing_actionable", ...result };
  }
  return { status: "proposed", ...result };
}

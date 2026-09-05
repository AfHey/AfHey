/**
 * Capture → Proposal orchestration: guard + resolve, transmit through the
 * ExtractionProvider, interpret deterministically. The transmitted payload
 * is stored as Capture.redacted_text before the call (spec §9.5), and a
 * provider failure leaves the Capture `failed` with no domain mutation.
 */
import { DateTime } from "luxon";
import type { ExtractionProvider } from "@/ai/adapters/types";
import { interpretExtraction, type InterpretationResult } from "@/core/interpretation/pipeline";
import { loadLexicon } from "@/core/resolution/lexicon";
import { prepareProviderPayload } from "@/core/resolution/resolve";
import { newUuid } from "@/lib/ids";
import type { PrismaClient } from "@/db/generated/client";

export type ExtractionOutcome =
  | ({ status: "proposed" | "nothing_actionable" } & InterpretationResult)
  | { status: "failed"; reason: string };

export async function processCaptureWithExtraction(
  db: PrismaClient,
  captureId: string,
  provider: ExtractionProvider,
  options: { now?: DateTime; idempotencyKey?: string } = {},
): Promise<ExtractionOutcome> {
  const capture = await db.capture.findUniqueOrThrow({ where: { id: captureId } });
  if (capture.processingStatus !== "received" && capture.processingStatus !== "redacted") {
    throw new Error(`Capture ${captureId} is not awaiting extraction (${capture.processingStatus})`);
  }
  if (!capture.rawText) throw new Error(`Capture ${captureId} has no raw text`);
  if (capture.aiExcluded) throw new Error(`Capture ${captureId} is marked ai_excluded`);

  const settings = await db.userSettings.findFirst();
  const zone = settings?.currentTimezone ?? "America/New_York";
  const now = (options.now ?? DateTime.now()).setZone(zone);

  const lexicon = await loadLexicon(db);
  const prepared = prepareProviderPayload(capture.rawText, lexicon);

  await db.capture.update({
    where: { id: captureId },
    data: {
      processingStatus: "redacted",
      redactedText: prepared.payloadText,
      revision: { increment: 1 },
    },
  });

  let extraction;
  try {
    extraction = await provider.extract({
      payloadText: prepared.payloadText,
      mentions: prepared.mentions.map((m) => ({
        placeholder: m.placeholder,
        entityType: m.entityType,
        candidateIds: m.candidateIds,
        confidence: m.confidence,
      })),
      currentDateTime: now.toISO()!,
      timezone: zone,
    });
  } catch (error) {
    await db.capture.update({
      where: { id: captureId },
      data: { processingStatus: "failed", revision: { increment: 1 } },
    });
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }

  const result = await interpretExtraction(db, {
    captureId,
    payloadText: prepared.payloadText,
    extraction,
    now,
    idempotencyKey: options.idempotencyKey ?? `capture:${captureId}:${newUuid()}`,
  });
  return { status: result.proposal ? "proposed" : "nothing_actionable", ...result };
}

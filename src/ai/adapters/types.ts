import type { Confidence } from "@/core/domain/enums";
import type { ExtractionResult } from "./extraction-contract";

/** A resolved entity mention the provider may reference (Step 9 output). */
export interface ResolutionMention {
  placeholder: string;
  entityType: "person" | "project";
  candidateIds: string[];
  confidence: Confidence;
}

/**
 * Provider-bound extraction input. `payloadText` is the guarded Capture text
 * (placeholders included) — evidence offsets in the result index into it,
 * and it is what gets stored as Capture.redacted_text.
 */
export interface ExtractionInput {
  payloadText: string;
  mentions: ResolutionMention[];
  /** Current instant, ISO-8601 with offset, in the user's timezone. */
  currentDateTime: string;
  timezone: string;
  /** Stable intent identifier for this attempt, forwarded to the provider as metadata. */
  intentKey?: string;
}

/**
 * ExtractionProvider boundary (spec §12.7): the only place provider SDKs are
 * allowed. Output is schema-validated, untrusted candidate data — deeper
 * validation, date resolution, and Proposal building are trusted code.
 */
export interface ExtractionProvider {
  readonly name: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

export class ExtractionProviderError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ExtractionProviderError";
  }
}

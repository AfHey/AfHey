/**
 * The privacy guard (product-spec §13): runs on the complete provider-bound
 * payload immediately before every external call, including after user edits.
 * Output placeholders are stable tokens; guarding already-guarded text is a
 * no-op, so the mandatory final-pass rerun cannot corrupt offsets.
 */
import { detectSpans, type RedactionSpan } from "./patterns";

export interface GuardResult {
  /** The text safe to transmit, with [REDACTED_TYPE_N] placeholders. */
  redactedText: string;
  /** Spans found, with offsets into the ORIGINAL input text. */
  redactions: Array<RedactionSpan & { placeholder: string }>;
  /** True when the guard changed anything. */
  changed: boolean;
}

export function runGuard(text: string): GuardResult {
  const spans = detectSpans(text);
  const counters = new Map<string, number>();
  const redactions: GuardResult["redactions"] = [];
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    const n = (counters.get(span.type) ?? 0) + 1;
    counters.set(span.type, n);
    const placeholder = `[REDACTED_${span.type.toUpperCase()}_${n}]`;
    out += text.slice(cursor, span.start) + placeholder;
    cursor = span.end;
    redactions.push({ ...span, placeholder });
  }
  out += text.slice(cursor);
  return { redactedText: out, redactions, changed: spans.length > 0 };
}

export class AiExclusionError extends Error {
  constructor() {
    super("A record marked ai_excluded reached provider payload assembly");
    this.name = "AiExclusionError";
  }
}

export interface PayloadPart {
  text: string;
  aiExcluded: boolean;
}

/**
 * Assembles provider-bound context. Records marked `ai_excluded` must be
 * filtered out during retrieval; one reaching this point is a bug and aborts
 * the call rather than leaking. The returned text has already passed the
 * final guard — adapters transmit exactly this string.
 */
export function assembleGuardedPayload(parts: PayloadPart[]): GuardResult {
  for (const part of parts) {
    if (part.aiExcluded) throw new AiExclusionError();
  }
  return runGuard(parts.map((p) => p.text).join("\n\n"));
}

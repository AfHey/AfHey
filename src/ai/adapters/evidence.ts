/**
 * Deterministic evidence snapping. Models quote text reliably but count
 * characters badly, so every span that carries a literal (temporal phrase,
 * placeholder reference, or field quote) is re-anchored to the occurrence of
 * that literal nearest the claimed offset. Spans without a locatable literal
 * are left untouched for the pipeline's bounds check to judge.
 */
import type { ExtractionResult } from "./extraction-contract";
import type { ExtractionInput } from "./types";

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let index = h.indexOf(n);
  while (index >= 0) {
    found.push(index);
    index = h.indexOf(n, index + 1);
  }
  return found;
}

function snap(
  payload: string,
  literal: string,
  evidence: { start: number; end: number },
): { start: number; end: number } {
  const trimmed = literal.trim();
  const starts = occurrences(payload, trimmed);
  if (starts.length === 0) return evidence;
  const nearest = starts.reduce((best, s) =>
    Math.abs(s - evidence.start) < Math.abs(best - evidence.start) ? s : best,
  );
  return { start: nearest, end: nearest + trimmed.length };
}

export function snapEvidence(result: ExtractionResult, input: ExtractionInput): ExtractionResult {
  const payload = input.payloadText;
  const placeholderFor = (candidateIds: string[]): string | null => {
    const sorted = [...candidateIds].sort().join(",");
    return (
      input.mentions.find((m) => [...m.candidateIds].sort().join(",") === sorted)?.placeholder ??
      input.mentions.find((m) => candidateIds.every((id) => m.candidateIds.includes(id)))?.placeholder ??
      null
    );
  };
  return {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      temporal_expressions: item.temporal_expressions.map((t) => ({
        ...t,
        evidence: snap(payload, t.literal, t.evidence),
      })),
      entity_references: item.entity_references.map((r) => {
        const literal = r.unresolved_literal ?? placeholderFor(r.candidate_ids);
        return literal ? { ...r, evidence: snap(payload, literal, r.evidence) } : r;
      }),
      field_evidence: item.field_evidence.map((f) =>
        f.quote ? { ...f, evidence: snap(payload, f.quote, f.evidence) } : f,
      ),
    })),
  };
}

/**
 * Deterministic field-level scoring for the extraction evaluation
 * (product-spec §14.3): item precision/recall with tolerances instead of
 * whole-response equality, per-field accuracy, temporal-literal recall,
 * reference recall, evidence validity, and hallucinated-id detection.
 */
import type { ExtractionItem, ExtractionResult } from "@/ai/adapters/extraction-contract";
import type { EvalCase, ExpectedItem } from "./dataset";

export interface CaseScore {
  caseId: string;
  error?: string;
  expectedRequired: number;
  matchedRequired: number;
  falsePositives: number;
  actualCount: number;
  taskKind: { checked: number; correct: number };
  eventKind: { checked: number; correct: number };
  duration: { checked: number; correct: number };
  temporal: { expected: number; hit: number };
  references: { expected: number; hit: number };
  evidence: { spans: number; valid: number; literalsAligned: number; literalsChecked: number };
  hallucinatedIds: number;
  notes: string[];
}

export interface Metrics {
  cases: number;
  erroredCases: number;
  itemPrecision: number;
  itemRecall: number;
  itemF1: number;
  taskKindAccuracy: number;
  eventKindAccuracy: number;
  durationAccuracy: number;
  temporalRecall: number;
  referenceRecall: number;
  evidenceValidity: number;
  literalAlignment: number;
  hallucinatedIds: number;
}

export interface AcceptanceResult {
  accepted: boolean;
  checks: Array<{ name: string; threshold: string; actual: string; pass: boolean }>;
}

const titleOf = (item: ExtractionItem): string =>
  String(item.fields.title ?? item.fields.name ?? item.fields.body ?? "").toLowerCase();

const matchesKeywords = (item: ExtractionItem, expected: ExpectedItem): boolean => {
  const title = titleOf(item);
  return expected.keywords.every((k) => title.includes(k.toLowerCase()));
};

function ratio(n: number, d: number): number {
  return d === 0 ? 1 : n / d;
}

export function scoreCase(evalCase: EvalCase, result: ExtractionResult | Error): CaseScore {
  const score: CaseScore = {
    caseId: evalCase.id,
    expectedRequired: evalCase.expected.filter((e) => !e.optional).length,
    matchedRequired: 0,
    falsePositives: 0,
    actualCount: 0,
    taskKind: { checked: 0, correct: 0 },
    eventKind: { checked: 0, correct: 0 },
    duration: { checked: 0, correct: 0 },
    temporal: { expected: 0, hit: 0 },
    references: { expected: 0, hit: 0 },
    evidence: { spans: 0, valid: 0, literalsAligned: 0, literalsChecked: 0 },
    hallucinatedIds: 0,
    notes: [],
  };
  if (result instanceof Error) {
    score.error = result.message;
    score.temporal.expected = evalCase.expected.flatMap((e) => e.temporal ?? []).length;
    score.references.expected = evalCase.expected.flatMap((e) => e.references ?? []).length;
    return score;
  }

  const items = result.items;
  score.actualCount = items.length;
  const payload = evalCase.input.payloadText;
  const knownIds = new Set(evalCase.input.mentions.flatMap((m) => m.candidateIds));

  // Evidence validity and hallucinated ids over every item.
  for (const item of items) {
    const spans = [
      ...item.field_evidence.map((f) => ({ ...f.evidence, literal: null as string | null })),
      ...item.entity_references.map((r) => ({ ...r.evidence, literal: null as string | null })),
      ...item.temporal_expressions.map((t) => ({ ...t.evidence, literal: t.literal })),
    ];
    for (const span of spans) {
      score.evidence.spans += 1;
      const valid = span.start >= 0 && span.end >= span.start && span.end <= payload.length;
      if (valid) score.evidence.valid += 1;
      if (span.literal !== null) {
        score.evidence.literalsChecked += 1;
        const slice = valid ? payload.slice(span.start, span.end).toLowerCase().trim() : "";
        const literal = span.literal.toLowerCase().trim();
        if (slice === literal || slice.includes(literal) || literal.includes(slice) && slice.length > 0) {
          score.evidence.literalsAligned += 1;
        }
      }
    }
    for (const ref of item.entity_references) {
      for (const id of ref.candidate_ids) if (!knownIds.has(id)) score.hallucinatedIds += 1;
    }
    for (const t of item.temporal_expressions) {
      if (t.anchor_entity_id && !knownIds.has(t.anchor_entity_id)) score.hallucinatedIds += 1;
    }
  }

  // Greedy matching: required expectations first, then optional ones.
  const unmatched = new Set(items);
  const ordered = [...evalCase.expected].sort((a, b) => Number(a.optional ?? false) - Number(b.optional ?? false));
  for (const expected of ordered) {
    const candidate = [...unmatched].find(
      (item) => expected.types.includes(item.entity_type) && matchesKeywords(item, expected),
    );
    if (!candidate) {
      if (!expected.optional) score.notes.push(`missed: ${expected.keywords.join(" ")}`);
      score.temporal.expected += expected.temporal?.length ?? 0;
      score.references.expected += expected.references?.length ?? 0;
      continue;
    }
    unmatched.delete(candidate);
    if (!expected.optional) score.matchedRequired += 1;

    if (expected.taskKind) {
      score.taskKind.checked += 1;
      if (candidate.fields.task_kind === expected.taskKind) score.taskKind.correct += 1;
      else score.notes.push(`task_kind ${String(candidate.fields.task_kind)} ≠ ${expected.taskKind}`);
    }
    if (expected.eventKind) {
      score.eventKind.checked += 1;
      if (candidate.fields.event_kind === expected.eventKind) score.eventKind.correct += 1;
      else score.notes.push(`event_kind ${String(candidate.fields.event_kind)} ≠ ${expected.eventKind}`);
    }
    if (expected.estimatedDurationMinutes !== undefined) {
      score.duration.checked += 1;
      if (candidate.fields.estimated_duration_minutes === expected.estimatedDurationMinutes) {
        score.duration.correct += 1;
      } else {
        score.notes.push(`duration ${String(candidate.fields.estimated_duration_minutes)} ≠ ${expected.estimatedDurationMinutes}`);
      }
    }
    for (const tokens of expected.temporal ?? []) {
      score.temporal.expected += 1;
      // Day and time may arrive as one literal or several; the item's
      // literals together must cover the expected tokens.
      const literals = candidate.temporal_expressions.map((t) => t.literal.toLowerCase()).join(" ");
      const hit = tokens.every((tok) => literals.includes(tok.toLowerCase()));
      if (hit) score.temporal.hit += 1;
      else score.notes.push(`temporal missed: ${tokens.join(" ")}`);
    }
    for (const ref of expected.references ?? []) {
      score.references.expected += 1;
      const hit = candidate.entity_references.some(
        (r) => ref.fields.includes(r.field) && ref.candidateIds.every((id) => r.candidate_ids.includes(id)),
      );
      if (hit) score.references.hit += 1;
      else score.notes.push(`reference missed: ${ref.fields[0]} ${ref.candidateIds.join(",")}`);
    }
  }
  score.falsePositives = unmatched.size;
  for (const extra of unmatched) score.notes.push(`extra: ${extra.entity_type} "${titleOf(extra)}"`);
  return score;
}

export function aggregate(scores: CaseScore[]): Metrics {
  const sum = (f: (s: CaseScore) => number) => scores.reduce((acc, s) => acc + f(s), 0);
  const matched = sum((s) => s.matchedRequired);
  const expected = sum((s) => s.expectedRequired);
  const falsePositives = sum((s) => s.falsePositives);
  const precision = ratio(matched, matched + falsePositives);
  const recall = ratio(matched, expected);
  return {
    cases: scores.length,
    erroredCases: scores.filter((s) => s.error).length,
    itemPrecision: precision,
    itemRecall: recall,
    itemF1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    taskKindAccuracy: ratio(sum((s) => s.taskKind.correct), sum((s) => s.taskKind.checked)),
    eventKindAccuracy: ratio(sum((s) => s.eventKind.correct), sum((s) => s.eventKind.checked)),
    durationAccuracy: ratio(sum((s) => s.duration.correct), sum((s) => s.duration.checked)),
    temporalRecall: ratio(sum((s) => s.temporal.hit), sum((s) => s.temporal.expected)),
    referenceRecall: ratio(sum((s) => s.references.hit), sum((s) => s.references.expected)),
    evidenceValidity: ratio(sum((s) => s.evidence.valid), sum((s) => s.evidence.spans)),
    literalAlignment: ratio(sum((s) => s.evidence.literalsAligned), sum((s) => s.evidence.literalsChecked)),
    hallucinatedIds: sum((s) => s.hallucinatedIds),
  };
}

/** Acceptance gate for enabling live extraction (thresholds recorded in the report). */
export function evaluateAcceptance(m: Metrics): AcceptanceResult {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const checks = [
    { name: "item recall", threshold: "≥ 85%", actual: pct(m.itemRecall), pass: m.itemRecall >= 0.85 },
    { name: "item precision", threshold: "≥ 85%", actual: pct(m.itemPrecision), pass: m.itemPrecision >= 0.85 },
    { name: "task_kind accuracy", threshold: "≥ 85%", actual: pct(m.taskKindAccuracy), pass: m.taskKindAccuracy >= 0.85 },
    { name: "temporal literal recall", threshold: "≥ 85%", actual: pct(m.temporalRecall), pass: m.temporalRecall >= 0.85 },
    { name: "reference recall", threshold: "≥ 90%", actual: pct(m.referenceRecall), pass: m.referenceRecall >= 0.9 },
    { name: "evidence validity", threshold: "≥ 95%", actual: pct(m.evidenceValidity), pass: m.evidenceValidity >= 0.95 },
    { name: "hallucinated ids", threshold: "= 0", actual: String(m.hallucinatedIds), pass: m.hallucinatedIds === 0 },
    { name: "provider errors", threshold: "= 0", actual: String(m.erroredCases), pass: m.erroredCases === 0 },
  ];
  return { accepted: checks.every((c) => c.pass), checks };
}

/**
 * Which evidence a review card shows (finding B, 2026-09-05): only fields
 * that are populated on the proposed item, with human labels, deduplicated,
 * and never an empty literal unless the source has expired.
 */
import type { EvidenceView, OperationView } from "./types";

const LABELS: Record<string, string> = {
  title: "title",
  name: "name",
  body: "text",
  description: "description",
  notes: "notes",
  location: "location",
  context: "context",
  estimated_duration_minutes: "estimate",
  task_kind: "kind",
  event_kind: "kind",
  role: "role",
  proposed_priority_score: "priority",
  work_type: "work type",
  energy_level: "energy",
  deadline: "date",
  due: "date",
  due_date: "date",
  remind_at: "reminder",
  reminder: "reminder",
  nudge_date: "nudge",
  start: "starts",
  starts: "starts",
  when: "starts",
  on: "starts",
  start_at: "starts",
  end: "ends",
  ends: "ends",
  end_at: "ends",
  people: "people",
  project_id: "project",
  project: "project",
  waiting_for_person_id: "waiting on",
};

/** Payload keys that must be populated for a field's evidence to matter. */
const REQUIRES: Record<string, string[]> = {
  title: ["title", "name", "body"],
  name: ["name", "title"],
  body: ["body"],
  description: ["description"],
  notes: ["notes"],
  location: ["location"],
  context: ["context"],
  estimated_duration_minutes: ["estimatedDurationMinutes"],
  task_kind: ["taskKind"],
  event_kind: ["kind"],
  role: ["role"],
  proposed_priority_score: ["computedPriorityScore"],
  work_type: ["workType"],
  energy_level: ["energyLevel"],
  deadline: ["deadlineDate", "deadlineAt", "confidence"],
  due: ["deadlineDate", "deadlineAt", "confidence"],
  due_date: ["deadlineDate", "deadlineAt", "confidence"],
  remind_at: ["remindAt"],
  reminder: ["remindAt"],
  nudge_date: ["nudgeDate"],
  start: ["startAt", "allDayStartDate"],
  starts: ["startAt", "allDayStartDate"],
  when: ["startAt", "allDayStartDate"],
  on: ["startAt", "allDayStartDate"],
  start_at: ["startAt", "allDayStartDate"],
  end: ["endAt", "allDayEndDate"],
  ends: ["endAt", "allDayEndDate"],
  end_at: ["endAt", "allDayEndDate"],
  people: ["peopleIds"],
  project_id: ["projectId"],
  project: ["projectId"],
  waiting_for_person_id: ["waitingForPersonId"],
};

export interface DisplayEvidence {
  label: string;
  literal: string | null;
  confidence: string;
}

function populated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

export function selectDisplayEvidence(
  op: Pick<OperationView, "after" | "evidence">,
  sourceExpired: boolean,
): DisplayEvidence[] {
  const seen = new Set<string>();
  const out: DisplayEvidence[] = [];
  for (const e of op.evidence as EvidenceView[]) {
    const label = LABELS[e.fieldPath];
    if (!label) continue;
    const requires = REQUIRES[e.fieldPath] ?? [];
    if (requires.length > 0 && !requires.some((key) => populated(op.after[key]))) continue;
    if (e.literalText === null && !sourceExpired) continue;
    if (e.literalText !== null && e.literalText.trim() === "") continue;
    const key = `${label}|${e.literalText ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, literal: e.literalText, confidence: e.confidence });
  }
  return out;
}

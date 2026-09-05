/**
 * Which payload keys an evidence field explains. Shared by the pipeline
 * (persist evidence only for populated fields) and the review service (carry
 * evidence across an edit only when the explained value is unchanged).
 */
export const EVIDENCE_FIELD_KEYS: Record<string, string[]> = {
  title: ["title", "name", "body"],
  name: ["name"],
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
  deadline_type: ["deadlineType"],
  deadline: ["deadlineDate", "deadlineAt", "deadlineTimezone"],
  due: ["deadlineDate", "deadlineAt", "deadlineTimezone"],
  due_date: ["deadlineDate", "deadlineAt", "deadlineTimezone"],
  remind_at: ["remindAt", "reminderTimezone"],
  reminder: ["remindAt", "reminderTimezone"],
  nudge_date: ["nudgeDate"],
  nudge: ["nudgeDate"],
  start: ["startAt", "allDayStartDate", "timezone"],
  starts: ["startAt", "allDayStartDate", "timezone"],
  when: ["startAt", "allDayStartDate", "timezone"],
  on: ["startAt", "allDayStartDate", "timezone"],
  start_at: ["startAt", "allDayStartDate", "timezone"],
  end: ["endAt", "allDayEndDate"],
  ends: ["endAt", "allDayEndDate"],
  end_at: ["endAt", "allDayEndDate"],
  people: ["peopleIds"],
  project_id: ["projectId"],
  project: ["projectId"],
  waiting_for_person_id: ["waitingForPersonId"],
};

/** Fields whose payload value must be populated for evidence to be meaningful. */
export function fieldEvidenceIsMeaningful(field: string, after: Record<string, unknown>): boolean {
  const keys = EVIDENCE_FIELD_KEYS[field];
  if (!keys) return false;
  if (field === "task_kind" && after.taskKind === "action") return false;
  if (field === "proposed_priority_score" && after.computedPriorityScore === 50) return false;
  return keys.some((k) => {
    const v = after[k];
    return v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "") && !(Array.isArray(v) && v.length === 0);
  });
}

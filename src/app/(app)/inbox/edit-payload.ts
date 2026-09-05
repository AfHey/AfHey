/**
 * Review item editing as a patch (finding 6, 2026-09-05): the editor state
 * is derived from the proposed payload, and saving applies only the fields
 * whose derived value the user actually changed. Everything else — scoring,
 * flags, context, lock, ranges, timezones — survives untouched. Converting
 * the entity type is the one deliberate rebuild.
 */
import { DateTime } from "luxon";

export type EditableEntityType = "task" | "event" | "note" | "person" | "project";
type Payload = Record<string, unknown>;

export interface EditorState {
  entityType: EditableEntityType;
  title: string;
  body: string;
  role: string;
  notes: string;
  description: string;
  location: string;
  taskKind: "action" | "waiting_for" | "reminder";
  bucket: "active" | "backlog" | "someday";
  projectId: string;
  waitingForPersonId: string;
  deadlineMode: "none" | "date" | "instant";
  deadlineDate: string;
  deadlineLocal: string;
  deadlineTimezone: string;
  deadlineType: "hard" | "soft";
  remindLocal: string;
  remindTimezone: string;
  estimated: string;
  eventKind: "meeting" | "appointment" | "personal" | "other";
  scheduleType: "fixed" | "flexible";
  isLocked: boolean;
  allDay: boolean;
  startLocal: string;
  endLocal: string;
  allDayStart: string;
  /** Inclusive last day shown to the user; stored end is exclusive. */
  allDayLastDay: string;
  timezone: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const local = (iso: unknown, zone: string) =>
  typeof iso === "string" ? DateTime.fromISO(iso).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm") : "";

export function editorStateFrom(entityType: EditableEntityType, after: Payload, userZone: string): EditorState {
  const zone = str(after.timezone) || str(after.deadlineTimezone) || str(after.reminderTimezone) || userZone;
  const allDayEnd = str(after.allDayEndDate);
  return {
    entityType,
    title: str(after.title) || str(after.name),
    body: str(after.body),
    role: str(after.role),
    notes: str(after.notes),
    description: str(after.description),
    location: str(after.location),
    taskKind: (after.taskKind as EditorState["taskKind"]) ?? "action",
    bucket: (after.bucket as EditorState["bucket"]) ?? "active",
    projectId: str(after.projectId),
    waitingForPersonId: str(after.waitingForPersonId),
    deadlineMode: after.deadlineDate ? "date" : after.deadlineAt ? "instant" : "none",
    deadlineDate: str(after.deadlineDate),
    deadlineLocal: local(after.deadlineAt, str(after.deadlineTimezone) || userZone),
    deadlineTimezone: str(after.deadlineTimezone) || userZone,
    deadlineType: (after.deadlineType as EditorState["deadlineType"]) ?? "soft",
    remindLocal: local(after.remindAt, str(after.reminderTimezone) || userZone),
    remindTimezone: str(after.reminderTimezone) || userZone,
    estimated: typeof after.estimatedDurationMinutes === "number" ? String(after.estimatedDurationMinutes) : "",
    eventKind: (after.kind as EditorState["eventKind"]) ?? "other",
    scheduleType: (after.scheduleType as EditorState["scheduleType"]) ?? "fixed",
    isLocked: after.isLocked === true,
    allDay: entityType === "event" ? typeof after.allDayStartDate === "string" : false,
    startLocal: local(after.startAt, zone),
    endLocal: local(after.endAt, zone),
    allDayStart: str(after.allDayStartDate) || DateTime.now().setZone(userZone).toISODate()!,
    allDayLastDay: allDayEnd
      ? DateTime.fromISO(allDayEnd).minus({ days: 1 }).toISODate()!
      : str(after.allDayStartDate) || DateTime.now().setZone(userZone).toISODate()!,
    timezone: zone,
  };
}

const instant = (localValue: string, zone: string): string | null => {
  if (!localValue) return null;
  const dt = DateTime.fromISO(localValue, { zone });
  return dt.isValid ? dt.toUTC().toISO() : null;
};
const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

/** The payload fields an editor state expresses, for the given type. */
export function derivePayload(s: EditorState): Payload {
  switch (s.entityType) {
    case "task": {
      const isReminder = s.taskKind === "reminder";
      const dateMode = !isReminder && s.deadlineMode === "date" && s.deadlineDate !== "";
      const instantMode = !isReminder && s.deadlineMode === "instant" && s.deadlineLocal !== "";
      return {
        title: s.title,
        notes: orNull(s.notes),
        description: orNull(s.description),
        location: orNull(s.location),
        taskKind: s.taskKind,
        bucket: s.bucket,
        projectId: orNull(s.projectId),
        waitingForPersonId: s.taskKind === "waiting_for" ? orNull(s.waitingForPersonId) : null,
        deadlineDate: dateMode ? s.deadlineDate : null,
        deadlineAt: instantMode ? instant(s.deadlineLocal, s.deadlineTimezone) : null,
        deadlineTimezone: instantMode ? s.deadlineTimezone : null,
        deadlineType: dateMode || instantMode ? s.deadlineType : null,
        remindAt: isReminder ? instant(s.remindLocal, s.remindTimezone) : null,
        reminderTimezone: isReminder && s.remindLocal ? s.remindTimezone : null,
        estimatedDurationMinutes: s.estimated ? Number(s.estimated) : null,
      };
    }
    case "event": {
      const allDayEnd = s.allDay && s.allDayLastDay
        ? DateTime.fromISO(s.allDayLastDay).plus({ days: 1 }).toISODate()
        : null;
      return {
        title: s.title,
        kind: s.eventKind,
        scheduleType: s.scheduleType,
        isLocked: s.scheduleType === "flexible" ? s.isLocked : false,
        timezone: s.timezone,
        projectId: orNull(s.projectId),
        location: orNull(s.location),
        description: orNull(s.description),
        notes: orNull(s.notes),
        startAt: s.allDay ? null : instant(s.startLocal, s.timezone),
        endAt: s.allDay ? null : instant(s.endLocal, s.timezone),
        allDayStartDate: s.allDay ? s.allDayStart : null,
        allDayEndDate: s.allDay ? allDayEnd : null,
      };
    }
    case "note":
      return { body: s.body || s.title, title: s.body ? orNull(s.title) : null, projectId: orNull(s.projectId) };
    case "person":
      return { name: s.title, role: orNull(s.role), notes: orNull(s.notes) };
    case "project":
      return { name: s.title, description: orNull(s.description) };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Applies an edit: same entity type → original payload plus only the fields
 * whose derived value changed; changed entity type → a rebuilt payload that
 * carries over the neutral fields (capture link, project, notes, people).
 */
export function applyEdit(
  original: Payload,
  initial: EditorState,
  current: EditorState,
): { entityType: EditableEntityType; after: Payload; changedKeys: string[] } {
  if (current.entityType !== initial.entityType) {
    const rebuilt = derivePayload(current);
    const carried: Payload = {};
    if (original.captureId !== undefined) carried.captureId = original.captureId;
    if (current.entityType === "task" && Array.isArray(original.peopleIds)) carried.peopleIds = original.peopleIds;
    if (current.entityType === "event" && Array.isArray(original.peopleIds)) carried.peopleIds = original.peopleIds;
    return { entityType: current.entityType, after: { ...carried, ...rebuilt }, changedKeys: Object.keys(rebuilt) };
  }
  const before = derivePayload(initial);
  const now = derivePayload(current);
  const patch: Payload = {};
  for (const key of Object.keys(now)) {
    if (!same(before[key], now[key])) patch[key] = now[key];
  }
  return { entityType: current.entityType, after: { ...original, ...patch }, changedKeys: Object.keys(patch) };
}

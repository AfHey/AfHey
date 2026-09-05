/**
 * Zod input schemas for manual create/update flows (Step 6 UI) and later for
 * Proposal payload validation. DTOs use ISO strings for dates/instants and
 * "HH:MM" for times; converters produce Prisma-ready data. Cross-field
 * invariants run here for creates and in mutations (on the merged row) for
 * partial updates.
 */
import { z } from "zod";
import {
  Confidence,
  DeadlineType,
  EnergyLevel,
  EntityType,
  EventKind,
  Importance,
  ProjectKind,
  ScheduleType,
  TaskBucket,
  TaskKind,
  UserPriority,
  WorkType,
} from "./enums";
import { taskViolations, eventViolations, type TaskShape, type EventShape } from "./invariants";
import { isValidTimezone, isoDateToDb, timeOfDayToDb, timeOfDayToMinutes } from "./time";

const trimmed = z.string().trim().min(1);
const optionalText = z.string().trim().min(1).nullish();
const isoDate = z.iso.date();
const isoInstant = z.iso.datetime({ offset: true });
const timeOfDay = z
  .string()
  .refine((v) => timeOfDayToMinutes(v) !== null, "expected HH:MM (24h)");
const timezone = z.string().refine(isValidTimezone, "not a valid IANA timezone");

// --- Task -----------------------------------------------------------------

export const taskFieldsSchema = z.object({
  title: trimmed,
  taskKind: z.enum(TaskKind),
  bucket: z.enum(TaskBucket),
  description: optionalText,
  notes: optionalText,
  location: optionalText,
  context: optionalText,
  projectId: z.uuid().nullish(),
  captureId: z.uuid().nullish(),
  deadlineDate: isoDate.nullish(),
  deadlineAt: isoInstant.nullish(),
  deadlineTimezone: timezone.nullish(),
  deadlineType: z.enum(DeadlineType).nullish(),
  remindAt: isoInstant.nullish(),
  reminderTimezone: timezone.nullish(),
  waitingForPersonId: z.uuid().nullish(),
  nudgeDate: isoDate.nullish(),
  estimatedDurationMinutes: z.number().int().positive().nullish(),
  remainingEstimateMinutes: z.number().int().positive().nullish(),
  isSplittable: z.boolean(),
  isSchedulable: z.boolean(),
  userPriority: z.enum(UserPriority).nullish(),
  computedPriorityScore: z.number().int().min(0).max(100),
  energyLevel: z.enum(EnergyLevel).nullish(),
  workType: z.enum(WorkType).nullish(),
  earliestStartDate: isoDate.nullish(),
  preferredWindowStartTime: timeOfDay.nullish(),
  preferredWindowEndTime: timeOfDay.nullish(),
  confidence: z.enum(Confidence).nullish(),
});

export const taskCreateSchema = taskFieldsSchema
  .extend({
    /** Persons linked through TaskPerson at creation (spec §9.1). */
    peopleIds: z.array(z.uuid()).max(20),
  })
  .partial()
  .required({ title: true })
  .superRefine((input, ctx) => {
    for (const violation of taskViolations(taskInputToShape(input))) {
      ctx.addIssue({ code: "custom", message: violation });
    }
  });

export const taskUpdateSchema = taskFieldsSchema.partial();

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

/** Builds the invariant-checkable shape from a (possibly partial) DTO. */
export function taskInputToShape(input: Partial<TaskCreateInput>): TaskShape {
  return {
    title: input.title ?? "untitled",
    status: "open",
    taskKind: input.taskKind ?? "action",
    deadlineDate: input.deadlineDate ? isoDateToDb(input.deadlineDate) : null,
    deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null,
    deadlineTimezone: input.deadlineTimezone ?? null,
    deadlineType: input.deadlineType ?? null,
    remindAt: input.remindAt ? new Date(input.remindAt) : null,
    reminderTimezone: input.reminderTimezone ?? null,
    waitingForPersonId: input.waitingForPersonId ?? null,
    nudgeDate: input.nudgeDate ? isoDateToDb(input.nudgeDate) : null,
    estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
    remainingEstimateMinutes: input.remainingEstimateMinutes ?? null,
    computedPriorityScore: input.computedPriorityScore ?? 50,
    preferredWindowStartTime: input.preferredWindowStartTime
      ? timeOfDayToDb(input.preferredWindowStartTime)
      : null,
    preferredWindowEndTime: input.preferredWindowEndTime
      ? timeOfDayToDb(input.preferredWindowEndTime)
      : null,
    completedAt: null,
  };
}

// --- Event ----------------------------------------------------------------

export const eventFieldsSchema = z.object({
  title: trimmed,
  // Manual/extraction flows never produce blocks in Phase 1; the scheduler
  // introduces kind=block in Phase 2 (spec cross-review decision).
  kind: z.enum(EventKind).refine((k) => k !== "block", {
    message: "block events do not exist in Phase 1",
  }),
  scheduleType: z.enum(ScheduleType),
  isLocked: z.boolean(),
  startAt: isoInstant.nullish(),
  endAt: isoInstant.nullish(),
  allDayStartDate: isoDate.nullish(),
  allDayEndDate: isoDate.nullish(),
  timezone,
  projectId: z.uuid().nullish(),
  captureId: z.uuid().nullish(),
  description: optionalText,
  location: optionalText,
  notes: optionalText,
});

export const eventCreateSchema = eventFieldsSchema
  .extend({
    /** Participants linked through EventPerson at creation (spec §9.1; finding 19). */
    peopleIds: z.array(z.uuid()).max(20),
  })
  .partial()
  .required({ title: true, kind: true, scheduleType: true, timezone: true })
  .superRefine((input, ctx) => {
    for (const violation of eventViolations(eventInputToShape(input))) {
      ctx.addIssue({ code: "custom", message: violation });
    }
  });

export const eventUpdateSchema = eventFieldsSchema.partial();

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;

export function eventInputToShape(input: Partial<EventCreateInput>): EventShape {
  return {
    title: input.title ?? "untitled",
    kind: input.kind ?? "other",
    scheduleType: input.scheduleType ?? "fixed",
    blockState: null,
    isLocked: input.isLocked ?? false,
    startAt: input.startAt ? new Date(input.startAt) : null,
    endAt: input.endAt ? new Date(input.endAt) : null,
    allDayStartDate: input.allDayStartDate ? isoDateToDb(input.allDayStartDate) : null,
    allDayEndDate: input.allDayEndDate ? isoDateToDb(input.allDayEndDate) : null,
    timezone: input.timezone ?? "America/New_York",
    taskId: null,
  };
}

// --- Simple entities ------------------------------------------------------

export const noteCreateSchema = z.object({
  body: trimmed,
  title: optionalText,
  projectId: z.uuid().nullish(),
  captureId: z.uuid().nullish(),
});
export const noteUpdateSchema = noteCreateSchema.partial();

export const personCreateSchema = z.object({
  name: trimmed,
  role: optionalText,
  notes: optionalText,
  aliases: z.array(trimmed).max(20).default([]),
});
export const personUpdateSchema = z.object({
  name: trimmed.optional(),
  role: optionalText,
  notes: optionalText,
});
export const aliasAddSchema = z.object({ alias: trimmed });

export const projectCreateSchema = z.object({
  kind: z.enum(ProjectKind),
  name: trimmed,
  parentId: z.uuid().nullish(),
  description: optionalText,
  importance: z.enum(Importance).nullish(),
});
export const projectUpdateSchema = z.object({
  name: trimmed.optional(),
  parentId: z.uuid().nullish(),
  description: optionalText,
  importance: z.enum(Importance).nullish(),
  status: z.enum(["active", "completed"]).optional(),
});

export const glossaryEntrySchema = z.object({
  term: trimmed,
  expandsTo: trimmed,
  entityType: z.enum(EntityType).nullish(),
  entityId: z.uuid().nullish(),
}).refine((g) => (g.entityType == null) === (g.entityId == null), {
  message: "entity type and entity id must be set together",
});

export const settingsUpdateSchema = z.object({ currentTimezone: timezone });

export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type PersonCreateInput = z.infer<typeof personCreateSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type GlossaryEntryInput = z.infer<typeof glossaryEntrySchema>;

/**
 * Zod contracts for the Phase 2 scheduler-constraint settings (product-spec
 * §7.1; decisions.md 2026-09-05 "Phase 2 migration"). Times are "HH:MM"
 * local wall-clock values in the user's current zone; weekdays are ISO
 * (1 = Monday … 7 = Sunday). Cross-field rules also live in
 * `windowViolations` so partial updates are checked on the merged row.
 */
import { z } from "zod";
import { AvailabilityKind, JobTimePolicy, WindowRecurrence, WorkType } from "./enums";
import { timeOfDayToMinutes } from "./time";

const timeOfDay = z.string().refine((v) => timeOfDayToMinutes(v) !== null, "expected HH:MM (24h)");
const weekday = z.number().int().min(1).max(7);
const label = z.string().trim().min(1).max(60).nullish();

export type WindowKind = "availability" | "protected" | "preferred";
export const WINDOW_KINDS: WindowKind[] = ["availability", "protected", "preferred"];

export interface WindowShape {
  startTime: string;
  endTime: string;
  recurrence?: "weekly" | "once" | null;
  weekday?: number | null;
  onDate?: string | null;
}

/** Cross-field rules shared by creates (schema) and partial updates (merged row). */
export function windowViolations(kind: WindowKind, w: WindowShape): string[] {
  const v: string[] = [];
  const start = timeOfDayToMinutes(w.startTime);
  const end = timeOfDayToMinutes(w.endTime);
  if (start === null || end === null) v.push("times must be HH:MM (24h)");
  else if (start >= end) v.push("start time must be before end time (no overnight windows in V1)");
  if (kind === "availability" && (w.weekday == null || w.weekday < 1 || w.weekday > 7)) {
    v.push("availability windows need a weekday from 1 (Monday) to 7 (Sunday)");
  }
  if (kind === "protected") {
    if (w.recurrence === "weekly" && (w.weekday == null || w.onDate != null)) {
      v.push("a weekly protected window needs a weekday and no date");
    }
    if (w.recurrence === "once" && (w.onDate == null || w.weekday != null)) {
      v.push("a one-off protected window needs a date and no weekday");
    }
  }
  return v;
}

const withWindowRules = <T extends z.ZodTypeAny>(kind: WindowKind, schema: T) =>
  schema.superRefine((value, ctx) => {
    for (const violation of windowViolations(kind, value as WindowShape)) {
      ctx.addIssue({ code: "custom", message: violation });
    }
  });

export const availabilityWindowSchema = withWindowRules(
  "availability",
  z.object({
    weekday,
    startTime: timeOfDay,
    endTime: timeOfDay,
    kind: z.enum(AvailabilityKind).default("general"),
    label,
  }),
);
export const availabilityWindowPatchSchema = z
  .object({
    weekday,
    startTime: timeOfDay,
    endTime: timeOfDay,
    kind: z.enum(AvailabilityKind),
    label,
  })
  .partial();

export const protectedWindowSchema = withWindowRules(
  "protected",
  z.object({
    recurrence: z.enum(WindowRecurrence),
    weekday: weekday.nullish(),
    onDate: z.iso.date().nullish(),
    startTime: timeOfDay,
    endTime: timeOfDay,
    label,
  }),
);
export const protectedWindowPatchSchema = z
  .object({
    recurrence: z.enum(WindowRecurrence),
    weekday: weekday.nullish(),
    onDate: z.iso.date().nullish(),
    startTime: timeOfDay,
    endTime: timeOfDay,
    label,
  })
  .partial();

export const preferredWindowSchema = withWindowRules(
  "preferred",
  z.object({
    weekday: weekday.nullish(),
    startTime: timeOfDay,
    endTime: timeOfDay,
    workType: z.enum(WorkType).nullish(),
    label,
  }),
);
export const preferredWindowPatchSchema = z
  .object({
    weekday: weekday.nullish(),
    startTime: timeOfDay,
    endTime: timeOfDay,
    workType: z.enum(WorkType).nullish(),
    label,
  })
  .partial();

export const SCHEDULER_PREFERENCE_DEFAULTS = {
  minBlockMinutes: 25,
  maxBlockMinutes: 120,
  bufferMinutes: 10,
  dailyDeepWorkCapMinutes: 240,
  jobTimePolicy: "work_related_only" as const,
  planningHorizonDays: 7,
};

export const schedulerPreferencesPatchSchema = z
  .object({
    minBlockMinutes: z.number().int().min(5).max(480),
    maxBlockMinutes: z.number().int().min(5).max(720),
    bufferMinutes: z.number().int().min(0).max(120),
    dailyDeepWorkCapMinutes: z.number().int().min(0).max(1440),
    jobTimePolicy: z.enum(JobTimePolicy),
    planningHorizonDays: z.number().int().min(1).max(31),
  })
  .partial();

export type AvailabilityWindowInput = z.infer<typeof availabilityWindowSchema>;
export type ProtectedWindowInput = z.infer<typeof protectedWindowSchema>;
export type PreferredWindowInput = z.infer<typeof preferredWindowSchema>;
export type SchedulerPreferencesPatch = z.infer<typeof schedulerPreferencesPatchSchema>;

export function preferenceViolations(p: { minBlockMinutes: number; maxBlockMinutes: number }): string[] {
  return p.minBlockMinutes > p.maxBlockMinutes ? ["minimum block length must not exceed the maximum"] : [];
}

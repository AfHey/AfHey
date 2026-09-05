/**
 * Scheduler-constraint settings: read model with defaults and the direct
 * manual mutations (spec §11.2 rule 13: settings edits increment `revision`
 * and write no Proposal). Rows belong to the single UserSettings row; times
 * travel as "HH:MM" strings and are stored as `time(0)`.
 */
import type { Prisma, PrismaClient } from "@/db/generated/client";
import { DomainInvariantError } from "./invariants";
import { RevisionConflictError } from "./mutations";
import {
  availabilityWindowPatchSchema,
  preferenceViolations,
  preferredWindowPatchSchema,
  protectedWindowPatchSchema,
  SCHEDULER_PREFERENCE_DEFAULTS,
  windowViolations,
  type AvailabilityWindowInput,
  type PreferredWindowInput,
  type ProtectedWindowInput,
  type SchedulerPreferencesPatch,
  type WindowKind,
} from "./scheduler-schemas";
import { dbToIsoDate, dbToTimeOfDay, isoDateToDb, timeOfDayToDb } from "./time";

type Db = PrismaClient | Prisma.TransactionClient;

export interface AvailabilityWindowDto {
  id: string;
  revision: number;
  weekday: number;
  startTime: string;
  endTime: string;
  kind: "general" | "job";
  label: string | null;
}
export interface ProtectedWindowDto {
  id: string;
  revision: number;
  recurrence: "weekly" | "once";
  weekday: number | null;
  onDate: string | null;
  startTime: string;
  endTime: string;
  label: string | null;
}
export interface PreferredWindowDto {
  id: string;
  revision: number;
  weekday: number | null;
  startTime: string;
  endTime: string;
  workType: "deep" | "shallow" | "study" | "communication" | "errand" | "other" | null;
  label: string | null;
}
export interface SchedulerPreferencesDto {
  revision: number | null;
  minBlockMinutes: number;
  maxBlockMinutes: number;
  bufferMinutes: number;
  dailyDeepWorkCapMinutes: number;
  jobTimePolicy: "unavailable" | "work_related_only" | "any";
  planningHorizonDays: number;
}
export interface SchedulerSettings {
  settingsId: string;
  timezone: string;
  preferences: SchedulerPreferencesDto;
  availability: AvailabilityWindowDto[];
  protected: ProtectedWindowDto[];
  preferred: PreferredWindowDto[];
}

async function settingsRow(db: Db) {
  const settings = await db.userSettings.findFirst();
  if (!settings) throw new DomainInvariantError("UserSettings", ["the user has not been provisioned"]);
  return settings;
}

/** Everything the scheduler and the settings screen need, defaults applied. */
export async function loadSchedulerSettings(db: Db): Promise<SchedulerSettings> {
  const settings = await settingsRow(db);
  const [prefs, availability, protectedRows, preferred] = await Promise.all([
    db.schedulerPreferences.findUnique({ where: { userSettingsId: settings.id } }),
    db.availabilityWindow.findMany({ where: { userSettingsId: settings.id }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }] }),
    db.protectedWindow.findMany({ where: { userSettingsId: settings.id }, orderBy: [{ recurrence: "asc" }, { weekday: "asc" }, { onDate: "asc" }, { startTime: "asc" }] }),
    db.preferredWindow.findMany({ where: { userSettingsId: settings.id }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }] }),
  ]);
  return {
    settingsId: settings.id,
    timezone: settings.currentTimezone,
    preferences: prefs
      ? {
          revision: prefs.revision,
          minBlockMinutes: prefs.minBlockMinutes,
          maxBlockMinutes: prefs.maxBlockMinutes,
          bufferMinutes: prefs.bufferMinutes,
          dailyDeepWorkCapMinutes: prefs.dailyDeepWorkCapMinutes,
          jobTimePolicy: prefs.jobTimePolicy,
          planningHorizonDays: prefs.planningHorizonDays,
        }
      : { revision: null, ...SCHEDULER_PREFERENCE_DEFAULTS },
    availability: availability.map((w) => ({
      id: w.id,
      revision: w.revision,
      weekday: w.weekday,
      startTime: dbToTimeOfDay(w.startTime),
      endTime: dbToTimeOfDay(w.endTime),
      kind: w.kind,
      label: w.label,
    })),
    protected: protectedRows.map((w) => ({
      id: w.id,
      revision: w.revision,
      recurrence: w.recurrence,
      weekday: w.weekday,
      onDate: w.onDate ? dbToIsoDate(w.onDate) : null,
      startTime: dbToTimeOfDay(w.startTime),
      endTime: dbToTimeOfDay(w.endTime),
      label: w.label,
    })),
    preferred: preferred.map((w) => ({
      id: w.id,
      revision: w.revision,
      weekday: w.weekday,
      startTime: dbToTimeOfDay(w.startTime),
      endTime: dbToTimeOfDay(w.endTime),
      workType: w.workType,
      label: w.label,
    })),
  };
}

export async function updateSchedulerPreferences(db: PrismaClient, patch: SchedulerPreferencesPatch) {
  return db.$transaction(async (tx) => {
    const settings = await settingsRow(tx);
    const current = await tx.schedulerPreferences.findUnique({ where: { userSettingsId: settings.id } });
    const merged = { ...SCHEDULER_PREFERENCE_DEFAULTS, ...(current ?? {}), ...patch };
    const violations = preferenceViolations(merged);
    if (violations.length > 0) throw new DomainInvariantError("SchedulerPreferences", violations);
    if (!current) {
      return tx.schedulerPreferences.create({ data: { userSettingsId: settings.id, ...patch } });
    }
    const updated = await tx.schedulerPreferences.updateMany({
      where: { id: current.id, revision: current.revision },
      data: { ...patch, revision: { increment: 1 } },
    });
    if (updated.count !== 1) throw new RevisionConflictError("SchedulerPreferences", current.id);
    return tx.schedulerPreferences.findUniqueOrThrow({ where: { id: current.id } });
  });
}

function assertWindow(kind: WindowKind, shape: Parameters<typeof windowViolations>[1]): void {
  const violations = windowViolations(kind, shape);
  if (violations.length > 0) throw new DomainInvariantError("Window", violations);
}

export async function createWindow(
  db: PrismaClient,
  kind: WindowKind,
  input: AvailabilityWindowInput | ProtectedWindowInput | PreferredWindowInput,
) {
  return db.$transaction(async (tx) => {
    const settings = await settingsRow(tx);
    assertWindow(kind, input as never);
    const times = { startTime: timeOfDayToDb(input.startTime), endTime: timeOfDayToDb(input.endTime) };
    switch (kind) {
      case "availability": {
        const w = input as AvailabilityWindowInput;
        return tx.availabilityWindow.create({
          data: { userSettingsId: settings.id, weekday: w.weekday, kind: w.kind, label: w.label ?? null, ...times },
        });
      }
      case "protected": {
        const w = input as ProtectedWindowInput;
        return tx.protectedWindow.create({
          data: {
            userSettingsId: settings.id,
            recurrence: w.recurrence,
            weekday: w.weekday ?? null,
            onDate: w.onDate ? isoDateToDb(w.onDate) : null,
            label: w.label ?? null,
            ...times,
          },
        });
      }
      case "preferred": {
        const w = input as PreferredWindowInput;
        return tx.preferredWindow.create({
          data: { userSettingsId: settings.id, weekday: w.weekday ?? null, workType: w.workType ?? null, label: w.label ?? null, ...times },
        });
      }
    }
  });
}

/** Partial update: the merged row is re-validated; the write is revision-guarded. */
export async function updateWindow(db: PrismaClient, kind: WindowKind, id: string, rawPatch: unknown) {
  return db.$transaction(async (tx) => {
    switch (kind) {
      case "availability": {
        const patch = availabilityWindowPatchSchema.parse(rawPatch);
        const current = await tx.availabilityWindow.findUniqueOrThrow({ where: { id } });
        const merged = {
          weekday: patch.weekday ?? current.weekday,
          startTime: patch.startTime ?? dbToTimeOfDay(current.startTime),
          endTime: patch.endTime ?? dbToTimeOfDay(current.endTime),
        };
        assertWindow(kind, merged);
        const updated = await tx.availabilityWindow.updateMany({
          where: { id, revision: current.revision },
          data: {
            weekday: patch.weekday,
            kind: patch.kind,
            label: patch.label,
            startTime: patch.startTime ? timeOfDayToDb(patch.startTime) : undefined,
            endTime: patch.endTime ? timeOfDayToDb(patch.endTime) : undefined,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new RevisionConflictError("AvailabilityWindow", id);
        return tx.availabilityWindow.findUniqueOrThrow({ where: { id } });
      }
      case "protected": {
        const patch = protectedWindowPatchSchema.parse(rawPatch);
        const current = await tx.protectedWindow.findUniqueOrThrow({ where: { id } });
        const merged = {
          recurrence: patch.recurrence ?? current.recurrence,
          weekday: patch.weekday === undefined ? current.weekday : patch.weekday,
          onDate: patch.onDate === undefined ? (current.onDate ? dbToIsoDate(current.onDate) : null) : patch.onDate,
          startTime: patch.startTime ?? dbToTimeOfDay(current.startTime),
          endTime: patch.endTime ?? dbToTimeOfDay(current.endTime),
        };
        assertWindow(kind, merged);
        const updated = await tx.protectedWindow.updateMany({
          where: { id, revision: current.revision },
          data: {
            recurrence: patch.recurrence,
            weekday: patch.weekday,
            onDate: patch.onDate === undefined ? undefined : patch.onDate ? isoDateToDb(patch.onDate) : null,
            label: patch.label,
            startTime: patch.startTime ? timeOfDayToDb(patch.startTime) : undefined,
            endTime: patch.endTime ? timeOfDayToDb(patch.endTime) : undefined,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new RevisionConflictError("ProtectedWindow", id);
        return tx.protectedWindow.findUniqueOrThrow({ where: { id } });
      }
      case "preferred": {
        const patch = preferredWindowPatchSchema.parse(rawPatch);
        const current = await tx.preferredWindow.findUniqueOrThrow({ where: { id } });
        const merged = {
          startTime: patch.startTime ?? dbToTimeOfDay(current.startTime),
          endTime: patch.endTime ?? dbToTimeOfDay(current.endTime),
        };
        assertWindow(kind, merged);
        const updated = await tx.preferredWindow.updateMany({
          where: { id, revision: current.revision },
          data: {
            weekday: patch.weekday,
            workType: patch.workType,
            label: patch.label,
            startTime: patch.startTime ? timeOfDayToDb(patch.startTime) : undefined,
            endTime: patch.endTime ? timeOfDayToDb(patch.endTime) : undefined,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new RevisionConflictError("PreferredWindow", id);
        return tx.preferredWindow.findUniqueOrThrow({ where: { id } });
      }
    }
  });
}

/** Windows are settings rows, not domain records: removal is a plain delete. */
export async function deleteWindow(db: PrismaClient, kind: WindowKind, id: string) {
  switch (kind) {
    case "availability":
      return db.availabilityWindow.delete({ where: { id } });
    case "protected":
      return db.protectedWindow.delete({ where: { id } });
    case "preferred":
      return db.preferredWindow.delete({ where: { id } });
  }
}

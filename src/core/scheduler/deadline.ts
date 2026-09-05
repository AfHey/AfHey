/**
 * One rule for turning a Task's stored deadline into an instant: a timed
 * deadline is its own instant; a date-only deadline ends at the end of that
 * calendar day in the user's current zone (spec §8.1: dates stay dates until
 * arithmetic needs an instant).
 */
import { DateTime } from "luxon";
import { dbToIsoDate } from "@/core/domain/time";

export interface DeadlineFields {
  deadlineAt: Date | null;
  deadlineDate: Date | null;
  deadlineTimezone?: string | null;
}

export function deadlineInstant(task: DeadlineFields, zone: string): DateTime | null {
  if (task.deadlineAt) return DateTime.fromJSDate(task.deadlineAt).setZone(task.deadlineTimezone ?? zone);
  if (task.deadlineDate) return DateTime.fromISO(dbToIsoDate(task.deadlineDate), { zone }).endOf("day");
  return null;
}

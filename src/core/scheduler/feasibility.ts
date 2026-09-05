/**
 * Feasibility check (product-spec §7.1 item 2; Phase 2 Step 5). For a task
 * with a deadline and an explicit remaining estimate: does the estimate fit
 * into the eligible free time between now and the deadline? Computed on
 * read from the timeline; nothing is stored. A task without an estimate is
 * `estimate_required`, never assumed feasible.
 */
import { DateTime } from "luxon";
import { minutesOf, type Interval } from "./timeline";

export type FeasibilityStatus = "fits" | "at_risk" | "estimate_required" | "no_deadline" | "not_schedulable";

export interface Feasibility {
  status: FeasibilityStatus;
  remainingMinutes: number | null;
  /** Eligible free minutes between now and the deadline (null when not applicable). */
  capacityMinutes: number | null;
  shortfallMinutes: number;
  /** Local date on which the eligible capacity before the deadline runs out. */
  runsOutOn: string | null;
}

export interface DayCapacity {
  date: string;
  minutes: number;
}

/** Free minutes per local calendar day. */
export function capacityByDay(free: Interval[], zone: string): DayCapacity[] {
  const byDay = new Map<string, number>();
  for (const interval of free) {
    let cursor = interval.start;
    while (cursor < interval.end) {
      const day = DateTime.fromMillis(cursor, { zone });
      const nextMidnight = day.plus({ days: 1 }).startOf("day").toMillis();
      const sliceEnd = Math.min(interval.end, nextMidnight);
      const date = day.toISODate()!;
      byDay.set(date, (byDay.get(date) ?? 0) + minutesOf({ start: cursor, end: sliceEnd }));
      cursor = sliceEnd;
    }
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, minutes]) => ({ date, minutes }));
}

export interface FeasibilityTask {
  status: "open" | "completed" | "cancelled";
  isSchedulable: boolean;
  remainingEstimateMinutes: number | null;
  deadlineAt: number | null;
}

/**
 * `freeBeforeDeadline` is the task's eligible free time from now until its
 * deadline (already filtered for its admissible windows); it is ignored when
 * the task has no deadline or no estimate.
 */
export function assessFeasibility(task: FeasibilityTask, freeBeforeDeadline: Interval[], zone: string): Feasibility {
  const none = { remainingMinutes: task.remainingEstimateMinutes, capacityMinutes: null, shortfallMinutes: 0, runsOutOn: null };
  if (task.status !== "open" || !task.isSchedulable) return { status: "not_schedulable", ...none };
  if (task.remainingEstimateMinutes === null) return { status: "estimate_required", ...none };
  if (task.deadlineAt === null) return { status: "no_deadline", ...none };
  const days = capacityByDay(freeBeforeDeadline, zone);
  const capacityMinutes = days.reduce((sum, d) => sum + d.minutes, 0);
  const shortfall = Math.max(0, task.remainingEstimateMinutes - capacityMinutes);
  return {
    status: shortfall > 0 ? "at_risk" : "fits",
    remainingMinutes: task.remainingEstimateMinutes,
    capacityMinutes,
    shortfallMinutes: shortfall,
    runsOutOn: shortfall > 0 ? (days.filter((d) => d.minutes > 0).at(-1)?.date ?? null) : null,
  };
}

/** Today's capacity check (spec §4.1 item 1): scheduled versus available minutes. */
export function dayCapacityCheck(freeToday: Interval[], scheduledMinutes: number): {
  availableMinutes: number;
  scheduledMinutes: number;
  overcommittedMinutes: number;
} {
  const available = free(freeToday);
  return { availableMinutes: available, scheduledMinutes, overcommittedMinutes: Math.max(0, scheduledMinutes - available) };
}

function free(intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + minutesOf(i), 0);
}

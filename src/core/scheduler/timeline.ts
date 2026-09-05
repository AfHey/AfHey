/**
 * Timeline and free time (Phase 2 Step 3; product-spec §7). Pure functions
 * over half-open instant intervals `[start, end)` in epoch milliseconds.
 * Local wall-clock windows are converted per day with Luxon in the user's
 * zone, so a spring-forward day yields 23 hours of timeline and a fall-back
 * day 25 (Lord Howe: 23.5 / 24.5). `now` is always an input; nothing here
 * reads a clock.
 */
import { DateTime } from "luxon";
import { timeOfDayToMinutes } from "@/core/domain/time";

export interface Interval {
  start: number;
  end: number;
}

export interface LocalWindow {
  /** ISO weekday 1–7, or null for every day. */
  weekday: number | null;
  startTime: string;
  endTime: string;
}

export interface ProtectedWindowLike {
  recurrence: "weekly" | "once";
  weekday: number | null;
  onDate: string | null;
  startTime: string;
  endTime: string;
}

export const GRID_MINUTES = 5;
const MINUTE = 60_000;

// --- Interval algebra --------------------------------------------------------

/** Sorted, merged, non-empty intervals. */
export function normalize(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function subtract(base: Interval[], remove: Interval[]): Interval[] {
  let result = normalize(base);
  for (const r of normalize(remove)) {
    const next: Interval[] = [];
    for (const b of result) {
      if (r.end <= b.start || r.start >= b.end) {
        next.push(b);
        continue;
      }
      if (r.start > b.start) next.push({ start: b.start, end: r.start });
      if (r.end < b.end) next.push({ start: r.end, end: b.end });
    }
    result = next;
  }
  return result;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of normalize(a)) {
    for (const y of normalize(b)) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return normalize(out);
}

export function totalMinutes(intervals: Interval[]): number {
  return normalize(intervals).reduce((sum, i) => sum + (i.end - i.start) / MINUTE, 0);
}

/** Grows every interval by `minutes` on both sides (buffers around busy items). */
export function pad(intervals: Interval[], minutes: number): Interval[] {
  const ms = minutes * MINUTE;
  return normalize(intervals.map((i) => ({ start: i.start - ms, end: i.end + ms })));
}

/** Starts round up and ends round down to the grid; slivers vanish. */
export function snapToGrid(intervals: Interval[], gridMinutes = GRID_MINUTES): Interval[] {
  const g = gridMinutes * MINUTE;
  return normalize(
    intervals.map((i) => ({ start: Math.ceil(i.start / g) * g, end: Math.floor(i.end / g) * g })),
  );
}

// --- Local windows on a day ---------------------------------------------------

/** Midnight of the calendar date in the zone. */
export function dayStart(dateIso: string, zone: string): DateTime {
  return DateTime.fromISO(dateIso, { zone }).startOf("day");
}

/** Every calendar day touched by [start, end), as ISO dates in the zone. */
export function daysCovering(start: number, end: number, zone: string): string[] {
  const days: string[] = [];
  let cursor = DateTime.fromMillis(start, { zone }).startOf("day");
  const last = DateTime.fromMillis(end - 1, { zone }).startOf("day");
  while (cursor <= last) {
    days.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

/**
 * The instant at which the zone's offset changes between `before` (old
 * offset) and `after` (new offset): a minute-resolution binary search over
 * real offsets, so every zone and gap length is handled the same way.
 */
function transitionInstant(before: DateTime, after: DateTime): number {
  let lo = before.toMillis();
  let hi = after.toMillis();
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
    if (DateTime.fromMillis(mid, { zone: after.zone }).offset === after.offset) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * A local wall-clock time on the given day as an instant. A time that does
 * not exist (inside a DST gap) resolves to the transition instant — the
 * moment the clock jumps — not to Luxon's forward-shifted wall time, so a
 * window is never lengthened by a gap. An ambiguous time (DST fold) takes
 * its first occurrence.
 */
export function localInstant(day: DateTime, minutesOfDay: number): number {
  const dt = day.set({ hour: Math.floor(minutesOfDay / 60), minute: minutesOfDay % 60, second: 0, millisecond: 0 });
  const got = dt.hour * 60 + dt.minute;
  if (got === minutesOfDay || dt.offset === day.offset) return dt.toMillis();
  return transitionInstant(day, dt);
}

/**
 * A local wall-clock window on one day, as an instant interval. Nonexistent
 * local times are skipped (see `localInstant`); a window that collapses to
 * nothing is null.
 */
export function localWindowOnDay(day: DateTime, startTime: string, endTime: string): Interval | null {
  const s = timeOfDayToMinutes(startTime);
  const e = timeOfDayToMinutes(endTime);
  if (s === null || e === null || !day.isValid) return null;
  const start = localInstant(day, s);
  const end = localInstant(day, e);
  if (end <= start) return null;
  return { start, end };
}

function appliesOnDay(window: LocalWindow, day: DateTime): boolean {
  return window.weekday === null || window.weekday === day.weekday;
}

function protectedAppliesOnDay(window: ProtectedWindowLike, day: DateTime): boolean {
  return window.recurrence === "weekly" ? window.weekday === day.weekday : window.onDate === day.toISODate();
}

export interface DayTimelineInputs {
  zone: string;
  /** Windows the scheduler may use (already filtered to the admissible kinds). */
  availability: LocalWindow[];
  protectedWindows: ProtectedWindowLike[];
  /** Fixed Events, kept blocks, anything else that consumes time (instants). */
  busy: Interval[];
  bufferMinutes: number;
  gridMinutes?: number;
}

/** Free intervals on one calendar day. */
export function freeOnDay(dateIso: string, inputs: DayTimelineInputs): Interval[] {
  const day = dayStart(dateIso, inputs.zone);
  const available = inputs.availability
    .filter((w) => appliesOnDay(w, day))
    .map((w) => localWindowOnDay(day, w.startTime, w.endTime))
    .filter((i): i is Interval => i !== null);
  const blocked = inputs.protectedWindows
    .filter((w) => protectedAppliesOnDay(w, day))
    .map((w) => localWindowOnDay(day, w.startTime, w.endTime))
    .filter((i): i is Interval => i !== null);
  const free = subtract(subtract(available, blocked), pad(inputs.busy, inputs.bufferMinutes));
  return snapToGrid(free, inputs.gridMinutes ?? GRID_MINUTES);
}

/**
 * Free intervals over an instant range: per-day timelines in the zone,
 * clipped to the range (so `now` cuts off the past) and merged.
 */
export function freeTime(range: Interval, inputs: DayTimelineInputs): Interval[] {
  if (range.end <= range.start) return [];
  const perDay = daysCovering(range.start, range.end, inputs.zone).flatMap((d) => freeOnDay(d, inputs));
  return intersect(perDay, [range]);
}

/** Read-only primitive `get_free_time` (spec §12.3): slots of at least `minMinutes`. */
export function getFreeTime(range: Interval, inputs: DayTimelineInputs, minMinutes: number): Interval[] {
  return freeTime(range, inputs).filter((i) => i.end - i.start >= minMinutes * MINUTE);
}

export function minutesOf(interval: Interval): number {
  return (interval.end - interval.start) / MINUTE;
}

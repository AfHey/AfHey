/**
 * Placement engine (product-spec §7; Phase 2 Step 6; docs/phase-2-plan.md
 * Section 5). A pure function from explicit inputs to a desired set of
 * blocks and the diff against the blocks it may move. No clock, no I/O, no
 * randomness: identical inputs give identical output.
 *
 *   A. per-day timelines → free intervals (general and job availability)
 *   B. which existing blocks are kept (busy) and which are re-plannable
 *   C. task order: band, slack to the deadline, score, age, id
 *   D. chronological placement per task with splitting, block bounds,
 *      the deep-work cap, hard/soft deadlines, and preference scoring
 *   E. diff: moves, cancels, creates, unplaced remainders, reasons
 */
import { DateTime } from "luxon";
import type { ProtectedWindowLike, Interval, LocalWindow } from "./timeline";
import { dayStart, freeTime, intersect, localWindowOnDay, minutesOf, normalize, pad, subtract } from "./timeline";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Slack looks this far past the planning range when a deadline is further out. */
const SLACK_HORIZON_DAYS = 14;

export type WorkType = "deep" | "shallow" | "study" | "communication" | "errand" | "other";
export type Band = "must" | "should" | "could";
export type Domain = "work" | "personal" | null;
export type JobTimePolicy = "unavailable" | "work_related_only" | "any";

export interface PlanTask {
  id: string;
  title: string;
  remainingMinutes: number;
  isSplittable: boolean;
  workType: WorkType | null;
  domain: Domain;
  deadlineAt: number | null;
  deadlineType: "hard" | "soft" | null;
  /** Start of `earliest_start_date` in the user's zone, or null. */
  earliestStart: number | null;
  preferredWindow: { startTime: string; endTime: string } | null;
  effectivePriority: Band;
  score: number;
  createdAt: number;
}

export interface PlanBlock {
  id: string;
  taskId: string;
  start: number;
  end: number;
  revision: number;
  state: "planned" | "in_progress" | "completed" | "missed_unconfirmed" | "cancelled";
  isLocked: boolean;
  scheduleType: "fixed" | "flexible";
}

export interface PlanPreferences {
  minBlockMinutes: number;
  maxBlockMinutes: number;
  bufferMinutes: number;
  dailyDeepWorkCapMinutes: number;
  jobTimePolicy: JobTimePolicy;
}

export interface PreferredWindowLike extends LocalWindow {
  workType: WorkType | null;
}

export interface PlanContext {
  now: number;
  zone: string;
  /** The planning range; placement never starts before `now`. */
  range: Interval;
  preferences: PlanPreferences;
  availability: Array<LocalWindow & { kind: "general" | "job" }>;
  protectedWindows: ProtectedWindowLike[];
  preferredWindows: PreferredWindowLike[];
  /** Fixed Events and kept blocks as instants (kept blocks are also listed below). */
  busy: Interval[];
  /** Blocks left alone by this run (locked, fixed, in progress, completed, outside scope). */
  keptBlocks: PlanBlock[];
  /** Blocks this run may move or cancel; their time counts as free. */
  replannable: PlanBlock[];
  tasks: PlanTask[];
}

export interface Placement {
  taskId: string;
  start: number;
  end: number;
  reasons: string[];
}

export interface PlanResult {
  placements: Placement[];
  moves: Array<{ block: PlanBlock; start: number; end: number; reasons: string[] }>;
  creates: Placement[];
  cancels: Array<{ block: PlanBlock; reason: string }>;
  unplaced: Array<{ taskId: string; minutes: number; reason: string }>;
  warnings: string[];
}

const BAND_ORDER: Record<Band, number> = { must: 0, should: 1, could: 2 };

function admitsJobTime(policy: JobTimePolicy, domain: Domain): boolean {
  return policy === "any" || (policy === "work_related_only" && domain === "work");
}

function coveredMinutes(task: PlanTask, kept: PlanBlock[], now: number): number {
  return kept
    .filter((b) => b.taskId === task.id && (b.state === "planned" || b.state === "in_progress") && b.end > now)
    .reduce((sum, b) => sum + minutesOf({ start: Math.max(b.start, now), end: b.end }), 0);
}

/** Preferred windows that apply to this task on the day containing `instant`, as instant intervals. */
function preferredWindowsFor(task: PlanTask, instant: number, ctx: PlanContext): Interval[] {
  const day = dayStart(DateTime.fromMillis(instant, { zone: ctx.zone }).toISODate()!, ctx.zone);
  const windows: Interval[] = [];
  for (const w of ctx.preferredWindows) {
    if (w.weekday !== null && w.weekday !== day.weekday) continue;
    if (w.workType !== null && w.workType !== task.workType) continue;
    const local = localWindowOnDay(day, w.startTime, w.endTime);
    if (local) windows.push(local);
  }
  if (task.preferredWindow) {
    const local = localWindowOnDay(day, task.preferredWindow.startTime, task.preferredWindow.endTime);
    if (local) windows.push(local);
  }
  return normalize(windows);
}

function overlapMinutes(interval: Interval, windows: Interval[]): number {
  return intersect([interval], windows).reduce((sum, i) => sum + minutesOf(i), 0);
}

/**
 * Block length for a splittable task: never more than the maximum, never
 * more than fits, and never leaving a remainder too small to place later.
 */
function splitLength(remaining: number, available: number, min: number, max: number): number | null {
  let length = Math.min(remaining, max, available);
  const remainder = remaining - length;
  if (remainder > 0 && remainder < min) length = remaining - min;
  return length >= min ? length : null;
}

interface Candidate {
  start: number;
  end: number;
  score: number;
  reasons: string[];
}

export function plan(ctx: PlanContext): PlanResult {
  const { preferences: p } = ctx;
  const start = Math.max(ctx.range.start, ctx.now);
  const range: Interval = { start, end: ctx.range.end };
  const warnings: string[] = [];

  // A. timelines
  const timeline = (kinds: Array<"general" | "job">, over: Interval) =>
    freeTime(over, {
      zone: ctx.zone,
      availability: ctx.availability.filter((w) => kinds.includes(w.kind)),
      protectedWindows: ctx.protectedWindows,
      busy: ctx.busy,
      bufferMinutes: p.bufferMinutes,
    });
  let freeGeneral = timeline(["general"], range);
  let freeJob = timeline(["job"], range);

  // Deep-work minutes already committed per local day by kept blocks.
  const deepByDay = new Map<string, number>();
  const dayKeyOf = (instant: number) => DateTime.fromMillis(instant, { zone: ctx.zone }).toISODate()!;
  const taskById = new Map(ctx.tasks.map((t) => [t.id, t]));
  for (const b of ctx.keptBlocks) {
    const t = taskById.get(b.taskId);
    if (t?.workType === "deep" && (b.state === "planned" || b.state === "in_progress")) {
      deepByDay.set(dayKeyOf(b.start), (deepByDay.get(dayKeyOf(b.start)) ?? 0) + minutesOf(b));
    }
  }

  // C. order — slack counts eligible free time from the range start up to
  // the deadline (bounded), so a task due sooner goes first within a band.
  const remaining = new Map<string, number>();
  const slack = new Map<string, number>();
  for (const t of ctx.tasks) {
    const rem = Math.max(0, t.remainingMinutes - coveredMinutes(t, ctx.keptBlocks, ctx.now));
    remaining.set(t.id, rem);
    if (t.deadlineAt === null) {
      slack.set(t.id, Number.POSITIVE_INFINITY);
      continue;
    }
    const horizon: Interval = { start: range.start, end: Math.min(t.deadlineAt, range.start + SLACK_HORIZON_DAYS * DAY) };
    const kinds: Array<"general" | "job"> = admitsJobTime(p.jobTimePolicy, t.domain) ? ["general", "job"] : ["general"];
    const eligible = horizon.end > horizon.start ? timeline(kinds, horizon) : [];
    slack.set(t.id, eligible.reduce((s, i) => s + minutesOf(i), 0) - rem);
  }
  const ordered = [...ctx.tasks].sort(
    (a, b) =>
      BAND_ORDER[a.effectivePriority] - BAND_ORDER[b.effectivePriority] ||
      slack.get(a.id)! - slack.get(b.id)! ||
      b.score - a.score ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );

  // D. placement
  const placements: Placement[] = [];
  const unplaced: PlanResult["unplaced"] = [];

  for (const task of ordered) {
    let rem = remaining.get(task.id)!;
    if (rem <= 0) continue;
    const useJob = admitsJobTime(p.jobTimePolicy, task.domain);
    const earliest = Math.max(range.start, task.earliestStart ?? range.start);
    const taskPlacements: Placement[] = [];
    const passes: Array<"before_deadline" | "after_soft_deadline"> =
      task.deadlineAt !== null && task.deadlineType !== "hard" ? ["before_deadline", "after_soft_deadline"] : ["before_deadline"];
    let sawEligibleBeforeDeadline = false;

    for (const pass of passes) {
      while (rem > 0) {
        const eligible = useJob ? normalize([...freeGeneral, ...freeJob]) : freeGeneral;
        const candidates: Candidate[] = [];
        for (const raw of eligible) {
          const from = Math.max(raw.start, earliest);
          let to = raw.end;
          if (task.deadlineAt !== null && pass === "before_deadline") to = Math.min(to, task.deadlineAt);
          if (task.deadlineAt !== null && pass === "after_soft_deadline" && to <= task.deadlineAt) continue;
          if (to - from < p.minBlockMinutes * MINUTE) continue;
          if (pass === "before_deadline") sawEligibleBeforeDeadline = true;

          // Candidate starts: the interval start and every preferred-window
          // start inside it, so a preferred window mid-interval is reachable.
          const preferred = preferredWindowsFor(task, from, ctx);
          const starts = [from, ...preferred.map((w) => w.start).filter((s) => s > from && to - s >= p.minBlockMinutes * MINUTE)];

          for (const s of starts) {
            const available = (to - s) / MINUTE;
            let length: number | null;
            if (task.isSplittable) length = splitLength(rem, available, p.minBlockMinutes, p.maxBlockMinutes);
            else length = available >= rem ? rem : null;
            if (length === null) continue;
            if (task.workType === "deep") {
              const capLeft = p.dailyDeepWorkCapMinutes - (deepByDay.get(dayKeyOf(s)) ?? 0);
              if (task.isSplittable) length = splitLength(rem, Math.min(available, capLeft), p.minBlockMinutes, p.maxBlockMinutes);
              else if (capLeft < rem) length = null;
              if (length === null) continue;
            }
            const block = { start: s, end: s + length * MINUTE };
            const preferredMinutes = overlapMinutes(block, preferred);
            const inJob = freeJob.some((j) => block.start >= j.start && block.end <= j.end) && !freeGeneral.some((g) => block.start >= g.start && block.end <= g.end);
            const reasons: string[] = [];
            if (preferredMinutes > 0) reasons.push(preferredMinutes >= length ? "inside a preferred window" : "partly inside a preferred window");
            if (inJob) reasons.push("job time for a work-area task");
            if (pass === "after_soft_deadline") reasons.push("after the soft deadline: no earlier eligible time");
            const score = (preferredMinutes / length) * 100 - ((block.start - range.start) / MINUTE) * 0.01 + (length >= rem ? 10 : 0);
            candidates.push({ ...block, score, reasons });
          }
        }
        if (candidates.length === 0) break;
        candidates.sort((a, b) => b.score - a.score || a.start - b.start);
        const chosen = candidates[0];
        if (chosen.reasons.length === 0) chosen.reasons.push("earliest free time");
        taskPlacements.push({ taskId: task.id, start: chosen.start, end: chosen.end, reasons: chosen.reasons });
        const placedMinutes = (chosen.end - chosen.start) / MINUTE;
        rem -= placedMinutes;
        if (task.workType === "deep") deepByDay.set(dayKeyOf(chosen.start), (deepByDay.get(dayKeyOf(chosen.start)) ?? 0) + placedMinutes);
        const occupied = pad([{ start: chosen.start, end: chosen.end }], p.bufferMinutes);
        freeGeneral = subtract(freeGeneral, occupied);
        freeJob = subtract(freeJob, occupied);
      }
      if (rem <= 0) break;
    }

    if (taskPlacements.length > 1) taskPlacements.forEach((pl, i) => pl.reasons.push(`part ${i + 1} of ${taskPlacements.length}`));
    placements.push(...taskPlacements);
    if (rem > 0) {
      let reason: string;
      if (task.deadlineAt !== null && task.deadlineType === "hard" && !sawEligibleBeforeDeadline) reason = "no eligible free time before the hard deadline";
      else if (!task.isSplittable && taskPlacements.length === 0) reason = `needs one uninterrupted slot of ${rem} minutes`;
      else if (task.deadlineAt !== null && task.deadlineType === "hard") reason = "not enough eligible free time before the hard deadline";
      else reason = "no eligible free time left in the planning range";
      unplaced.push({ taskId: task.id, minutes: rem, reason });
    }
  }

  // E. diff against re-plannable blocks
  const moves: PlanResult["moves"] = [];
  const creates: Placement[] = [];
  const cancels: PlanResult["cancels"] = [];
  const inScope = new Set(ctx.tasks.map((t) => t.id));
  const byTask = new Map<string, PlanBlock[]>();
  for (const b of [...ctx.replannable].sort((a, c) => a.start - c.start || a.id.localeCompare(c.id))) {
    if (!inScope.has(b.taskId)) continue;
    byTask.set(b.taskId, [...(byTask.get(b.taskId) ?? []), b]);
  }
  for (const task of ordered) {
    const olds = byTask.get(task.id) ?? [];
    // A block that ended without an outcome stays on record as missed: it is
    // cancelled and the work is placed in a new block, never moved.
    for (const missed of olds.filter((b) => b.state === "missed_unconfirmed")) {
      cancels.push({ block: missed, reason: "re-placing a block that ended without an outcome" });
    }
    const pairable = olds.filter((b) => b.state !== "missed_unconfirmed");
    const news = placements.filter((pl) => pl.taskId === task.id).sort((a, b) => a.start - b.start);
    const n = Math.min(pairable.length, news.length);
    for (let i = 0; i < n; i++) {
      if (pairable[i].start !== news[i].start || pairable[i].end !== news[i].end) {
        moves.push({ block: pairable[i], start: news[i].start, end: news[i].end, reasons: news[i].reasons });
      }
    }
    for (const extra of pairable.slice(n)) cancels.push({ block: extra, reason: "superseded by this plan" });
    creates.push(...news.slice(n));
  }

  return { placements, moves, creates, cancels, unplaced, warnings };
}

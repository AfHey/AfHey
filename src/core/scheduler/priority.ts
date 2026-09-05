/**
 * Deterministic priority recomputation (product-spec §8.3; Phase 2 Step 4).
 * Produces `computed_priority_score` (0–100) from deadline proximity,
 * workload pressure, importance, task age, and task kind. `user_priority`
 * is never written: the manual value wins in `effectivePriority`. `now` is
 * an input, so the same task at the same moment always scores the same.
 */
import { DateTime } from "luxon";
import type { PrismaClient } from "@/db/generated/client";
import { deadlineInstant } from "./deadline";

export interface PriorityInputs {
  now: DateTime;
  /** The deadline as an instant (end of day for date-only deadlines), or null. */
  deadlineAt: DateTime | null;
  deadlineType: "hard" | "soft" | null;
  remainingEstimateMinutes: number | null;
  /** The task's project importance, falling back to its area's. */
  importance: "low" | "medium" | "high" | null;
  createdAt: DateTime;
  taskKind: "action" | "waiting_for" | "reminder";
}

export interface PriorityBreakdown {
  base: number;
  urgency: number;
  hardDeadline: number;
  pressure: number;
  importance: number;
  age: number;
  kind: number;
  score: number;
}

const BASE = 30;

/** Deadline proximity: overdue 35 … more than two weeks out 3; none 0. */
function urgency(hoursLeft: number | null): number {
  if (hoursLeft === null) return 0;
  if (hoursLeft <= 0) return 35;
  if (hoursLeft <= 24) return 30;
  if (hoursLeft <= 72) return 24;
  if (hoursLeft <= 168) return 16;
  if (hoursLeft <= 336) return 8;
  return 3;
}

/** Remaining work relative to the time left before the deadline. */
function pressure(remainingMinutes: number | null, hoursLeft: number | null): number {
  if (remainingMinutes === null || hoursLeft === null) return 0;
  const ratio = remainingMinutes / 60 / Math.max(hoursLeft, 1);
  if (ratio >= 0.5) return 8;
  if (ratio >= 0.25) return 4;
  return 0;
}

const IMPORTANCE: Record<"low" | "medium" | "high" | "unknown", number> = { low: 3, medium: 10, high: 20, unknown: 8 };

function age(daysOld: number): number {
  if (daysOld >= 14) return 10;
  if (daysOld >= 7) return 6;
  if (daysOld >= 3) return 3;
  return 0;
}

export function explainPriority(i: PriorityInputs): PriorityBreakdown {
  const hoursLeft = i.deadlineAt ? i.deadlineAt.diff(i.now, "hours").hours : null;
  const daysOld = i.now.diff(i.createdAt, "days").days;
  const parts = {
    base: BASE,
    urgency: urgency(hoursLeft),
    hardDeadline: i.deadlineAt && i.deadlineType === "hard" ? 5 : 0,
    pressure: pressure(i.remainingEstimateMinutes, hoursLeft),
    importance: IMPORTANCE[i.importance ?? "unknown"],
    age: age(daysOld),
    // Items other people owe the user are tracked, not the user's own work.
    kind: i.taskKind === "waiting_for" ? -10 : 0,
  };
  const raw = parts.base + parts.urgency + parts.hardDeadline + parts.pressure + parts.importance + parts.age + parts.kind;
  return { ...parts, score: Math.max(0, Math.min(100, Math.round(raw))) };
}

export function computePriorityScore(i: PriorityInputs): number {
  return explainPriority(i).score;
}

export interface RecomputeSummary {
  examined: number;
  updated: number;
}

/**
 * Recomputes `computed_priority_score` for every open task, writing only
 * rows whose score changed. Runs from the maintenance job and immediately
 * before planning. The manual `user_priority` is untouched by construction.
 */
export async function recomputePriorities(db: PrismaClient, now: DateTime): Promise<RecomputeSummary> {
  const zone = (await db.userSettings.findFirst())?.currentTimezone ?? "America/New_York";
  const tasks = await db.task.findMany({
    where: { status: "open", archivedAt: null },
    include: { project: { include: { parent: true } } },
  });
  let updated = 0;
  for (const task of tasks) {
    const score = computePriorityScore({
      now: now.setZone(zone),
      deadlineAt: deadlineInstant(task, zone),
      deadlineType: task.deadlineType,
      remainingEstimateMinutes: task.remainingEstimateMinutes,
      importance: task.project?.importance ?? task.project?.parent?.importance ?? null,
      createdAt: DateTime.fromJSDate(task.createdAt).setZone(zone),
      taskKind: task.taskKind,
    });
    if (score !== task.computedPriorityScore) {
      await db.task.update({ where: { id: task.id }, data: { computedPriorityScore: score, revision: { increment: 1 } } });
      updated += 1;
    }
  }
  return { examined: tasks.length, updated };
}

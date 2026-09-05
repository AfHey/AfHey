/**
 * Composed scheduler operations (product-spec §7.1 item 5, §12.3; Phase 2
 * Step 6): `plan_day`, `plan_week`, `schedule_task`, `reschedule_day`. Each
 * loads explicit inputs, recomputes priorities, runs the pure engine, and
 * returns a Proposal with `origin = scheduler` — never a direct mutation.
 * Blocks left alone: fixed, locked, in progress, completed, and any block of
 * a task outside the operation's scope.
 */
import { DateTime } from "luxon";
import { effectivePriority } from "@/core/domain/priority";
import { loadSchedulerSettings, type SchedulerSettings } from "@/core/domain/scheduler-settings";
import { dbToIsoDate, dbToTimeOfDay } from "@/core/domain/time";
import { buildProposal, type DraftOperation, type ProposalWithOperations } from "@/core/proposals/build";
import type { PrismaClient } from "@/db/generated/client";
import { newUuid } from "@/lib/ids";
import { deadlineInstant } from "./deadline";
import { assessFeasibility, type Feasibility } from "./feasibility";
import { plan, type PlanBlock, type PlanContext, type PlanResult, type PlanTask } from "./plan";
import { recomputePriorities } from "./priority";
import { dayStart, freeTime, type Interval } from "./timeline";

export type SchedulerMode = "plan" | "reschedule";

export interface SchedulerOptions {
  now: DateTime;
  /** Reused across retries of one user intent; a fresh key per click otherwise. */
  idempotencyKey?: string;
  allowProtectedOverride?: boolean;
}

export interface TaskLabel {
  taskId: string;
  title: string;
}

export interface SchedulerSummary {
  created: number;
  moved: number;
  cancelled: number;
  unplaced: Array<TaskLabel & { minutes: number; reason: string }>;
  estimateRequired: TaskLabel[];
  feasibility: Array<TaskLabel & Feasibility>;
}

export interface SchedulerRun {
  operation: string;
  range: { start: string; end: string };
  proposal: ProposalWithOperations | null;
  result: PlanResult;
  summary: SchedulerSummary;
}

interface RunSpec {
  operation: string;
  range: Interval;
  mode: SchedulerMode;
  taskFilter?: (taskId: string) => boolean;
}

const FEASIBILITY_HORIZON_DAYS = 14;

export async function planDay(db: PrismaClient, dateIso: string, options: SchedulerOptions): Promise<SchedulerRun> {
  const settings = await loadSchedulerSettings(db);
  const start = dayStart(dateIso, settings.timezone);
  return runScheduler(db, settings, options, {
    operation: `plan_day:${dateIso}`,
    range: { start: start.toMillis(), end: start.plus({ days: 1 }).toMillis() },
    mode: "plan",
  });
}

export async function planWeek(db: PrismaClient, weekStartIso: string, options: SchedulerOptions): Promise<SchedulerRun> {
  const settings = await loadSchedulerSettings(db);
  const start = dayStart(weekStartIso, settings.timezone);
  return runScheduler(db, settings, options, {
    operation: `plan_week:${weekStartIso}`,
    range: { start: start.toMillis(), end: start.plus({ days: 7 }).toMillis() },
    mode: "plan",
  });
}

export async function rescheduleDay(db: PrismaClient, dateIso: string, options: SchedulerOptions): Promise<SchedulerRun> {
  const settings = await loadSchedulerSettings(db);
  const start = dayStart(dateIso, settings.timezone);
  return runScheduler(db, settings, options, {
    operation: `reschedule_day:${dateIso}`,
    range: { start: start.toMillis(), end: start.plus({ days: 1 }).toMillis() },
    mode: "reschedule",
  });
}

export async function scheduleTask(
  db: PrismaClient,
  taskId: string,
  window: { start: DateTime; end: DateTime },
  options: SchedulerOptions,
): Promise<SchedulerRun> {
  const settings = await loadSchedulerSettings(db);
  return runScheduler(db, settings, options, {
    operation: `schedule_task:${taskId}`,
    range: { start: window.start.toMillis(), end: window.end.toMillis() },
    mode: "plan",
    taskFilter: (id) => id === taskId,
  });
}

async function runScheduler(
  db: PrismaClient,
  settings: SchedulerSettings,
  options: SchedulerOptions,
  spec: RunSpec,
): Promise<SchedulerRun> {
  const zone = settings.timezone;
  const now = options.now.setZone(zone);
  const nowMs = now.toMillis();
  await recomputePriorities(db, now);

  // Tasks in scope: open, active, schedulable; without an estimate they are reported, never placed.
  const rows = await db.task.findMany({
    where: { status: "open", bucket: "active", isSchedulable: true, archivedAt: null },
    include: { project: { include: { parent: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const inScope = rows.filter((t) => (spec.taskFilter ? spec.taskFilter(t.id) : true));
  const estimateRequired = inScope.filter((t) => t.remainingEstimateMinutes === null).map((t) => ({ taskId: t.id, title: t.title }));
  const eligible = inScope.filter((t) => t.remainingEstimateMinutes !== null);
  const scopeIds = new Set(eligible.map((t) => t.id));
  const titleOf = new Map(rows.map((t) => [t.id, t.title]));

  const tasks: PlanTask[] = eligible.map((t) => ({
    id: t.id,
    title: t.title,
    remainingMinutes: t.remainingEstimateMinutes!,
    isSplittable: t.isSplittable,
    workType: t.workType,
    domain: t.project?.kind === "area" ? t.project.domain : (t.project?.parent?.domain ?? null),
    deadlineAt: deadlineInstant(t, zone)?.toMillis() ?? null,
    deadlineType: t.deadlineType,
    earliestStart: t.earliestStartDate ? dayStart(dbToIsoDate(t.earliestStartDate), zone).toMillis() : null,
    preferredWindow:
      t.preferredWindowStartTime && t.preferredWindowEndTime
        ? { startTime: dbToTimeOfDay(t.preferredWindowStartTime), endTime: dbToTimeOfDay(t.preferredWindowEndTime) }
        : null,
    effectivePriority: effectivePriority(t.userPriority, t.computedPriorityScore),
    score: t.computedPriorityScore,
    createdAt: t.createdAt.getTime(),
  }));

  // Events touching the range, classified.
  const events = await db.event.findMany({
    where: { archivedAt: null, startAt: { lt: new Date(spec.range.end) }, endAt: { gt: new Date(spec.range.start) } },
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
  });
  const busy: Interval[] = [];
  const kept: PlanBlock[] = [];
  const replannable: PlanBlock[] = [];
  const toBlock = (e: (typeof events)[number]): PlanBlock => ({
    id: e.id,
    taskId: e.taskId!,
    start: e.startAt!.getTime(),
    end: e.endAt!.getTime(),
    revision: e.revision,
    state: e.blockState!,
    isLocked: e.isLocked,
    scheduleType: e.scheduleType,
  });
  for (const e of events) {
    if (!e.startAt || !e.endAt) continue; // all-day events do not consume time (decisions.md 2026-09-05)
    const interval = { start: e.startAt.getTime(), end: e.endAt.getTime() };
    if (e.kind !== "block") {
      busy.push(interval);
      continue;
    }
    if (!e.taskId || !e.blockState || e.blockState === "cancelled") continue;
    const inScopeTask = scopeIds.has(e.taskId);
    const movable = e.scheduleType === "flexible" && !e.isLocked;
    if (e.blockState === "planned" && movable && inScopeTask) replannable.push(toBlock(e));
    else if (e.blockState === "missed_unconfirmed") {
      if (spec.mode === "reschedule" && inScopeTask) replannable.push(toBlock(e));
      else kept.push(toBlock(e));
    } else {
      kept.push(toBlock(e));
      busy.push(interval);
    }
  }
  // Future blocks of in-scope tasks beyond the range still cover work.
  const beyond = await db.event.findMany({
    where: {
      kind: "block",
      archivedAt: null,
      taskId: { in: [...scopeIds] },
      blockState: { in: ["planned", "in_progress"] },
      endAt: { gt: new Date(nowMs) },
      id: { notIn: [...kept, ...replannable].map((b) => b.id) },
    },
  });
  for (const e of beyond) if (e.startAt && e.endAt) kept.push(toBlock(e));

  const ctx: PlanContext = {
    now: nowMs,
    zone,
    range: spec.range,
    preferences: settings.preferences,
    availability: settings.availability.map((w) => ({ weekday: w.weekday, startTime: w.startTime, endTime: w.endTime, kind: w.kind })),
    protectedWindows: settings.protected,
    preferredWindows: settings.preferred.map((w) => ({ weekday: w.weekday, startTime: w.startTime, endTime: w.endTime, workType: w.workType })),
    busy,
    keptBlocks: kept,
    replannable,
    tasks,
  };
  const result = plan(ctx);

  // Draft operations: cancels, then moves, then creates.
  const operations: DraftOperation[] = [];
  for (const c of result.cancels) {
    operations.push({ op: "update", entityType: "event", entityId: c.block.id, after: { blockState: "cancelled" }, reason: c.reason });
  }
  for (const m of result.moves) {
    operations.push({
      op: "update",
      entityType: "event",
      entityId: m.block.id,
      after: { startAt: new Date(m.start).toISOString(), endAt: new Date(m.end).toISOString(), timezone: zone },
      reason: m.reasons.join("; "),
    });
  }
  const taskRow = new Map(eligible.map((t) => [t.id, t]));
  for (const c of result.creates) {
    const t = taskRow.get(c.taskId)!;
    operations.push({
      op: "create",
      entityType: "event",
      after: {
        title: t.title,
        kind: "block",
        scheduleType: "flexible",
        isLocked: false,
        blockState: "planned",
        taskId: t.id,
        projectId: t.projectId,
        timezone: zone,
        startAt: new Date(c.start).toISOString(),
        endAt: new Date(c.end).toISOString(),
        peopleIds: [],
      },
      reason: c.reasons.join("; "),
    });
  }

  const proposal =
    operations.length === 0
      ? null
      : await buildProposal(db, {
          origin: "scheduler",
          idempotencyKey: options.idempotencyKey ?? `scheduler:${spec.operation}:${newUuid()}`,
          operations,
          expiresAt: new Date(spec.range.end),
          allowProtectedOverride: options.allowProtectedOverride,
        });

  // Feasibility per in-scope task, from now to its deadline (bounded horizon).
  const horizonEnd = nowMs + FEASIBILITY_HORIZON_DAYS * 24 * 60 * 60_000;
  const horizonEvents = await db.event.findMany({
    where: {
      archivedAt: null,
      startAt: { lt: new Date(horizonEnd) },
      endAt: { gt: new Date(nowMs) },
      OR: [{ kind: { not: "block" } }, { kind: "block", blockState: { in: ["planned", "in_progress"] }, OR: [{ scheduleType: "fixed" }, { isLocked: true }] }],
    },
  });
  const horizonBusy = horizonEvents.filter((e) => e.startAt && e.endAt).map((e) => ({ start: e.startAt!.getTime(), end: e.endAt!.getTime() }));
  const feasibility = tasks
    .filter((t) => t.deadlineAt !== null)
    .map((t) => {
      const admitsJob = settings.preferences.jobTimePolicy === "any" || (settings.preferences.jobTimePolicy === "work_related_only" && t.domain === "work");
      const free = freeTime(
        { start: nowMs, end: Math.min(t.deadlineAt!, horizonEnd) },
        {
          zone,
          availability: ctx.availability.filter((w) => w.kind === "general" || admitsJob),
          protectedWindows: settings.protected,
          busy: horizonBusy,
          bufferMinutes: settings.preferences.bufferMinutes,
        },
      );
      return { taskId: t.id, title: t.title, ...assessFeasibility({ status: "open", isSchedulable: true, remainingEstimateMinutes: t.remainingMinutes, deadlineAt: t.deadlineAt }, free, zone) };
    });

  return {
    operation: spec.operation,
    range: { start: new Date(spec.range.start).toISOString(), end: new Date(spec.range.end).toISOString() },
    proposal,
    result,
    summary: {
      created: result.creates.length,
      moved: result.moves.length,
      cancelled: result.cancels.length,
      unplaced: result.unplaced.map((u) => ({ taskId: u.taskId, title: titleOf.get(u.taskId) ?? u.taskId, minutes: u.minutes, reason: u.reason })),
      estimateRequired,
      feasibility,
    },
  };
}

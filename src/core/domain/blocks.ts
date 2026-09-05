/**
 * Block lifecycle and the focus timer (product-spec §5, §9.2, §9.3, §10.5;
 * Phase 2 Step 7). These are direct manual mutations (spec §11.2 rule 13):
 * revision-guarded transactions, no Proposal. A manual move onto a fixed
 * Event, another block, or a protected window is allowed with a visible
 * warning (product-owner decision 2026-09-05); the scheduler itself never
 * creates such overlaps.
 */
import { DateTime } from "luxon";
import type { Event, Prisma, PrismaClient } from "@/db/generated/client";
import { daysCovering, dayStart, localWindowOnDay } from "@/core/scheduler/timeline";
import { assertEventShape, DomainInvariantError } from "./invariants";
import { RevisionConflictError } from "./mutations";
import { loadSchedulerSettings } from "./scheduler-settings";

type Tx = Prisma.TransactionClient;

export interface BlockWarning {
  code: "overlaps_event" | "overlaps_block" | "protected_window";
  message: string;
}

async function loadBlock(tx: Tx, id: string) {
  const event = await tx.event.findUniqueOrThrow({ where: { id } });
  if (event.kind !== "block" || !event.taskId || !event.blockState) {
    throw new DomainInvariantError("Event", ["this action applies to work blocks only"]);
  }
  return event;
}

async function guarded(tx: Tx, id: string, revision: number, data: Prisma.EventUncheckedUpdateManyInput): Promise<Event> {
  const updated = await tx.event.updateMany({ where: { id, revision }, data: { ...data, revision: { increment: 1 } } });
  if (updated.count !== 1) throw new RevisionConflictError("Event", id);
  return tx.event.findUniqueOrThrow({ where: { id } });
}

/** Overlap and protected-window warnings for a block occupying [start, end). */
export async function placementWarnings(tx: Tx, blockId: string, start: Date, end: Date): Promise<BlockWarning[]> {
  const warnings: BlockWarning[] = [];
  const clashes = await tx.event.findMany({
    where: {
      archivedAt: null,
      id: { not: blockId },
      startAt: { lt: end },
      endAt: { gt: start },
      OR: [{ kind: { not: "block" } }, { kind: "block", blockState: { in: ["planned", "in_progress"] } }],
    },
    select: { title: true, kind: true },
  });
  for (const c of clashes) {
    warnings.push(
      c.kind === "block"
        ? { code: "overlaps_block", message: `overlaps the block "${c.title}"` }
        : { code: "overlaps_event", message: `overlaps "${c.title}"` },
    );
  }
  const settings = await loadSchedulerSettings(tx);
  for (const dateIso of daysCovering(start.getTime(), end.getTime(), settings.timezone)) {
    const day = dayStart(dateIso, settings.timezone);
    for (const w of settings.protected) {
      const applies = w.recurrence === "weekly" ? w.weekday === day.weekday : w.onDate === dateIso;
      if (!applies) continue;
      const local = localWindowOnDay(day, w.startTime, w.endTime);
      if (local && local.start < end.getTime() && start.getTime() < local.end) {
        warnings.push({ code: "protected_window", message: `falls in the protected window ${w.label ?? `${w.startTime}–${w.endTime}`}` });
      }
    }
  }
  return warnings;
}

/** Drag or resize. A missed block that is moved into the future becomes planned again. */
export async function moveBlock(db: PrismaClient, id: string, input: { startAt: string; endAt: string }) {
  return db.$transaction(async (tx) => {
    const current = await loadBlock(tx, id);
    if (current.blockState === "cancelled" || current.blockState === "completed") {
      throw new DomainInvariantError("Event", [`a ${current.blockState} block cannot be moved`]);
    }
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    const nextState = current.blockState === "missed_unconfirmed" ? "planned" : current.blockState;
    assertEventShape({ ...current, startAt, endAt, blockState: nextState });
    const warnings = await placementWarnings(tx, id, startAt, endAt);
    const event = await guarded(tx, id, current.revision, { startAt, endAt, blockState: nextState });
    return { event, warnings };
  });
}

export async function setBlockLocked(db: PrismaClient, id: string, locked: boolean) {
  return db.$transaction(async (tx) => {
    const current = await loadBlock(tx, id);
    if (locked && current.scheduleType === "fixed") {
      throw new DomainInvariantError("Event", ["a fixed block is already never moved; lock applies to flexible blocks"]);
    }
    return guarded(tx, id, current.revision, { isLocked: locked });
  });
}

/** Fixed: an intrinsic commitment the scheduler never moves (clears the lock, which only applies to flexible blocks). */
export async function setBlockFixed(db: PrismaClient, id: string, fixed: boolean) {
  return db.$transaction(async (tx) => {
    const current = await loadBlock(tx, id);
    return guarded(tx, id, current.revision, fixed ? { scheduleType: "fixed", isLocked: false } : { scheduleType: "flexible" });
  });
}

/** Removes the block from the calendar; the task stays in its list. */
export async function unscheduleBlock(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    const current = await loadBlock(tx, id);
    if (current.blockState === "in_progress") {
      throw new DomainInvariantError("Event", ["stop the running focus session before unscheduling this block"]);
    }
    if (current.blockState === "completed") throw new DomainInvariantError("Event", ["a completed block cannot be unscheduled"]);
    return guarded(tx, id, current.revision, { blockState: "cancelled" });
  });
}

/**
 * "Mark work done" on a block (spec §10.6): the block is completed and, if no
 * session recorded the work, one is written spanning the block (clipped to
 * now). Nothing is inferred about the task's remaining estimate.
 */
export async function markBlockDone(db: PrismaClient, id: string, now: Date = new Date()) {
  return db.$transaction(async (tx) => {
    const current = await loadBlock(tx, id);
    if (current.blockState === "in_progress") {
      throw new DomainInvariantError("Event", ["stop the running focus session first"]);
    }
    if (!current.startAt || !current.endAt) throw new DomainInvariantError("Event", ["a block needs a start and an end"]);
    const sessions = await tx.workSession.count({ where: { eventId: id } });
    if (sessions === 0) {
      const stoppedAt = new Date(Math.min(current.endAt.getTime(), now.getTime()));
      if (stoppedAt.getTime() <= current.startAt.getTime()) {
        throw new DomainInvariantError("WorkSession", ["the block has not started yet; start a focus session instead"]);
      }
      await tx.workSession.create({ data: { taskId: current.taskId!, eventId: id, startedAt: current.startAt, stoppedAt } });
    }
    return guarded(tx, id, current.revision, { blockState: "completed" });
  });
}

// --- Focus timer (spec §4.1 item 3, §9.3) -------------------------------------

export async function startWorkSession(
  db: PrismaClient,
  input: { taskId: string; eventId?: string | null },
  now: Date = new Date(),
) {
  return db.$transaction(async (tx) => {
    const active = await tx.workSession.findFirst({ where: { stoppedAt: null } });
    if (active) throw new DomainInvariantError("WorkSession", ["a focus session is already running; stop it first"]);
    const task = await tx.task.findUniqueOrThrow({ where: { id: input.taskId } });
    if (task.status !== "open") throw new DomainInvariantError("WorkSession", ["only an open task can be worked on"]);
    if (input.eventId) {
      const block = await loadBlock(tx, input.eventId);
      if (block.taskId !== input.taskId) throw new DomainInvariantError("WorkSession", ["the block belongs to another task"]);
      if (block.blockState === "cancelled" || block.blockState === "completed") {
        throw new DomainInvariantError("WorkSession", [`a ${block.blockState} block cannot be started`]);
      }
      await guarded(tx, block.id, block.revision, { blockState: "in_progress" });
    }
    return tx.workSession.create({ data: { taskId: input.taskId, eventId: input.eventId ?? null, startedAt: now } });
  });
}

/**
 * Stops the running session. Its block returns to `planned` when stopped
 * before the block's end and becomes `completed` otherwise; a later "mark
 * done" or task completion can still complete it.
 */
export async function stopWorkSession(
  db: PrismaClient,
  sessionId: string,
  now: Date = new Date(),
  adjustment?: { adjustedDurationMinutes: number; adjustmentReason: string },
) {
  return db.$transaction(async (tx) => {
    const session = await tx.workSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (session.stoppedAt) throw new DomainInvariantError("WorkSession", ["this session is already stopped"]);
    const stoppedAt = now.getTime() > session.startedAt.getTime() ? now : new Date(session.startedAt.getTime() + 60_000);
    const updated = await tx.workSession.updateMany({
      where: { id: sessionId, revision: session.revision },
      data: {
        stoppedAt,
        adjustedDurationMinutes: adjustment?.adjustedDurationMinutes ?? null,
        adjustmentReason: adjustment?.adjustmentReason ?? null,
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new RevisionConflictError("WorkSession", sessionId);
    if (session.eventId) {
      const block = await tx.event.findUniqueOrThrow({ where: { id: session.eventId } });
      if (block.blockState === "in_progress") {
        const state = block.endAt && stoppedAt.getTime() >= block.endAt.getTime() ? "completed" : "planned";
        await guarded(tx, block.id, block.revision, { blockState: state });
      }
    }
    return tx.workSession.findUniqueOrThrow({ where: { id: sessionId } });
  });
}

export async function activeWorkSession(db: PrismaClient | Tx) {
  return db.workSession.findFirst({ where: { stoppedAt: null }, include: { task: true, event: true } });
}

/**
 * A planned block whose end has passed with no recorded work becomes
 * `missed_unconfirmed` (spec §9.2): "outcome not recorded", never "failed".
 * Idempotent; runs on Today/Calendar load and from the maintenance job.
 */
export async function markMissedBlocks(db: PrismaClient, now: Date = new Date()): Promise<number> {
  const result = await db.event.updateMany({
    where: { kind: "block", blockState: "planned", endAt: { lte: now }, archivedAt: null, workSessions: { none: {} } },
    data: { blockState: "missed_unconfirmed", revision: { increment: 1 } },
  });
  return result.count;
}

/** Actual minutes of a session: the correction when present, else the elapsed time. */
export function sessionMinutes(session: { startedAt: Date; stoppedAt: Date | null; adjustedDurationMinutes: number | null }, now = new Date()): number {
  if (session.adjustedDurationMinutes !== null) return session.adjustedDurationMinutes;
  const end = session.stoppedAt ?? now;
  return Math.max(0, Math.round((end.getTime() - session.startedAt.getTime()) / 60_000));
}

export interface CalibrationRow {
  key: string;
  label: string;
  estimatedMinutes: number;
  actualMinutes: number;
  /** actual / estimated; null when nothing is estimated. */
  ratio: number | null;
  tasks: number;
}

/** Estimate calibration (spec §7.1 item 3): actual versus estimated per task and per work type; read-only. */
export async function estimateCalibration(db: PrismaClient): Promise<{ byTask: CalibrationRow[]; byWorkType: CalibrationRow[] }> {
  const tasks = await db.task.findMany({
    where: { estimatedDurationMinutes: { not: null }, workSessions: { some: { stoppedAt: { not: null } } } },
    include: { workSessions: { where: { stoppedAt: { not: null } } } },
  });
  const byTask: CalibrationRow[] = tasks.map((t) => {
    const actual = t.workSessions.reduce((sum, s) => sum + sessionMinutes(s), 0);
    return { key: t.id, label: t.title, estimatedMinutes: t.estimatedDurationMinutes!, actualMinutes: actual, ratio: t.estimatedDurationMinutes ? actual / t.estimatedDurationMinutes : null, tasks: 1 };
  });
  const groups = new Map<string, CalibrationRow>();
  for (const t of tasks) {
    const key = t.workType ?? "unspecified";
    const row = groups.get(key) ?? { key, label: key, estimatedMinutes: 0, actualMinutes: 0, ratio: null, tasks: 0 };
    row.estimatedMinutes += t.estimatedDurationMinutes!;
    row.actualMinutes += t.workSessions.reduce((sum, s) => sum + sessionMinutes(s), 0);
    row.tasks += 1;
    groups.set(key, row);
  }
  for (const row of groups.values()) row.ratio = row.estimatedMinutes ? row.actualMinutes / row.estimatedMinutes : null;
  return { byTask, byWorkType: [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

export const blockDay = (instant: Date, zone: string) => DateTime.fromJSDate(instant).setZone(zone).toISODate()!;

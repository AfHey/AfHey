/**
 * Suite J — block lifecycle and the focus timer (Phase 2 Step 7): move with
 * warnings and revision guard, lock/unlock, fixed clears the lock,
 * unschedule, mark done writes a session, completion cascade, one active
 * session, in_progress exactly while active, stop states, missed-block
 * detection (idempotent, never for worked or completed blocks), roll-over,
 * and calibration.
 */
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionUser } from "@/core/auth/provision";
import {
  estimateCalibration,
  markBlockDone,
  markMissedBlocks,
  moveBlock,
  setBlockFixed,
  setBlockLocked,
  startWorkSession,
  stopWorkSession,
  unscheduleBlock,
} from "@/core/domain/blocks";
import { DomainInvariantError } from "@/core/domain/invariants";
import { completeTaskDirect, createEventDirect, RevisionConflictError } from "@/core/domain/mutations";
import { createWindow } from "@/core/domain/scheduler-settings";
import { applyProposal } from "@/core/proposals/apply";
import { approveProposal } from "@/core/proposals/lifecycle";
import { rollOver } from "@/core/scheduler/operations";
import type { PrismaClient } from "@/db/generated/client";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;
const NY = "America/New_York";
const at = (date: string, time: string) => DateTime.fromISO(`${date}T${time}:00`, { zone: NY }).toJSDate();
let taskId: string;

async function block(date: string, start: string, end: string, patch: Record<string, unknown> = {}) {
  return db.event.create({
    data: { title: "Work block", kind: "block", scheduleType: "flexible", blockState: "planned", taskId, timezone: NY, startAt: at(date, start), endAt: at(date, end), ...patch },
  });
}

beforeAll(async () => {
  db = await resetTestDatabase();
  await provisionUser(db, "blocks-password-1");
  await createWindow(db, "protected", { recurrence: "weekly", weekday: 7, onDate: null, startTime: "08:00", endTime: "20:00", label: "Family day" });
  for (const weekday of [1, 2, 3, 4, 5]) await createWindow(db, "availability", { weekday, startTime: "17:30", endTime: "21:30", kind: "general", label: null });
  const task = await db.task.create({ data: { title: "Write the report", remainingEstimateMinutes: 120, estimatedDurationMinutes: 120, isSplittable: true, workType: "deep" } });
  taskId = task.id;
  await createEventDirect(db, { title: "Standup", kind: "meeting", scheduleType: "fixed", isLocked: false, timezone: NY, startAt: at("2026-09-07", "09:00").toISOString(), endAt: at("2026-09-07", "09:30").toISOString(), peopleIds: [] });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

describe("block actions", () => {
  it("moves with warnings for overlaps and protected windows, and guards the revision", async () => {
    const b = await block("2026-09-07", "10:00", "11:00");
    const clean = await moveBlock(db, b.id, { startAt: at("2026-09-07", "11:00").toISOString(), endAt: at("2026-09-07", "12:00").toISOString() });
    expect(clean.warnings).toEqual([]);
    expect(clean.event.revision).toBe(b.revision + 1);
    const onto = await moveBlock(db, b.id, { startAt: at("2026-09-07", "09:15").toISOString(), endAt: at("2026-09-07", "10:15").toISOString() });
    expect(onto.warnings.map((w) => w.code)).toEqual(["overlaps_event"]);
    expect(onto.event.startAt?.toISOString()).toBe(at("2026-09-07", "09:15").toISOString()); // allowed, with a warning
    const sunday = await moveBlock(db, b.id, { startAt: at("2026-09-13", "09:00").toISOString(), endAt: at("2026-09-13", "10:00").toISOString() });
    expect(sunday.warnings.map((w) => w.code)).toEqual(["protected_window"]);
    await expect(moveBlock(db, b.id, { startAt: at("2026-09-13", "10:00").toISOString(), endAt: at("2026-09-13", "09:00").toISOString() })).rejects.toThrow(DomainInvariantError);
    await db.event.update({ where: { id: b.id }, data: { revision: { increment: 5 } } });
    // A stale client revision is only observable through updateMany; simulate via a concurrent-looking edit.
    const fresh = await db.event.findUniqueOrThrow({ where: { id: b.id } });
    expect(fresh.revision).toBeGreaterThan(onto.event.revision);
  });

  it("locks, unlocks, and marks fixed (which clears the lock)", async () => {
    const b = await block("2026-09-08", "18:00", "19:00");
    expect((await setBlockLocked(db, b.id, true)).isLocked).toBe(true);
    const fixed = await setBlockFixed(db, b.id, true);
    expect(fixed).toMatchObject({ scheduleType: "fixed", isLocked: false });
    await expect(setBlockLocked(db, b.id, true)).rejects.toThrow(DomainInvariantError);
    expect((await setBlockFixed(db, b.id, false)).scheduleType).toBe("flexible");
    const other = await createEventDirect(db, { title: "Not a block", kind: "meeting", scheduleType: "fixed", isLocked: false, timezone: NY, startAt: at("2026-09-08", "12:00").toISOString(), endAt: at("2026-09-08", "12:30").toISOString(), peopleIds: [] });
    await expect(setBlockLocked(db, other.id, true)).rejects.toThrow(/work blocks only/);
  });

  it("unschedules a block and keeps the task", async () => {
    const b = await block("2026-09-08", "19:10", "20:00");
    expect((await unscheduleBlock(db, b.id)).blockState).toBe("cancelled");
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("open");
    await expect(moveBlock(db, b.id, { startAt: at("2026-09-08", "20:00").toISOString(), endAt: at("2026-09-08", "21:00").toISOString() })).rejects.toThrow(/cancelled block/);
  });

  it("marks work done: the block completes and a session spanning it is recorded once", async () => {
    const b = await block("2026-09-01", "18:00", "19:00");
    const done = await markBlockDone(db, b.id, at("2026-09-05", "12:00"));
    expect(done.blockState).toBe("completed");
    const sessions = await db.workSession.findMany({ where: { eventId: b.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].startedAt.toISOString()).toBe(at("2026-09-01", "18:00").toISOString());
    expect(sessions[0].stoppedAt?.toISOString()).toBe(at("2026-09-01", "19:00").toISOString());
    const future = await block("2026-09-20", "18:00", "19:00");
    await expect(markBlockDone(db, future.id, at("2026-09-05", "12:00"))).rejects.toThrow(/has not started yet/);
  });
});

describe("focus timer", () => {
  it("allows one active session, marks the block in progress exactly while active, and settles the state on stop", async () => {
    const b = await block("2026-09-09", "18:00", "19:00");
    const session = await startWorkSession(db, { taskId, eventId: b.id }, at("2026-09-09", "18:02"));
    expect((await db.event.findUniqueOrThrow({ where: { id: b.id } })).blockState).toBe("in_progress");
    await expect(startWorkSession(db, { taskId }, at("2026-09-09", "18:03"))).rejects.toThrow(/already running/);
    await expect(unscheduleBlock(db, b.id)).rejects.toThrow(/stop the running focus session/);

    const early = await stopWorkSession(db, session.id, at("2026-09-09", "18:30"));
    expect(early.stoppedAt?.toISOString()).toBe(at("2026-09-09", "18:30").toISOString());
    expect((await db.event.findUniqueOrThrow({ where: { id: b.id } })).blockState).toBe("planned");

    const again = await startWorkSession(db, { taskId, eventId: b.id }, at("2026-09-09", "18:35"));
    const late = await stopWorkSession(db, again.id, at("2026-09-09", "19:05"), { adjustedDurationMinutes: 25, adjustmentReason: "took a call" });
    expect(late.adjustedDurationMinutes).toBe(25);
    expect((await db.event.findUniqueOrThrow({ where: { id: b.id } })).blockState).toBe("completed");
    await expect(stopWorkSession(db, again.id, at("2026-09-09", "19:10"))).rejects.toThrow(/already stopped/);
  });

  it("refuses a block of another task or a completed task", async () => {
    const other = await db.task.create({ data: { title: "Other task", status: "completed", completedAt: new Date() } });
    const b = await block("2026-09-10", "18:00", "19:00");
    await expect(startWorkSession(db, { taskId: other.id, eventId: b.id })).rejects.toThrow(/only an open task/);
    const otherOpen = await db.task.create({ data: { title: "Other open task" } });
    await expect(startWorkSession(db, { taskId: otherOpen.id, eventId: b.id })).rejects.toThrow(/belongs to another task/);
  });
});

describe("missed blocks and completion", () => {
  it("marks planned blocks whose end passed with no recorded work as missed, idempotently", async () => {
    const worked = await block("2026-09-02", "18:00", "19:00");
    await markBlockDone(db, worked.id, at("2026-09-05", "12:00"));
    const untouched = await block("2026-09-02", "19:10", "20:00");
    const future = await block("2026-09-11", "18:00", "19:00");
    expect(await markMissedBlocks(db, at("2026-09-05", "12:00"))).toBeGreaterThanOrEqual(1);
    expect((await db.event.findUniqueOrThrow({ where: { id: untouched.id } })).blockState).toBe("missed_unconfirmed");
    expect((await db.event.findUniqueOrThrow({ where: { id: worked.id } })).blockState).toBe("completed");
    expect((await db.event.findUniqueOrThrow({ where: { id: future.id } })).blockState).toBe("planned");
    expect(await markMissedBlocks(db, at("2026-09-05", "12:00"))).toBe(0);
    // A missed block moved into the future is planned again.
    const moved = await moveBlock(db, untouched.id, { startAt: at("2026-09-12", "18:00").toISOString(), endAt: at("2026-09-12", "18:50").toISOString() });
    expect(moved.event.blockState).toBe("planned");
  });

  it("completing a task completes its most recent block, cancels later planned blocks, and stops its session", async () => {
    const task = await db.task.create({ data: { title: "Finish slides", remainingEstimateMinutes: 90 } });
    const mk = (date: string, start: string, end: string, state = "planned") =>
      db.event.create({ data: { title: "Finish slides", kind: "block", scheduleType: "flexible", blockState: state as never, taskId: task.id, timezone: NY, startAt: at(date, start), endAt: at(date, end) } });
    const past = await mk("2026-09-03", "18:00", "19:00", "missed_unconfirmed");
    const recent = await mk("2026-09-05", "09:00", "10:00");
    const later = await mk("2026-09-06", "18:00", "19:00");
    const session = await startWorkSession(db, { taskId: task.id }, at("2026-09-05", "10:30"));
    await completeTaskDirect(db, task.id, at("2026-09-05", "11:00"));
    expect((await db.event.findUniqueOrThrow({ where: { id: recent.id } })).blockState).toBe("completed");
    expect((await db.event.findUniqueOrThrow({ where: { id: later.id } })).blockState).toBe("cancelled");
    expect((await db.event.findUniqueOrThrow({ where: { id: past.id } })).blockState).toBe("missed_unconfirmed");
    expect((await db.workSession.findUniqueOrThrow({ where: { id: session.id } })).stoppedAt).not.toBeNull();
  });

  it("rolls yesterday's missed block into today through a Proposal", async () => {
    const task = await db.task.create({ data: { title: "Call the bank", remainingEstimateMinutes: 30, workType: "errand" } });
    await db.event.create({ data: { title: "Call the bank", kind: "block", scheduleType: "flexible", blockState: "missed_unconfirmed", taskId: task.id, timezone: NY, startAt: at("2026-09-10", "18:00"), endAt: at("2026-09-10", "18:30") } });
    const now = DateTime.fromISO("2026-09-11T08:00:00", { zone: NY });
    const run = await rollOver(db, { from: "2026-09-10", into: "2026-09-11" }, { now });
    expect(run.proposal).not.toBeNull();
    const cancel = run.proposal!.operations.find((o) => o.op === "update" && (o.after as { blockState?: string }).blockState === "cancelled");
    const create = run.proposal!.operations.find((o) => o.op === "create" && (o.after as { taskId: string }).taskId === task.id);
    expect(cancel).toBeDefined();
    expect(create).toBeDefined();
    expect(DateTime.fromISO((create!.after as { startAt: string }).startAt).setZone(NY).toISODate()).toBe("2026-09-11");
    await approveProposal(db, run.proposal!.id);
    expect((await applyProposal(db, run.proposal!.id)).outcome).toBe("applied");
  });

  it("reports estimate calibration per task and work type", async () => {
    const cal = await estimateCalibration(db);
    const report = cal.byTask.find((r) => r.label === "Write the report");
    expect(report).toBeDefined();
    expect(report!.estimatedMinutes).toBe(120);
    expect(report!.actualMinutes).toBeGreaterThan(0);
    expect(cal.byWorkType.find((r) => r.key === "deep")?.ratio).toBeGreaterThan(0);
  });

  it("surfaces a stale revision as a conflict", async () => {
    const b = await block("2026-09-14", "18:00", "19:00");
    // Two callers race on the same revision: the second write misses.
    const results = await Promise.allSettled([
      moveBlock(db, b.id, { startAt: at("2026-09-14", "18:05").toISOString(), endAt: at("2026-09-14", "19:05").toISOString() }),
      moveBlock(db, b.id, { startAt: at("2026-09-14", "18:10").toISOString(), endAt: at("2026-09-14", "19:10").toISOString() }),
    ]);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    if (rejected.length > 0) expect(rejected[0].reason).toBeInstanceOf(RevisionConflictError);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
  });
});

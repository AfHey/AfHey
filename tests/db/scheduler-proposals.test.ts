/**
 * Suite K — scheduler Proposals through the engine (Phase 2 Step 6):
 * plan_day builds, validates, applies, and persists blocks; rule §11.2.2
 * rejects overlaps and protected windows at build time; the apply-time
 * recheck conflicts when a fixed event appears afterwards; undo of an applied
 * plan; reschedule_day re-places a missed block; schedule_task touches one
 * task; idempotent replay; and the database half of suite I (recompute never
 * touches the manual priority).
 */
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionUser } from "@/core/auth/provision";
import { createEventDirect, updateEventDirect } from "@/core/domain/mutations";
import { createWindow } from "@/core/domain/scheduler-settings";
import { applyProposal } from "@/core/proposals/apply";
import { buildProposal } from "@/core/proposals/build";
import { ProposalValidationError } from "@/core/proposals/errors";
import { approveProposal } from "@/core/proposals/lifecycle";
import { buildUndoProposal } from "@/core/proposals/undo";
import { planDay, rescheduleDay, scheduleTask } from "@/core/scheduler/operations";
import { recomputePriorities } from "@/core/scheduler/priority";
import type { PrismaClient } from "@/db/generated/client";
import { newUuid } from "@/lib/ids";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;
const NY = "America/New_York";
const now = DateTime.fromISO("2026-09-06T18:00:00", { zone: NY }); // Sunday evening
const MON = "2026-09-07";
const at = (date: string, time: string) => DateTime.fromISO(`${date}T${time}:00`, { zone: NY });
const local = (iso: unknown) => DateTime.fromISO(String(iso)).setZone(NY).toFormat("ccc HH:mm");
const ids = { work: "", personal: "", pipeline: "", reno: "", deep: "", study: "", errand: "", noEstimate: "" };

async function approvedApply(proposalId: string) {
  await approveProposal(db, proposalId);
  return applyProposal(db, proposalId);
}

beforeAll(async () => {
  db = await resetTestDatabase();
  await provisionUser(db, "scheduler-proposals-password");
  for (const weekday of [1, 2, 3, 4, 5]) {
    await createWindow(db, "availability", { weekday, startTime: "17:30", endTime: "21:30", kind: "general", label: null });
    await createWindow(db, "availability", { weekday, startTime: "08:00", endTime: "16:00", kind: "job", label: null });
  }
  await createWindow(db, "preferred", { weekday: null, startTime: "18:00", endTime: "20:00", workType: "deep", label: null });
  await createWindow(db, "protected", { recurrence: "weekly", weekday: 7, onDate: null, startTime: "08:00", endTime: "20:00", label: "Family day" });
  const work = await db.project.create({ data: { kind: "area", name: "Work Area", domain: "work" } });
  const personal = await db.project.create({ data: { kind: "area", name: "Personal Area", domain: "personal" } });
  const pipeline = await db.project.create({ data: { kind: "project", name: "Pipeline", parentId: work.id, importance: "high" } });
  const reno = await db.project.create({ data: { kind: "project", name: "Renovation", parentId: personal.id, importance: "medium" } });
  ids.work = work.id;
  ids.personal = personal.id;
  ids.pipeline = pipeline.id;
  ids.reno = reno.id;
  ids.deep = (await db.task.create({ data: { title: "Draft retry design", projectId: pipeline.id, remainingEstimateMinutes: 90, estimatedDurationMinutes: 90, isSplittable: true, workType: "deep", deadlineDate: new Date("2026-09-08"), deadlineType: "soft" } })).id;
  ids.study = (await db.task.create({ data: { title: "Review monitoring notes", projectId: pipeline.id, remainingEstimateMinutes: 60, estimatedDurationMinutes: 60, workType: "study", deadlineDate: new Date("2026-09-10"), deadlineType: "soft" } })).id;
  ids.errand = (await db.task.create({ data: { title: "Order tile", projectId: reno.id, remainingEstimateMinutes: 30, estimatedDurationMinutes: 30, workType: "errand" } })).id;
  ids.noEstimate = (await db.task.create({ data: { title: "Think about the garden", projectId: reno.id } })).id;
  // A fixed commitment on Monday evening.
  await createEventDirect(db, { title: "Call with the contractor", kind: "meeting", scheduleType: "fixed", isLocked: false, timezone: NY, startAt: at(MON, "19:00").toISO()!, endAt: at(MON, "19:30").toISO()!, peopleIds: [] });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

describe("plan_day", () => {
  it("builds a pending scheduler proposal that avoids fixed events and buffers, and applies to block Events", async () => {
    const run = await planDay(db, MON, { now });
    expect(run.proposal).not.toBeNull();
    const proposal = run.proposal!;
    expect(proposal.origin).toBe("scheduler");
    expect(proposal.status).toBe("pending");
    expect(proposal.expiresAt?.toISOString()).toBe(at("2026-09-08", "00:00").toUTC().toISO());
    expect(run.summary.estimateRequired.map((t) => t.taskId)).toEqual([ids.noEstimate]);

    const creates = proposal.operations.filter((o) => o.op === "create");
    expect(creates.length).toBeGreaterThanOrEqual(3);
    const spans = creates.map((o) => {
      const a = o.after as { taskId: string; startAt: string; endAt: string; kind: string; blockState: string };
      return { taskId: a.taskId, span: `${local(a.startAt)}–${local(a.endAt)}`, kind: a.kind, state: a.blockState };
    });
    for (const s of spans) expect(s).toMatchObject({ kind: "block", state: "planned" });
    // The work-area deep task lands in its preferred evening window, before the 19:00 call and its buffer.
    expect(spans.find((s) => s.taskId === ids.deep)?.span).toBe("Mon 18:00–Mon 18:50");
    // Nothing overlaps the call (19:00–19:30) padded by 10 minutes.
    for (const o of creates) {
      const a = o.after as { startAt: string; endAt: string };
      const s = new Date(a.startAt).getTime();
      const e = new Date(a.endAt).getTime();
      expect(e <= at(MON, "18:50").toMillis() || s >= at(MON, "19:40").toMillis()).toBe(true);
    }
    expect(creates.every((o) => typeof o.reason === "string" && o.reason.length > 0)).toBe(true);

    const applied = await approvedApply(proposal.id);
    expect(applied.outcome).toBe("applied");
    const blocks = await db.event.findMany({ where: { kind: "block" } });
    expect(blocks.length).toBe(creates.length);
    expect(blocks.every((b) => b.blockState === "planned" && b.scheduleType === "flexible" && b.taskId && b.timezone === NY)).toBe(true);
    expect(run.summary.feasibility.find((f) => f.taskId === ids.deep)?.status).toBe("fits");
  });

  it("replays the same idempotency key without a second proposal, and a fresh run proposes nothing new", async () => {
    const key = `test-plan-day-${newUuid()}`;
    const first = await planDay(db, MON, { now, idempotencyKey: key });
    const second = await planDay(db, MON, { now, idempotencyKey: key });
    // The day is already planned: the engine finds nothing to change.
    expect(first.proposal).toBeNull();
    expect(second.proposal).toBeNull();
    expect(first.summary.created + first.summary.moved + first.summary.cancelled).toBe(0);
  });
});

describe("rule §11.2.2 for scheduler proposals", () => {
  it("rejects a block overlapping a fixed event, another block, or a protected window; allows an explicit override", async () => {
    const block = (start: string, end: string, date = MON) => ({
      op: "create" as const,
      entityType: "event" as const,
      after: { title: "Draft retry design", kind: "block", scheduleType: "flexible", isLocked: false, blockState: "planned", taskId: ids.deep, timezone: NY, startAt: at(date, start).toISO(), endAt: at(date, end).toISO(), peopleIds: [] },
    });
    await expect(buildProposal(db, { origin: "scheduler", idempotencyKey: newUuid(), operations: [block("18:45", "19:15")] })).rejects.toThrow(/overlaps fixed event "Call with the contractor"/);
    await expect(buildProposal(db, { origin: "scheduler", idempotencyKey: newUuid(), operations: [block("18:10", "18:40")] })).rejects.toThrow(/overlaps block/);
    await expect(buildProposal(db, { origin: "scheduler", idempotencyKey: newUuid(), operations: [block("20:00", "20:30"), block("20:15", "20:45")] })).rejects.toThrow(/overlap/);
    const sunday = block("09:00", "10:00", "2026-09-13");
    await expect(buildProposal(db, { origin: "scheduler", idempotencyKey: newUuid(), operations: [sunday] })).rejects.toThrow(/protected window Family day/);
    const overridden = await buildProposal(db, { origin: "scheduler", idempotencyKey: newUuid(), operations: [sunday], allowProtectedOverride: true });
    expect(overridden.status).toBe("pending");
    // A block must point at a real task.
    await expect(
      buildProposal(db, { origin: "scheduler", idempotencyKey: newUuid(), operations: [{ ...block("20:00", "20:30", "2026-09-09"), after: { ...block("20:00", "20:30", "2026-09-09").after, taskId: newUuid() } }] }),
    ).rejects.toThrow(ProposalValidationError);
  });

  it("conflicts at apply when a fixed event appeared after the plan was computed, writing nothing", async () => {
    const proposal = await buildProposal(db, {
      origin: "scheduler",
      idempotencyKey: newUuid(),
      operations: [{
        op: "create",
        entityType: "event",
        after: { title: "Order tile", kind: "block", scheduleType: "flexible", isLocked: false, blockState: "planned", taskId: ids.errand, timezone: NY, startAt: at("2026-09-09", "18:00").toISO(), endAt: at("2026-09-09", "18:30").toISO(), peopleIds: [] },
      }],
    });
    await createEventDirect(db, { title: "Surprise dinner", kind: "personal", scheduleType: "fixed", isLocked: false, timezone: NY, startAt: at("2026-09-09", "18:15").toISO()!, endAt: at("2026-09-09", "19:15").toISO()!, peopleIds: [] });
    const outcome = await approvedApply(proposal.id);
    expect(outcome.outcome).toBe("conflicted");
    expect(await db.event.count({ where: { kind: "block", taskId: ids.errand, startAt: at("2026-09-09", "18:00").toJSDate() } })).toBe(0);
  });
});

describe("undo and rescheduling", () => {
  it("undoes an applied plan, and conflicts after a manual move of one of its blocks", async () => {
    const tuesday = "2026-09-08";
    // Monday's plan covered every existing task; give Tuesday fresh work.
    await db.task.create({ data: { title: "Write renovation budget update", projectId: ids.reno, remainingEstimateMinutes: 150, estimatedDurationMinutes: 150, isSplittable: true, workType: "deep", deadlineDate: new Date("2026-09-11"), deadlineType: "hard" } });
    const run = await planDay(db, tuesday, { now });
    expect(run.proposal).not.toBeNull();
    const applied = await approvedApply(run.proposal!.id);
    expect(applied.outcome).toBe("applied");
    if (applied.outcome !== "applied") return;
    const blocks = await db.event.findMany({ where: { kind: "block", startAt: { gte: at(tuesday, "00:00").toJSDate(), lt: at("2026-09-09", "00:00").toJSDate() } } });
    expect(blocks.length).toBeGreaterThan(0);

    const undo = await buildUndoProposal(db, applied.action.id, newUuid());
    expect(undo.status).toBe("pending");
    expect((await approvedApply(undo.id)).outcome).toBe("applied");
    expect(await db.event.count({ where: { id: { in: blocks.map((b) => b.id) } } })).toBe(0);

    const again = await planDay(db, tuesday, { now });
    const appliedAgain = await approvedApply(again.proposal!.id);
    expect(appliedAgain.outcome).toBe("applied");
    if (appliedAgain.outcome !== "applied") return;
    const moved = await db.event.findFirst({ where: { kind: "block", startAt: { gte: at(tuesday, "00:00").toJSDate() } }, orderBy: { startAt: "asc" } });
    await updateEventDirect(db, moved!.id, { startAt: at(tuesday, "20:30").toISO()!, endAt: at(tuesday, "21:00").toISO()! });
    const conflicted = await buildUndoProposal(db, appliedAgain.action.id, newUuid());
    expect(conflicted.status).toBe("conflicted");
  });

  it("reschedule_day cancels a missed block and places the work again; plan_day leaves missed blocks alone", async () => {
    const wednesday = "2026-09-09";
    const missed = await db.event.create({
      data: { title: "Order tile", kind: "block", scheduleType: "flexible", blockState: "missed_unconfirmed", taskId: ids.errand, timezone: NY, startAt: at(wednesday, "17:30").toJSDate(), endAt: at(wednesday, "18:00").toJSDate() },
    });
    const later = at(wednesday, "18:05");
    const plain = await planDay(db, wednesday, { now: later });
    expect(plain.proposal?.operations.some((o) => o.entityId === missed.id) ?? false).toBe(false);
    expect(plain.summary.unplaced.map((u) => u.title)).toContain("Order tile"); // contested evening, see below

    // Earlier days' blocks are in the past and their work is still outstanding
    // (remaining estimates are explicit, never inferred), so the evening is
    // contested. The user has finished the overdue deep task, and the errand
    // is now due tonight: tightest slack in the top band, so it is placed first.
    await db.task.update({ where: { id: ids.deep }, data: { status: "completed", completedAt: later.toJSDate() } });
    await db.task.update({ where: { id: ids.errand }, data: { deadlineDate: new Date(wednesday), deadlineType: "hard" } });
    const run = await rescheduleDay(db, wednesday, { now: later });
    expect(run.proposal).not.toBeNull();
    const cancel = run.proposal!.operations.find((o) => o.entityId === missed.id);
    expect(cancel?.op).toBe("update");
    expect((cancel?.after as { blockState: string }).blockState).toBe("cancelled");
    expect(cancel?.reason).toMatch(/ended without an outcome/);
    const replacement = run.proposal!.operations.find((o) => o.op === "create" && (o.after as { taskId: string }).taskId === ids.errand);
    expect(replacement).toBeDefined();
    expect(new Date((replacement!.after as { startAt: string }).startAt).getTime()).toBeGreaterThanOrEqual(later.toMillis());
    expect((await approvedApply(run.proposal!.id)).outcome).toBe("applied");
    expect((await db.event.findUniqueOrThrow({ where: { id: missed.id } })).blockState).toBe("cancelled");
  });

  it("schedule_task touches only that task", async () => {
    const thursday = at("2026-09-10", "00:00");
    const fresh = await db.task.create({ data: { title: "Compare cabinet quotes", projectId: ids.reno, remainingEstimateMinutes: 45, estimatedDurationMinutes: 45, workType: "shallow" } });
    await db.task.create({ data: { title: "Another open task", projectId: ids.reno, remainingEstimateMinutes: 45, estimatedDurationMinutes: 45 } });
    const run = await scheduleTask(db, fresh.id, { start: thursday, end: thursday.plus({ days: 1 }) }, { now });
    expect(run.proposal).not.toBeNull();
    const touched = run.proposal!.operations.map((o) => (o.after as { taskId?: string }).taskId ?? o.entityId);
    expect(touched).toEqual([fresh.id]);
  });
});

describe("priority recomputation in the database", () => {
  it("updates changed scores only and never touches user_priority", async () => {
    await db.task.update({ where: { id: ids.errand }, data: { userPriority: "must", computedPriorityScore: 1 } });
    const summary = await recomputePriorities(db, now);
    expect(summary.examined).toBeGreaterThanOrEqual(4);
    const errand = await db.task.findUniqueOrThrow({ where: { id: ids.errand } });
    expect(errand.userPriority).toBe("must");
    expect(errand.computedPriorityScore).not.toBe(1);
    const again = await recomputePriorities(db, now);
    expect(again.updated).toBe(0);
  });
});

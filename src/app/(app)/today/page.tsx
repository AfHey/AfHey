import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { activeWorkSession, markMissedBlocks } from "@/core/domain/blocks";
import { effectivePriority } from "@/core/domain/priority";
import { loadSchedulerSettings } from "@/core/domain/scheduler-settings";
import { dbToIsoDate } from "@/core/domain/time";
import { dayCapacityCheck } from "@/core/scheduler/feasibility";
import { feasibilityReport, loadPlanTasks } from "@/core/scheduler/operations";
import { dayStart, freeTime } from "@/core/scheduler/timeline";
import { getPrisma } from "@/db/client";
import { formatDateOnly, formatInstant, isDateOnlyOverdue } from "@/lib/format";
import { TodayView } from "./today-view";
import { scheduledMinutesAhead, type TodayData } from "./view-model";

/**
 * Today (product-spec §4; Phase 2 Step 9): "What should I do today?" —
 * fixed events, planned blocks with the focus timer, tasks by effective
 * priority with feasibility flags, Waiting For, the capacity check, and the
 * roll-over prompt. Everything shown is derived from stored rows.
 */
export default async function TodayPage() {
  const db = getPrisma();
  const settings = await loadSchedulerSettings(db);
  const zone = settings.timezone;
  const now = DateTime.now().setZone(zone);
  await markMissedBlocks(db, now.toJSDate());
  const today = now.toISODate()!;
  const start = dayStart(today, zone);
  const end = start.plus({ days: 1 });
  const yesterday = start.minus({ days: 1 });
  const fmtTime = (d: Date) => DateTime.fromJSDate(d).setZone(zone).toFormat("HH:mm");

  const [events, taskRows, waitingRows, yesterdayMissed, session, planTasks] = await Promise.all([
    db.event.findMany({
      where: {
        archivedAt: null,
        // NULL block_state (plain events) must pass: a bare NOT would drop them in SQL.
        AND: [{ OR: [{ blockState: null }, { blockState: { not: "cancelled" } }] }],
        OR: [
          { startAt: { lt: end.toJSDate() }, endAt: { gt: start.toJSDate() } },
          { allDayStartDate: { lte: start.toJSDate() }, allDayEndDate: { gt: start.toJSDate() } },
        ],
      },
      orderBy: [{ startAt: "asc" }],
    }),
    db.task.findMany({
      where: { status: "open", bucket: "active", taskKind: "action", archivedAt: null },
      include: { project: true },
      orderBy: [{ computedPriorityScore: "desc" }, { createdAt: "asc" }],
    }),
    db.task.findMany({
      where: { status: "open", taskKind: "waiting_for", archivedAt: null },
      include: { waitingForPerson: true },
      orderBy: [{ nudgeDate: "asc" }],
    }),
    db.event.findMany({
      where: { kind: "block", blockState: "missed_unconfirmed", archivedAt: null, startAt: { gte: yesterday.toJSDate(), lt: start.toJSDate() } },
      include: { task: true },
      orderBy: { startAt: "asc" },
    }),
    activeWorkSession(db),
    loadPlanTasks(db, zone),
  ]);
  const feasibility = new Map((await feasibilityReport(db, settings, now, planTasks.tasks)).map((f) => [f.taskId, f]));
  const estimateRequired = new Set(planTasks.estimateRequired.map((t) => t.taskId));

  const blocks = events
    .filter((e) => e.kind === "block" && e.startAt && e.endAt && e.taskId && e.blockState)
    .map((e) => ({
      id: e.id,
      taskId: e.taskId!,
      title: e.title,
      start: e.startAt!.toISOString(),
      end: e.endAt!.toISOString(),
      state: e.blockState!,
      isLocked: e.isLocked,
      scheduleType: e.scheduleType,
      label: `${fmtTime(e.startAt!)} – ${fmtTime(e.endAt!)}`,
    }));
  const blockTaskIds = new Set(blocks.filter((b) => b.state !== "completed").map((b) => b.taskId));
  const fixed = events
    .filter((e) => e.kind !== "block")
    .map((e) => ({
      id: e.id,
      title: e.title,
      allDay: !e.startAt,
      kind: e.kind,
      label: e.startAt && e.endAt ? `${fmtTime(e.startAt)} – ${fmtTime(e.endAt)}` : "All day",
    }));

  // Capacity (spec §4.1 item 1): eligible free minutes left today versus work still planned.
  const busy = events
    .filter((e) => e.startAt && e.endAt && (e.kind !== "block" || e.scheduleType === "fixed" || e.isLocked || e.blockState === "in_progress"))
    .map((e) => ({ start: e.startAt!.getTime(), end: e.endAt!.getTime() }));
  const freeToday = freeTime(
    { start: Math.max(now.toMillis(), start.toMillis()), end: end.toMillis() },
    {
      zone,
      availability: settings.availability.map((w) => ({ weekday: w.weekday, startTime: w.startTime, endTime: w.endTime })),
      protectedWindows: settings.protected,
      busy,
      bufferMinutes: settings.preferences.bufferMinutes,
    },
  );
  const capacity = dayCapacityCheck(freeToday, scheduledMinutesAhead(blocks, now.toISO()!));

  const data: TodayData = {
    date: today,
    zone,
    dateLabel: now.toFormat("cccc d LLLL"),
    yesterday: yesterday.toISODate()!,
    fixed,
    blocks,
    tasks: taskRows.map((t) => {
      const f = feasibility.get(t.id);
      const deadlineLabel = t.deadlineDate ? formatDateOnly(t.deadlineDate) : t.deadlineAt && t.deadlineTimezone ? formatInstant(t.deadlineAt, t.deadlineTimezone) : null;
      return {
        id: t.id,
        title: t.title,
        band: effectivePriority(t.userPriority, t.computedPriorityScore),
        projectName: t.project?.name ?? null,
        deadlineLabel,
        overdue: (t.deadlineDate !== null && isDateOnlyOverdue(t.deadlineDate, now.toJSDate())) || (t.deadlineAt !== null && t.deadlineAt.getTime() < now.toMillis()),
        remainingEstimateMinutes: t.remainingEstimateMinutes,
        feasibility: f?.status ?? (estimateRequired.has(t.id) ? "estimate_required" : t.isSchedulable ? null : "not_schedulable"),
        shortfallMinutes: f?.shortfallMinutes ?? 0,
        hasBlockToday: blockTaskIds.has(t.id),
      };
    }),
    waiting: waitingRows.map((t) => ({
      id: t.id,
      title: t.title,
      personName: t.waitingForPerson?.name ?? null,
      nudgeLabel: t.nudgeDate ? formatDateOnly(t.nudgeDate) : null,
      nudgeDue: t.nudgeDate ? dbToIsoDate(t.nudgeDate) <= today : false,
    })),
    rollover: yesterdayMissed.map((b) => ({ blockId: b.id, taskId: b.taskId!, title: b.task?.title ?? b.title, label: `${fmtTime(b.startAt!)} – ${fmtTime(b.endAt!)}` })),
    capacity,
    activeSession: session
      ? { id: session.id, taskId: session.taskId, eventId: session.eventId, startedAt: session.startedAt.toISOString(), title: session.event?.title ?? session.task.title }
      : null,
  };

  return (
    <>
      <PageHeader title="Today" note={data.dateLabel} />
      <TodayView data={data} />
    </>
  );
}

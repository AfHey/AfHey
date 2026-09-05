import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { activeWorkSession, markMissedBlocks } from "@/core/domain/blocks";
import { getPrisma } from "@/db/client";
import { CalendarView } from "./calendar-view";
import { deadlineMarkers, toCalendarEvent, visibleRange, type CalendarViewName } from "./view-model";

/**
 * Calendar (Phase 2, Step 8): day and week time grids over fixed Events and
 * work blocks, drawn by FullCalendar in the user's current zone. Drag,
 * resize, lock, fix, unschedule, and mark-done are direct manual edits;
 * "Plan day/week" and "Reschedule" produce scheduler Proposals reviewed as a
 * calendar diff. Task deadlines are derived read-only markers.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const params = await searchParams;
  const db = getPrisma();
  const settings = await db.userSettings.findFirst();
  const zone = settings?.currentTimezone ?? "America/New_York";
  const now = DateTime.now().setZone(zone);
  await markMissedBlocks(db, now.toJSDate());
  const view: CalendarViewName = params.view === "day" ? "timeGridDay" : "timeGridWeek";
  const requested = params.date && DateTime.fromISO(params.date, { zone }).isValid ? params.date : now.toISODate()!;
  const range = visibleRange(requested, zone, view);

  const [rows, tasks, session] = await Promise.all([
    db.event.findMany({
      where: {
        archivedAt: null,
        // NULL block_state (plain events) must pass: a bare NOT would drop them in SQL.
        AND: [{ OR: [{ blockState: null }, { blockState: { not: "cancelled" } }] }],
        OR: [
          { startAt: { lt: range.end }, endAt: { gt: range.start } },
          { allDayStartDate: { lt: range.end }, allDayEndDate: { gt: range.start } },
        ],
      },
      orderBy: [{ startAt: "asc" }, { allDayStartDate: "asc" }],
    }),
    db.task.findMany({
      where: {
        status: "open",
        archivedAt: null,
        OR: [{ deadlineDate: { gte: range.start, lt: range.end } }, { deadlineAt: { gte: range.start, lt: range.end } }],
      },
    }),
    activeWorkSession(db),
  ]);
  const events = rows.map(toCalendarEvent).filter((e) => e !== null);
  const missed = events.filter((e) => e.blockState === "missed_unconfirmed").length;

  return (
    <>
      <PageHeader title="Calendar" note={`Times shown in ${zone}. Drag to move, pull the edge to resize, tap a block for actions.`} />
      <CalendarView
        zone={zone}
        initialDate={range.anchor}
        initialView={view}
        events={events}
        deadlines={deadlineMarkers(tasks, zone)}
        activeSession={session ? { id: session.id, eventId: session.eventId, taskId: session.taskId } : null}
        missedCount={missed}
        today={now.toISODate()!}
      />
    </>
  );
}

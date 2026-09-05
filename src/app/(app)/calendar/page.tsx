import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { getPrisma } from "@/db/client";
import { CalendarView } from "./calendar-view";
import { toCalendarEvent, visibleRange, type CalendarViewName } from "./view-model";

/**
 * Calendar (Phase 2, Step 1 spike): day and week time grids over stored
 * Events, drawn by FullCalendar in the user's current zone. Gestures are
 * reported, not persisted, until Step 7 wires the block mutations.
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
  const view: CalendarViewName = params.view === "day" ? "timeGridDay" : "timeGridWeek";
  const requested = params.date && DateTime.fromISO(params.date, { zone }).isValid ? params.date : DateTime.now().setZone(zone).toISODate()!;
  const range = visibleRange(requested, zone, view);

  const rows = await db.event.findMany({
    where: {
      archivedAt: null,
      OR: [
        { startAt: { lt: range.end }, endAt: { gt: range.start } },
        { allDayStartDate: { lt: range.end }, allDayEndDate: { gt: range.start } },
      ],
    },
    orderBy: [{ startAt: "asc" }, { allDayStartDate: "asc" }],
  });
  const events = rows.map(toCalendarEvent).filter((e) => e !== null);

  return (
    <>
      <PageHeader title="Calendar" note={`Times shown in ${zone}. Dragging is a preview only until Step 7.`} />
      <CalendarView zone={zone} initialDate={range.anchor} initialView={view} events={events} />
    </>
  );
}

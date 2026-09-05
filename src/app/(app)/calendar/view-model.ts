/**
 * Calendar view-model (Phase 2, Step 1). Pure mapping from stored Events to
 * what the calendar library draws. All date arithmetic here is Luxon in the
 * user's zone; the component receives finished strings and never computes.
 */
import { DateTime } from "luxon";
import { dbToIsoDate } from "@/core/domain/time";
import type { Event } from "@/db/generated/client";

export type CalendarViewName = "timeGridDay" | "timeGridWeek";

export interface CalendarEventDto {
  id: string;
  title: string;
  /** ISO instant with offset (timed) or ISO date (all-day). */
  start: string;
  /** Exclusive end: ISO instant (timed) or ISO date (all-day). */
  end: string;
  allDay: boolean;
  kind: Event["kind"];
  scheduleType: Event["scheduleType"];
  isLocked: boolean;
  blockState: Event["blockState"];
  /** Class names the library attaches to the event element (v7 event property `className`). */
  className: string[];
}

export function eventClassNames(event: Pick<Event, "kind" | "scheduleType" | "isLocked" | "blockState">): string[] {
  const classes = ["afhey-event", `afhey-${event.scheduleType}`, `afhey-kind-${event.kind}`];
  if (event.isLocked) classes.push("afhey-locked");
  if (event.blockState) classes.push(`afhey-block-${event.blockState}`);
  return classes;
}

/** Returns null for events the calendar cannot place (neither timed nor all-day). */
export function toCalendarEvent(event: Event): CalendarEventDto | null {
  const base = {
    id: event.id,
    title: event.title,
    kind: event.kind,
    scheduleType: event.scheduleType,
    isLocked: event.isLocked,
    blockState: event.blockState,
    className: eventClassNames(event),
  };
  if (event.startAt && event.endAt) {
    return { ...base, start: event.startAt.toISOString(), end: event.endAt.toISOString(), allDay: false };
  }
  if (event.allDayStartDate && event.allDayEndDate) {
    return {
      ...base,
      start: dbToIsoDate(event.allDayStartDate),
      end: dbToIsoDate(event.allDayEndDate),
      allDay: true,
    };
  }
  return null;
}

/**
 * The instant range worth loading for a view anchored on `dateIso` in `zone`:
 * the Monday-first week containing the date (week view) or the day itself,
 * padded by one day on each side so events spanning midnight are included.
 */
export function visibleRange(
  dateIso: string,
  zone: string,
  view: CalendarViewName,
): { start: Date; end: Date; anchor: string } {
  const anchor = DateTime.fromISO(dateIso, { zone });
  const day = anchor.isValid ? anchor : DateTime.now().setZone(zone);
  // Luxon weekdays: Monday = 1 (the product owner's week start).
  const first = view === "timeGridWeek" ? day.startOf("day").minus({ days: day.weekday - 1 }) : day.startOf("day");
  const last = view === "timeGridWeek" ? first.plus({ days: 7 }) : first.plus({ days: 1 });
  return {
    start: first.minus({ days: 1 }).toJSDate(),
    end: last.plus({ days: 1 }).toJSDate(),
    anchor: day.toISODate()!,
  };
}

/** Formats an instant as the user would read it in their zone. */
export function formatInZone(iso: string | Date, zone: string): string {
  const dt = (typeof iso === "string" ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso)).setZone(zone);
  return dt.toFormat("ccc d LLL HH:mm");
}

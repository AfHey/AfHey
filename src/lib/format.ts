import { DateTime } from "luxon";

/** "Mon, Sep 7" for date-only values (which live as UTC-midnight Dates). */
export function formatDateOnly(date: Date): string {
  return DateTime.fromJSDate(date, { zone: "utc" }).toFormat("ccc, LLL d");
}

/** Instant formatted in the given zone, e.g. "Wed, Sep 2, 10:00". */
export function formatInstant(date: Date, zone: string): string {
  return DateTime.fromJSDate(date).setZone(zone).toFormat("ccc, LLL d, HH:mm");
}

export function formatTimeRange(start: Date, end: Date, zone: string): string {
  const s = DateTime.fromJSDate(start).setZone(zone);
  const e = DateTime.fromJSDate(end).setZone(zone);
  return `${s.toFormat("ccc, LLL d, HH:mm")}–${e.toFormat("HH:mm")}`;
}

/** True when a date-only deadline is before today (UTC calendar compare). */
export function isDateOnlyOverdue(date: Date, today = new Date()): boolean {
  return (
    DateTime.fromJSDate(date, { zone: "utc" }).toISODate()! <
    DateTime.fromJSDate(today).toISODate()!
  );
}

import { DateTime, IANAZone } from "luxon";

/** True for a valid IANA zone name such as "America/New_York". */
export function isValidTimezone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses "HH:MM" to minutes since midnight; null when malformed. */
export function timeOfDayToMinutes(value: string): number | null {
  const match = TIME_OF_DAY.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Local time-of-day columns are Postgres TIME; Prisma transports them as
 * Date objects whose UTC time-of-day carries the value. These helpers keep
 * that convention in exactly one place.
 */
export function timeOfDayToDb(value: string): Date {
  const minutes = timeOfDayToMinutes(value);
  if (minutes === null) {
    throw new Error(`Invalid time of day: ${JSON.stringify(value)}`);
  }
  return new Date(Date.UTC(1970, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

export function dbToTimeOfDay(value: Date): string {
  const h = String(value.getUTCHours()).padStart(2, "0");
  const m = String(value.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar-date columns are Postgres DATE, transported as UTC-midnight Dates. */
export function isoDateToDb(value: string): Date {
  if (!ISO_DATE.test(value) || !DateTime.fromISO(value, { zone: "utc" }).isValid) {
    throw new Error(`Invalid ISO date: ${JSON.stringify(value)}`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export function dbToIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

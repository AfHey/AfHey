/**
 * Deterministic temporal resolution (product-spec §8.1). The extraction model
 * supplies only a literal phrase, a relation, and an optional anchor; this
 * module is the sole authority that turns them into a calendar date or an
 * instant + IANA zone. It never silently makes a strong assumption:
 * ambiguous phrases return `needs_confirmation` with concrete suggestions,
 * invalid components block resolution, explicit zones/offsets are honored,
 * and DST gaps/folds are detected by enumerating the zone's real offsets
 * (review findings 10-13, 2026-09-05).
 */
import { DateTime, FixedOffsetZone, IANAZone } from "luxon";
import type { Confidence } from "@/core/domain/enums";

export type TemporalRelation = "on" | "before" | "after" | "within" | "duration_after";

export interface TemporalContext {
  /** Current instant, already expressed in the user's current timezone. */
  now: DateTime;
  /** Day a time-only phrase belongs to (e.g. an event's start day for its end). */
  referenceDay?: DateTime;
  /** A validated anchor for phrases like "two hours after the launch meeting". */
  anchor?: { instant?: DateTime; date?: string };
}

export type TemporalResolution =
  | { kind: "date"; date: string; confidence: Confidence; note?: string }
  | {
      kind: "instant";
      instant: string;
      timezone: string;
      local: string;
      confidence: Confidence;
      note?: string;
    }
  | { kind: "needs_confirmation"; reason: string; suggestions: string[] }
  | { kind: "unresolved"; reason: string };

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, few: 3,
};

const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
  sunday: 7, sun: 7,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9,
  sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

/** Elapsed units are exact minutes; calendar units follow the wall clock. */
const ELAPSED_UNITS: Record<string, number> = {
  minute: 1, minutes: 1, min: 1, mins: 1, hour: 60, hours: 60, hr: 60, hrs: 60, h: 60,
};
const CALENDAR_UNITS: Record<string, number> = { day: 1, days: 1, week: 7, weeks: 7 };

function quantity(word: string): number | null {
  if (/^\d+(\.\d+)?$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

const DURATION_RE =
  /\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple(?:\s+of)?|few)\s*(?:calendar\s+)?(minutes?|mins?|hours?|hrs?|h|days?|weeks?)\b/;

interface ParsedDuration {
  minutes: number;
  /** "calendar" durations (days/weeks) move by wall-clock days, not minutes. */
  mode: "elapsed" | "calendar";
  match: string;
}

function parseDuration(lower: string): ParsedDuration | null {
  const half = /\bhalf\s+an?\s+(hour|day)\b/.exec(lower);
  if (half) {
    return half[1] === "hour"
      ? { minutes: 30, mode: "elapsed", match: half[0] }
      : { minutes: 720, mode: "elapsed", match: half[0] };
  }
  const match = DURATION_RE.exec(lower);
  if (!match) return null;
  const amount = quantity(match[1].replace(/\s+of$/, ""));
  if (amount === null) return null;
  if (ELAPSED_UNITS[match[2]]) return { minutes: Math.round(amount * ELAPSED_UNITS[match[2]]), mode: "elapsed", match: match[0] };
  if (CALENDAR_UNITS[match[2]]) return { minutes: Math.round(amount * CALENDAR_UNITS[match[2]] * 1440), mode: "calendar", match: match[0] };
  return null;
}

/** "two hours", "90 min", "half an hour", "a day" → minutes; null if none. */
export function parseDurationMinutes(text: string): number | null {
  return parseDuration(text.toLowerCase())?.minutes ?? null;
}

// --- Component parsing: absent | invalid | valid --------------------------

type Component<T> = { status: "absent" } | { status: "invalid"; reason: string } | ({ status: "valid" } & T);

interface TimePart {
  hour: number;
  minute: number;
  confidence: Confidence;
  alternatives?: Array<{ hour: number; minute: number }>;
}

function parseTime(lower: string): Component<TimePart> {
  if (/\bnoon\b/.test(lower)) return { status: "valid", hour: 12, minute: 0, confidence: "high" };
  if (/\bmidnight\b/.test(lower)) return { status: "valid", hour: 0, minute: 0, confidence: "high" };

  const clock = /\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?\b/.exec(lower);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2]);
    const meridiem = clock[3]?.replace(/\./g, "");
    if (minute > 59 || hour > 23 || (meridiem && (hour < 1 || hour > 12))) {
      return { status: "invalid", reason: `${clock[1]}:${clock[2]} is not a valid time of day` };
    }
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return { status: "valid", hour, minute, confidence: "high" };
  }

  const withMeridiem = /\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/.exec(lower);
  if (withMeridiem) {
    let hour = Number(withMeridiem[1]);
    const meridiem = withMeridiem[2].replace(/\./g, "");
    if (hour < 1 || hour > 12) return { status: "invalid", reason: `${withMeridiem[1]}${meridiem} is not a valid time of day` };
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return { status: "valid", hour, minute: 0, confidence: "high" };
  }

  const bare = /\b(?:at|around|about|@)\s*(\d{1,2})\b(?!\s*(?:am|pm|:|\/|-))/.exec(lower);
  if (bare) {
    const hour = Number(bare[1]);
    if (hour === 12) return { status: "valid", hour: 12, minute: 0, confidence: "medium" };
    if (hour >= 1 && hour <= 6) return { status: "valid", hour: hour + 12, minute: 0, confidence: "medium" };
    if (hour >= 7 && hour <= 11) {
      return {
        status: "valid",
        hour,
        minute: 0,
        confidence: "needs_confirmation",
        alternatives: [{ hour, minute: 0 }, { hour: hour + 12, minute: 0 }],
      };
    }
    if (hour >= 13 && hour <= 23) return { status: "valid", hour, minute: 0, confidence: "high" };
    return { status: "invalid", reason: `${bare[1]} is not a valid hour` };
  }
  return { status: "absent" };
}

interface DayPart {
  date: DateTime;
  confidence: Confidence;
  note?: string;
  alternatives?: DateTime[];
  reason?: string;
}

function upcomingWeekday(from: DateTime, weekday: number, allowToday: boolean): DateTime {
  let delta = (weekday - from.weekday + 7) % 7;
  if (delta === 0 && !allowToday) delta = 7;
  return from.plus({ days: delta }).startOf("day");
}

const MONTH_NAMES =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec";

function parseDay(lower: string, now: DateTime): Component<DayPart> {
  const today = now.startOf("day");
  const valid = (part: DayPart): Component<DayPart> => ({ status: "valid", ...part });

  if (/\bday after tomorrow\b/.test(lower)) return valid({ date: today.plus({ days: 2 }), confidence: "high" });
  if (/\btomorrow\b/.test(lower)) return valid({ date: today.plus({ days: 1 }), confidence: "high" });
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(lower)) return valid({ date: today, confidence: "high" });

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower);
  if (iso) {
    const date = DateTime.fromObject({ year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }, { zone: now.zone });
    return date.isValid ? valid({ date, confidence: "high" }) : { status: "invalid", reason: `${iso[0]} is not a valid date` };
  }

  const monthDay = new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`).exec(lower);
  const dayMonth = monthDay ? null : new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})\\.?(?:,?\\s+(\\d{4}))?\\b`).exec(lower);
  if (monthDay || dayMonth) {
    const monthWord = monthDay ? monthDay[1] : dayMonth![2];
    const dayNum = Number(monthDay ? monthDay[2] : dayMonth![1]);
    const yearStr = monthDay ? monthDay[3] : dayMonth![3];
    return resolveMonthDay(MONTHS[monthWord], dayNum, yearStr ? Number(yearStr) : null, today);
  }

  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(lower);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null;
    return resolveMonthDay(Number(numeric[1]), Number(numeric[2]), year, today);
  }

  if (/\bnext weekend\b/.test(lower)) {
    const saturday = upcomingWeekday(today.plus({ weeks: 1 }).startOf("week"), 6, true);
    return valid({ date: saturday, confidence: "needs_confirmation", alternatives: [saturday, saturday.plus({ days: 1 })], reason: "the phrase spans two days" });
  }
  if (/\bthis weekend\b|\bweekend\b/.test(lower)) {
    const saturday = upcomingWeekday(today, 6, true);
    return valid({ date: saturday, confidence: "needs_confirmation", alternatives: [saturday, saturday.plus({ days: 1 })], reason: "the phrase spans two days" });
  }
  if (/\bnext week\b/.test(lower)) {
    const monday = today.plus({ weeks: 1 }).startOf("week");
    return valid({ date: monday, confidence: "needs_confirmation", alternatives: [monday, monday.plus({ days: 4 })], reason: "the phrase is a window, not a day" });
  }
  if (/\bend of (the )?week\b/.test(lower)) {
    const friday = upcomingWeekday(today, 5, true);
    return valid({ date: friday, confidence: "needs_confirmation", alternatives: [friday, friday.plus({ days: 2 })], reason: "end of week could mean Friday or Sunday" });
  }
  if (/\bend of (the )?month\b/.test(lower)) {
    const last = today.endOf("month").startOf("day");
    return valid({ date: last, confidence: "needs_confirmation", alternatives: [last], reason: "end of month is approximate" });
  }

  const weekday = /\b(next|this|coming)?\s*(monday|mon|tuesday|tues?|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat|sunday|sun)\b/.exec(lower);
  if (weekday) {
    const qualifier = weekday[1];
    const target = WEEKDAYS[weekday[2]];
    const plain = upcomingWeekday(today, target, false);
    if (qualifier === "next") {
      const nextWeek = today.plus({ weeks: 1 }).startOf("week").plus({ days: target - 1 });
      if (nextWeek.hasSame(plain, "day")) return valid({ date: nextWeek, confidence: "high" });
      return valid({ date: nextWeek, confidence: "needs_confirmation", alternatives: [plain, nextWeek], reason: "\"next\" plus a weekday could mean either of two dates" });
    }
    if (today.weekday === target) {
      return valid({ date: today, confidence: "needs_confirmation", alternatives: [today, today.plus({ weeks: 1 })], reason: "the weekday named is today; it could mean today or next week" });
    }
    return valid({ date: plain, confidence: "high" });
  }
  return { status: "absent" };
}

function resolveMonthDay(month: number, day: number, explicitYear: number | null, today: DateTime): Component<DayPart> {
  const year = explicitYear ?? today.year;
  let date = DateTime.fromObject({ year, month, day }, { zone: today.zone });
  if (!date.isValid) return { status: "invalid", reason: `month ${month} does not have a day ${day}` };
  if (explicitYear === null && date < today) {
    date = date.plus({ years: 1 });
    return { status: "valid", date, confidence: "medium", note: "assumed next year because the date already passed" };
  }
  return { status: "valid", date, confidence: "high" };
}

function hasTimeOfDayHint(lower: string): boolean {
  return /\b(morning|afternoon|evening|tonight|after work|after lunch|before work|first thing)\b/.test(lower);
}

// --- Explicit zones and offsets (finding 11) -------------------------------

interface ZoneSpec {
  /** IANA zone when named; null for offset-only. */
  zone: string | null;
  /** Fixed offset in minutes when given explicitly. */
  offsetMinutes: number | null;
  match: string;
}

function parseZoneSpec(literal: string): ZoneSpec | null {
  const iana = /(?<![\w/])([A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)(?![\w/])/.exec(literal);
  if (iana && IANAZone.isValidZone(iana[1])) return { zone: iana[1], offsetMinutes: null, match: iana[0] };
  const withPrefix = /\b(?:UTC|GMT)\s*([+\-−–])\s*(\d{1,2})(?::?(\d{2}))?\b/i.exec(literal);
  const bare = withPrefix ? null : /(?<![\d:])([+\-−–])(\d{2}):(\d{2})\b/.exec(literal);
  const offset = withPrefix ?? bare;
  if (offset) {
    const sign = /[+]/.test(offset[1]) ? 1 : -1;
    const minutes = sign * (Number(offset[2]) * 60 + Number(offset[3] ?? 0));
    return { zone: null, offsetMinutes: minutes, match: offset[0] };
  }
  if (/\b(?:UTC|GMT)\b/i.test(literal) || /\b\d{1,2}(?::\d{2})?Z\b/.test(literal)) {
    return { zone: "UTC", offsetMinutes: null, match: /\b(?:UTC|GMT)\b/i.exec(literal)?.[0] ?? "Z" };
  }
  return null;
}

/** Zone text inside a literal ("Europe/London", "UTC−05:00", "GMT"), or null. */
export function zoneSpecIn(literal: string): string | null {
  return parseZoneSpec(literal)?.match ?? null;
}

/**
 * A zone written immediately after a temporal phrase (", UTC−05:00",
 * " Europe/London") that the provider left outside the literal (eval-v2
 * cases 12 and 14). Deterministic code, not the model, decides the zone.
 */
export function zoneSpecAfter(text: string, index: number): string | null {
  const tail = text.slice(index, index + 48);
  const lead = /^[\s,;:—–-]*(?:(?:in|at)\s+)?/.exec(tail)?.[0] ?? "";
  const rest = tail.slice(lead.length);
  const iana = /^([A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)(?![\w/])/.exec(rest);
  if (iana && IANAZone.isValidZone(iana[1])) return iana[1];
  const offset = /^(?:UTC|GMT)\s*[+\-−–]\s*\d{1,2}(?::?\d{2})?(?![\d:])|^(?:UTC|GMT)\b/i.exec(rest);
  return offset ? offset[0] : null;
}

// --- DST-aware local time construction (finding 10) ------------------------

/** Every real instant at which the zone's wall clock reads the given time. */
function localOccurrences(zone: string, y: number, m: number, d: number, h: number, mi: number): DateTime[] {
  const wallUtc = Date.UTC(y, m - 1, d, h, mi);
  const offsets = new Set<number>();
  for (let t = wallUtc - 36 * 3_600_000; t <= wallUtc + 36 * 3_600_000; t += 15 * 60_000) {
    offsets.add(DateTime.fromMillis(t, { zone }).offset);
  }
  const found: DateTime[] = [];
  for (const offset of offsets) {
    const candidate = DateTime.fromMillis(wallUtc - offset * 60_000, { zone });
    if (candidate.year === y && candidate.month === m && candidate.day === d && candidate.hour === h && candidate.minute === mi) {
      if (!found.some((f) => f.toMillis() === candidate.toMillis())) found.push(candidate);
    }
  }
  return found.sort((a, b) => a.toMillis() - b.toMillis());
}

function buildInstant(
  day: DateTime,
  time: TimePart,
  confidence: Confidence,
  zoneSpec: ZoneSpec | null,
  note?: string,
): TemporalResolution {
  const zone = zoneSpec?.zone ?? day.zoneName!;
  if (zoneSpec?.offsetMinutes !== null && zoneSpec?.offsetMinutes !== undefined && zoneSpec.zone === null) {
    // Offset-only: the instant is unambiguous; verify it agrees with the
    // user's zone when the wall time exists there, else still resolve it.
    const fixed = DateTime.fromObject(
      { year: day.year, month: day.month, day: day.day, hour: time.hour, minute: time.minute },
      { zone: FixedOffsetZone.instance(zoneSpec.offsetMinutes) },
    );
    const inUserZone = localOccurrences(day.zoneName!, day.year, day.month, day.day, time.hour, time.minute);
    if (inUserZone.length > 1 && !inUserZone.some((o) => o.toMillis() === fixed.toMillis())) {
      return {
        kind: "needs_confirmation",
        reason: "the stated offset does not match either occurrence of that local time",
        suggestions: inUserZone.map((o) => o.toISO()!),
      };
    }
    return {
      kind: "instant",
      instant: fixed.toUTC().toISO()!,
      timezone: day.zoneName!,
      local: fixed.setZone(day.zoneName!).toFormat("yyyy-MM-dd'T'HH:mm"),
      confidence,
      note: [note, `offset ${zoneSpec.match.trim()} taken from the text`].filter(Boolean).join("; "),
    };
  }

  const occurrences = localOccurrences(zone, day.year, day.month, day.day, time.hour, time.minute);
  if (occurrences.length === 0) {
    // Spring-forward gap: suggest the first valid local time after it.
    const wall = DateTime.utc(day.year, day.month, day.day, time.hour, time.minute);
    for (let m = 1; m <= 180; m++) {
      const w = wall.plus({ minutes: m });
      const probe = localOccurrences(zone, w.year, w.month, w.day, w.hour, w.minute);
      if (probe.length >= 1) {
        return {
          kind: "needs_confirmation",
          reason: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")} does not exist on ${day.toISODate()} in ${zone} (clocks spring forward)`,
          suggestions: [probe[0].toISO()!],
        };
      }
    }
    return { kind: "unresolved", reason: "no valid local time exists after the DST gap" };
  }
  if (occurrences.length > 1) {
    return {
      kind: "needs_confirmation",
      reason: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")} occurs ${occurrences.length} times on ${day.toISODate()} in ${zone} (clocks fall back)`,
      suggestions: occurrences.map((o) => o.toISO()!),
    };
  }
  const instant = occurrences[0];
  return {
    kind: "instant",
    instant: instant.toUTC().toISO()!,
    timezone: zone,
    local: instant.toFormat("yyyy-MM-dd'T'HH:mm"),
    confidence,
    note: [note, zoneSpec?.zone ? `zone ${zoneSpec.zone} taken from the text` : undefined].filter(Boolean).join("; ") || undefined,
  };
}

// --- Phrase detection (finding A) -----------------------------------------

export interface DetectedTemporalPhrase {
  literal: string;
  start: number;
  end: number;
  relation: TemporalRelation;
}

const DAY_CORE =
  "day after tomorrow|tomorrow|today|tonight|this weekend|next weekend|next week|end of (?:the )?(?:week|month)|(?:(?:next|this|coming) )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thurs|fri|sat|sun)\\b";
const DATE_CORE =
  "\\d{4}-\\d{2}-\\d{2}|(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\\.? \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?|\\d{1,2}(?:st|nd|rd|th)? (?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\\b|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?";
const TIME_CORE = "\\d{1,2}:\\d{2}(?: ?(?:am|pm))?|\\d{1,2} ?(?:am|pm)|noon|midnight";
const DURATION_CORE =
  "(?:in|within) (?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple of|few) (?:minutes?|mins?|hours?|hrs?|days?|weeks?)";

const PHRASE_PATTERN = new RegExp(
  `(?:\\b(?:by|before|after|until|due|around|at|on) )?(?:${DURATION_CORE}|(?:${DAY_CORE}|${DATE_CORE})(?: (?:at|around) (?:${TIME_CORE}|\\d{1,2}\\b))?|${TIME_CORE})`,
  "gi",
);

export function detectTemporalPhrases(text: string): DetectedTemporalPhrase[] {
  const found: DetectedTemporalPhrase[] = [];
  for (const match of text.matchAll(PHRASE_PATTERN)) {
    const literal = match[0].trim();
    if (!literal) continue;
    const start = match.index + match[0].indexOf(literal);
    const lower = literal.toLowerCase();
    let relation: TemporalRelation = "on";
    if (/^(by|before|until|due)\b/.test(lower)) relation = "before";
    else if (/^after\b/.test(lower)) relation = "after";
    else if (/^in\b/.test(lower)) relation = "duration_after";
    else if (/^within\b/.test(lower)) relation = "within";
    found.push({ literal, start, end: start + literal.length, relation });
  }
  return found;
}

// --- Resolution ------------------------------------------------------------

const worse = (a: Confidence, b: Confidence): Confidence => {
  const rank = { high: 0, medium: 1, needs_confirmation: 2 };
  return rank[a] >= rank[b] ? a : b;
};

/** True when the phrase names something other than now as its reference. */
function mentionsAnchor(lower: string, duration: ParsedDuration | null): boolean {
  let rest = lower;
  if (duration) rest = rest.replace(duration.match, " ");
  rest = rest.replace(/\b(in|within|after|before|following|from|now|the|a|an|of|later|earlier|prior|to)\b/g, " ");
  return /[a-z]{2,}/.test(rest);
}

export function resolveTemporal(
  literal: string,
  relation: TemporalRelation,
  context: TemporalContext,
): TemporalResolution {
  const now = context.now;
  const zoneSpec = parseZoneSpec(literal);
  const stripped = zoneSpec ? literal.replace(zoneSpec.match, " ") : literal;
  const lower = stripped.toLowerCase().replace(/\s+/g, " ").trim();

  // Relative durations: "in two hours", "within two weeks", "two hours after X".
  const duration = parseDuration(lower);
  const relativeRelation = relation === "duration_after" || relation === "within" || /^\s*in\b/.test(lower);
  if (duration && (relativeRelation || mentionsAnchor(lower, duration) || /\b(after|before)\b/.test(lower))) {
    const anchored = mentionsAnchor(lower, duration);
    let base: DateTime | null = null;
    let baseIsDate = false;
    if (anchored) {
      if (context.anchor?.instant) base = context.anchor.instant.setZone(now.zoneName!);
      else if (context.anchor?.date) {
        base = DateTime.fromISO(context.anchor.date, { zone: now.zoneName! });
        baseIsDate = true;
      } else {
        return {
          kind: "needs_confirmation",
          reason: "the phrase is relative to an event that could not be identified",
          suggestions: [],
        };
      }
    } else {
      base = now;
    }
    const backwards = /\b(before|prior|earlier)\b/.test(lower);
    const sign = backwards ? -1 : 1;
    if (duration.mode === "calendar" || baseIsDate) {
      const target = base.plus({ days: sign * Math.round(duration.minutes / 1440) });
      return {
        kind: "date",
        date: target.toISODate()!,
        confidence: relation === "within" ? "medium" : "high",
        note: relation === "within" ? "latest date within the stated window" : undefined,
      };
    }
    const target = base.plus({ minutes: sign * duration.minutes });
    return {
      kind: "instant",
      instant: target.toUTC().toISO()!,
      timezone: now.zoneName!,
      local: target.toFormat("yyyy-MM-dd'T'HH:mm"),
      confidence: relation === "within" ? "medium" : "high",
      note: relation === "within" ? "latest time within the stated window" : undefined,
    };
  }

  const day = parseDay(lower, now);
  const time = parseTime(lower);

  if (day.status === "invalid" || time.status === "invalid") {
    const reasons = [day.status === "invalid" ? day.reason : null, time.status === "invalid" ? time.reason : null].filter(Boolean);
    return { kind: "needs_confirmation", reason: `not a valid date/time: ${reasons.join("; ")}`, suggestions: [] };
  }
  if (day.status === "absent" && time.status === "absent") {
    return { kind: "unresolved", reason: "the phrase is not a recognizable date or time" };
  }
  if (day.status === "valid" && day.confidence === "needs_confirmation") {
    return {
      kind: "needs_confirmation",
      reason: day.reason ?? "ambiguous day",
      suggestions: (day.alternatives ?? [day.date]).map((d) => d.toISODate()!),
    };
  }

  const relationNote = relation === "before" ? "due before this point" : relation === "after" ? "not before this point" : undefined;
  const reference = context.referenceDay ?? now;
  const baseDay = day.status === "valid" ? day.date : reference.startOf("day");

  if (time.status === "absent") {
    const dayPart = day as Extract<Component<DayPart>, { status: "valid" }>;
    const confidence = hasTimeOfDayHint(lower) ? worse(dayPart.confidence, "medium") : dayPart.confidence;
    return {
      kind: "date",
      date: baseDay.toISODate()!,
      confidence,
      note: [dayPart.note, hasTimeOfDayHint(lower) ? "time of day left open" : undefined, relationNote].filter(Boolean).join("; ") || undefined,
    };
  }

  if (time.confidence === "needs_confirmation" && time.alternatives) {
    return {
      kind: "needs_confirmation",
      reason: "the hour has no am/pm",
      suggestions: time.alternatives.map((alt) => baseDay.set({ hour: alt.hour, minute: alt.minute }).toISO()!),
    };
  }

  // Time without an explicit day: the reference day when given, else today
  // if still ahead, else tomorrow.
  let dayForTime = baseDay;
  let dayNote = day.status === "valid" ? day.note : undefined;
  if (day.status === "absent" && !context.referenceDay) {
    const candidate = now.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
    if (candidate <= now) {
      dayForTime = now.plus({ days: 1 }).startOf("day");
      dayNote = "assumed tomorrow because the time already passed today";
    }
  }
  const dayConfidence = day.status === "valid" ? day.confidence : ("medium" as Confidence);
  return buildInstant(
    dayForTime,
    time,
    worse(dayConfidence, time.confidence),
    zoneSpec,
    [dayNote, relationNote].filter(Boolean).join("; ") || undefined,
  );
}

// --- Ranges (finding 20) ---------------------------------------------------

export type TemporalRange =
  | { kind: "dates"; start: string; endInclusive: string }
  | { kind: "instants"; start: Extract<TemporalResolution, { kind: "instant" }>; end: Extract<TemporalResolution, { kind: "instant" }> }
  | null;

/**
 * "September 12 through September 14", "Sept 12–14", "9am–11am", "from 9 to
 * 11 on Friday". Returns null when the phrase is not a range.
 */
export function resolveTemporalRange(literal: string, context: TemporalContext): TemporalRange {
  const lower = literal.toLowerCase().replace(/\s+/g, " ").trim();
  const dayOnly = /^(.*?\b(?:\d{1,2}))\s*[–—-]\s*(\d{1,2})(?:st|nd|rd|th)?\b(.*)$/.exec(lower);
  if (dayOnly && !/\d{4}-\d{2}-\d{2}/.test(lower) && !/\d{1,2}:\d{2}|am|pm/.test(lower)) {
    const first = resolveTemporal(dayOnly[1] + dayOnly[3], "on", context);
    if (first.kind === "date") {
      const start = DateTime.fromISO(first.date);
      const end = start.set({ day: Number(dayOnly[2]) });
      if (end.isValid && end >= start) return { kind: "dates", start: first.date, endInclusive: end.toISODate()! };
    }
  }
  const split = lower.split(/\s+(?:through|thru|until|till|to)\s+|\s*[–—]\s*|(?<=[a-z0-9])\s*-\s*(?=\d)/);
  if (split.length !== 2) return null;
  const [a, b] = split.map((s) => s.replace(/^from\s+/, "").trim());
  const dayHint = parseDay(lower, context.now);
  const first = resolveTemporal(a, "on", context);
  if (first.kind === "date") {
    const second = resolveTemporal(b, "on", context);
    if (second.kind === "date" && second.date >= first.date) return { kind: "dates", start: first.date, endInclusive: second.date };
    return null;
  }
  if (first.kind === "instant") {
    const startDay = DateTime.fromISO(first.instant).setZone(first.timezone).startOf("day");
    const bWithDay = dayHint.status === "valid" && !parseDay(b, context.now).status.startsWith("valid") ? b : b;
    const second = resolveTemporal(bWithDay, "on", { ...context, referenceDay: startDay });
    if (second.kind === "instant" && Date.parse(second.instant) > Date.parse(first.instant)) {
      return { kind: "instants", start: first, end: second };
    }
  }
  return null;
}

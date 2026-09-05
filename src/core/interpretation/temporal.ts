/**
 * Deterministic temporal resolution (product-spec §8.1). The extraction model
 * supplies only a literal phrase, a relation, and an optional anchor; this
 * module is the sole authority that turns them into a calendar date or an
 * instant + IANA zone. It never silently makes a strong assumption:
 * ambiguous phrases return `needs_confirmation` with concrete suggestions,
 * and DST gaps/folds follow the spec policy exactly.
 */
import { DateTime } from "luxon";
import type { Confidence } from "@/core/domain/enums";

export type TemporalRelation = "on" | "before" | "after" | "within" | "duration_after";

export interface TemporalContext {
  /** Current instant, already expressed in the user's current timezone. */
  now: DateTime;
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

const DURATION_UNITS: Record<string, number> = {
  minute: 1, minutes: 1, min: 1, mins: 1,
  hour: 60, hours: 60, hr: 60, hrs: 60, h: 60,
  day: 1440, days: 1440,
  week: 10080, weeks: 10080,
};

function quantity(word: string): number | null {
  if (/^\d+(\.\d+)?$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

/** "two hours", "90 min", "half an hour", "a day" → minutes; null if none. */
export function parseDurationMinutes(text: string): number | null {
  const lower = text.toLowerCase();
  const half = /\bhalf\s+an?\s+(hour|day)\b/.exec(lower);
  if (half) return DURATION_UNITS[half[1]] / 2;
  const match =
    /\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple(?:\s+of)?|few)\s*(minutes?|mins?|hours?|hrs?|h|days?|weeks?)\b/.exec(
      lower,
    );
  if (!match) return null;
  const amount = quantity(match[1].replace(/\s+of$/, ""));
  const unit = DURATION_UNITS[match[2]];
  if (amount === null || !unit) return null;
  return Math.round(amount * unit);
}

interface TimePart {
  hour: number;
  minute: number;
  confidence: Confidence;
  /** Set when a bare hour is ambiguous; alternatives to offer. */
  alternatives?: Array<{ hour: number; minute: number }>;
}

function parseTime(lower: string): TimePart | null {
  if (/\bnoon\b/.test(lower)) return { hour: 12, minute: 0, confidence: "high" };
  if (/\bmidnight\b/.test(lower)) return { hour: 0, minute: 0, confidence: "high" };

  const clock = /\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?\b/.exec(lower);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2]);
    const meridiem = clock[3]?.replace(/\./g, "");
    if (hour > 23 || minute > 59) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return { hour, minute, confidence: "high" };
  }

  const withMeridiem = /\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/.exec(lower);
  if (withMeridiem) {
    let hour = Number(withMeridiem[1]);
    const meridiem = withMeridiem[2].replace(/\./g, "");
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return { hour, minute: 0, confidence: "high" };
  }

  const bare = /\b(?:at|around|about|@)\s*(\d{1,2})\b(?!\s*(?:am|pm|:|\/|-))/.exec(lower);
  if (bare) {
    const hour = Number(bare[1]);
    if (hour === 12) return { hour: 12, minute: 0, confidence: "medium" };
    if (hour >= 1 && hour <= 6) {
      // "at 5" is overwhelmingly 17:00 in planning talk; inferred, not certain.
      return { hour: hour + 12, minute: 0, confidence: "medium" };
    }
    if (hour >= 7 && hour <= 11) {
      return {
        hour,
        minute: 0,
        confidence: "needs_confirmation",
        alternatives: [
          { hour, minute: 0 },
          { hour: hour + 12, minute: 0 },
        ],
      };
    }
    if (hour >= 13 && hour <= 23) return { hour, minute: 0, confidence: "high" };
  }
  return null;
}

interface DayPart {
  date: DateTime;
  confidence: Confidence;
  note?: string;
  /** Vague window phrases: alternatives to confirm instead of the date. */
  alternatives?: DateTime[];
  reason?: string;
}

function upcomingWeekday(from: DateTime, weekday: number, allowToday: boolean): DateTime {
  let delta = (weekday - from.weekday + 7) % 7;
  if (delta === 0 && !allowToday) delta = 7;
  return from.plus({ days: delta }).startOf("day");
}

function parseDay(lower: string, now: DateTime): DayPart | null {
  const today = now.startOf("day");
  if (/\bday after tomorrow\b/.test(lower)) return { date: today.plus({ days: 2 }), confidence: "high" };
  if (/\btomorrow\b/.test(lower)) return { date: today.plus({ days: 1 }), confidence: "high" };
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(lower)) {
    return { date: today, confidence: "high" };
  }

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower);
  if (iso) {
    const date = DateTime.fromObject(
      { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) },
      { zone: now.zone },
    );
    return date.isValid ? { date, confidence: "high" } : null;
  }

  const monthDay =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(
      lower,
    ) ??
    // "6 September"
    (() => {
      const m =
        /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?(?:,?\s+(\d{4}))?\b/.exec(
          lower,
        );
      return m ? [m[0], m[2], m[1], m[3]] : null;
    })();
  if (monthDay) {
    const month = MONTHS[monthDay[1]];
    const day = Number(monthDay[2]);
    const explicitYear = monthDay[3] ? Number(monthDay[3]) : null;
    return resolveMonthDay(month, day, explicitYear, today);
  }

  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(lower);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null;
    return resolveMonthDay(Number(numeric[1]), Number(numeric[2]), year, today);
  }

  if (/\bnext weekend\b/.test(lower)) {
    const saturday = upcomingWeekday(today.plus({ weeks: 1 }).startOf("week"), 6, true);
    return {
      date: saturday,
      confidence: "needs_confirmation",
      alternatives: [saturday, saturday.plus({ days: 1 })],
      reason: "\"next weekend\" spans two days",
    };
  }
  if (/\bthis weekend\b|\bweekend\b/.test(lower)) {
    const saturday = upcomingWeekday(today, 6, true);
    return {
      date: saturday,
      confidence: "needs_confirmation",
      alternatives: [saturday, saturday.plus({ days: 1 })],
      reason: "\"this weekend\" spans two days",
    };
  }
  if (/\bnext week\b/.test(lower)) {
    const monday = today.plus({ weeks: 1 }).startOf("week");
    return {
      date: monday,
      confidence: "needs_confirmation",
      alternatives: [monday, monday.plus({ days: 4 })],
      reason: "\"next week\" is a window, not a day",
    };
  }
  if (/\bend of (the )?week\b/.test(lower)) {
    const friday = upcomingWeekday(today, 5, true);
    return {
      date: friday,
      confidence: "needs_confirmation",
      alternatives: [friday, friday.plus({ days: 2 })],
      reason: "\"end of week\" could mean Friday or Sunday",
    };
  }
  if (/\bend of (the )?month\b/.test(lower)) {
    const last = today.endOf("month").startOf("day");
    return { date: last, confidence: "needs_confirmation", alternatives: [last], reason: "\"end of month\" is approximate" };
  }

  const weekday = /\b(next|this|coming)?\s*(monday|mon|tuesday|tues?|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat|sunday|sun)\b/.exec(
    lower,
  );
  if (weekday) {
    const qualifier = weekday[1];
    const target = WEEKDAYS[weekday[2]];
    const plain = upcomingWeekday(today, target, false);
    if (qualifier === "next") {
      const nextWeek = today.plus({ weeks: 1 }).startOf("week").plus({ days: target - 1 });
      if (nextWeek.hasSame(plain, "day")) return { date: nextWeek, confidence: "high" };
      return {
        date: nextWeek,
        confidence: "needs_confirmation",
        alternatives: [plain, nextWeek],
        reason: `"next ${weekday[2]}" could mean either upcoming ${weekday[2]}`,
      };
    }
    if (today.weekday === target) {
      return {
        date: today,
        confidence: "needs_confirmation",
        alternatives: [today, today.plus({ weeks: 1 })],
        reason: `today is ${weekday[2]}; this could mean today or next week`,
      };
    }
    return { date: plain, confidence: "high" };
  }
  return null;
}

function resolveMonthDay(
  month: number,
  day: number,
  explicitYear: number | null,
  today: DateTime,
): DayPart | null {
  const year = explicitYear ?? today.year;
  let date = DateTime.fromObject({ year, month, day }, { zone: today.zone });
  if (!date.isValid) return null;
  if (explicitYear === null && date < today) {
    date = date.plus({ years: 1 });
    return { date, confidence: "medium", note: "assumed next year because the date already passed" };
  }
  return { date, confidence: "high" };
}

function hasTimeOfDayHint(lower: string): boolean {
  return /\b(morning|afternoon|evening|tonight|after work|after lunch|before work|first thing)\b/.test(lower);
}

function roundTrips(dt: DateTime, hour: number, minute: number): boolean {
  return dt.isValid && dt.hour === hour && dt.minute === minute;
}

/** Applies the DST policy from spec §8.1 to a local wall-clock request. */
function buildInstant(
  day: DateTime,
  time: TimePart,
  confidence: Confidence,
  note?: string,
): TemporalResolution {
  const zone = day.zoneName!;
  const requested = day.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
  if (!roundTrips(requested, time.hour, time.minute)) {
    // Spring-forward gap: suggest the first valid local time after it. Step
    // through plain wall-clock minutes (UTC arithmetic knows no DST) and take
    // the first that exists in the zone.
    const wall = DateTime.utc(day.year, day.month, day.day, time.hour, time.minute);
    for (let m = 1; m <= 180; m++) {
      const w = wall.plus({ minutes: m });
      const probe = DateTime.fromObject(
        { year: w.year, month: w.month, day: w.day, hour: w.hour, minute: w.minute },
        { zone },
      );
      if (roundTrips(probe, w.hour, w.minute)) {
        return {
          kind: "needs_confirmation",
          reason: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")} does not exist on ${day.toISODate()} in ${zone} (clocks spring forward)`,
          suggestions: [probe.toISO()!],
        };
      }
    }
    return { kind: "unresolved", reason: "could not find a valid local time after the DST gap" };
  }
  const later = requested.plus({ hours: 1 });
  const earlier = requested.minus({ hours: 1 });
  const twin = [later, earlier].find(
    (alt) => alt.hour === requested.hour && alt.minute === requested.minute && alt.day === requested.day,
  );
  if (twin) {
    const pair = [requested, twin].sort((a, b) => a.toMillis() - b.toMillis());
    return {
      kind: "needs_confirmation",
      reason: `${requested.toFormat("HH:mm")} occurs twice on ${day.toISODate()} in ${zone} (clocks fall back)`,
      suggestions: pair.map((d) => d.toISO()!),
    };
  }
  return {
    kind: "instant",
    instant: requested.toUTC().toISO()!,
    timezone: zone,
    local: requested.toFormat("yyyy-MM-dd'T'HH:mm"),
    confidence,
    note,
  };
}

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

/**
 * Deterministic scan for temporal cues inside free text — used to recover
 * dates a model left in title/context instead of temporal_expressions. The
 * returned literal is exactly as written; resolution happens separately.
 */
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

const worse = (a: Confidence, b: Confidence): Confidence => {
  const rank = { high: 0, medium: 1, needs_confirmation: 2 };
  return rank[a] >= rank[b] ? a : b;
};

export function resolveTemporal(
  literal: string,
  relation: TemporalRelation,
  context: TemporalContext,
): TemporalResolution {
  const now = context.now;
  const zone = now.zoneName!;
  const lower = literal.toLowerCase().replace(/\s+/g, " ").trim();

  // Relative-to-now durations: "in two hours", "within two weeks".
  const durationMinutes = parseDurationMinutes(lower);
  const relativeNow = relation === "duration_after" || relation === "within" || /^\s*in\b/.test(lower);
  if (relativeNow && durationMinutes !== null) {
    const target = now.plus({ minutes: durationMinutes });
    if (durationMinutes >= 1440 || relation === "within") {
      return {
        kind: "date",
        date: target.toISODate()!,
        confidence: relation === "within" ? "medium" : "high",
        note: relation === "within" ? "latest date within the stated window" : undefined,
      };
    }
    return {
      kind: "instant",
      instant: target.toUTC().toISO()!,
      timezone: zone,
      local: target.toFormat("yyyy-MM-dd'T'HH:mm"),
      confidence: "high",
    };
  }

  const day = parseDay(lower, now);
  const time = parseTime(lower);

  if (!day && !time) {
    return { kind: "unresolved", reason: `could not interpret "${literal}"` };
  }

  if (day && day.confidence === "needs_confirmation") {
    return {
      kind: "needs_confirmation",
      reason: day.reason ?? "ambiguous day",
      suggestions: (day.alternatives ?? [day.date]).map((d) => d.toISODate()!),
    };
  }

  const baseDay = day?.date ?? now.startOf("day");
  const relationNote =
    relation === "before" ? "due before this point" : relation === "after" ? "not before this point" : undefined;

  if (!time) {
    const confidence = hasTimeOfDayHint(lower) ? worse(day!.confidence, "medium") : day!.confidence;
    return {
      kind: "date",
      date: baseDay.toISODate()!,
      confidence,
      note: [day!.note, hasTimeOfDayHint(lower) ? "time of day left open" : undefined, relationNote]
        .filter(Boolean)
        .join("; ") || undefined,
    };
  }

  if (time.confidence === "needs_confirmation" && time.alternatives) {
    return {
      kind: "needs_confirmation",
      reason: `"${literal}" has no am/pm`,
      suggestions: time.alternatives.map((alt) =>
        baseDay.set({ hour: alt.hour, minute: alt.minute }).toISO()!,
      ),
    };
  }

  // Time without an explicit day: today if still ahead, else tomorrow.
  let dayForTime = baseDay;
  let dayNote = day?.note;
  if (!day) {
    const candidate = now.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
    if (candidate <= now) {
      dayForTime = now.plus({ days: 1 }).startOf("day");
      dayNote = "assumed tomorrow because the time already passed today";
    }
  }
  const confidence = worse(day?.confidence ?? "medium", time.confidence);
  return buildInstant(
    dayForTime,
    time,
    confidence,
    [dayNote, relationNote].filter(Boolean).join("; ") || undefined,
  );
}

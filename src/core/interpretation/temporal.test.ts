/**
 * Temporal resolution table (plan test list B + review findings 10-13):
 * relative days, weekdays with qualifiers, vague windows, explicit dates,
 * times with/without meridiem, elapsed vs calendar durations, anchors,
 * invalid components, explicit zones/offsets, and DST gaps/folds detected by
 * real offsets (including a 30-minute transition).
 */
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { detectTemporalPhrases, parseDurationMinutes, resolveTemporal, resolveTemporalRange, zoneSpecAfter, zoneSpecIn } from "./temporal";

// Tuesday 2026-09-01 09:00 in New York (EDT, UTC-4).
const now = DateTime.fromISO("2026-09-01T09:00:00", { zone: "America/New_York" });
const ctx = { now };
const on = (literal: string) => resolveTemporal(literal, "on", ctx);

describe("relative days and weekdays", () => {
  it("resolves tomorrow/today and keeps a vague time of day open", () => {
    expect(on("tomorrow")).toMatchObject({ kind: "date", date: "2026-09-02", confidence: "high" });
    expect(on("today")).toMatchObject({ kind: "date", date: "2026-09-01" });
    expect(on("tomorrow afternoon")).toMatchObject({ kind: "date", date: "2026-09-02", confidence: "medium" });
    expect(on("tonight")).toMatchObject({ kind: "date", date: "2026-09-01", confidence: "medium" });
  });

  it("resolves a plain weekday to the upcoming one, but asks when it is today", () => {
    expect(on("Friday")).toMatchObject({ kind: "date", date: "2026-09-04", confidence: "high" });
    expect(on("Tuesday")).toMatchObject({ kind: "needs_confirmation", suggestions: ["2026-09-01", "2026-09-08"] });
  });

  it("asks about 'next Friday' when two readings exist, resolves when they agree", () => {
    expect(on("next Friday")).toMatchObject({ kind: "needs_confirmation", suggestions: ["2026-09-04", "2026-09-11"] });
    const saturday = DateTime.fromISO("2026-09-05T10:00:00", { zone: "America/New_York" });
    expect(resolveTemporal("next Friday", "on", { now: saturday })).toMatchObject({ kind: "date", date: "2026-09-11", confidence: "high" });
  });

  it("treats windows as questions with concrete suggestions", () => {
    expect(on("this weekend")).toMatchObject({ kind: "needs_confirmation", suggestions: ["2026-09-05", "2026-09-06"] });
    expect(on("next week")).toMatchObject({ kind: "needs_confirmation", suggestions: ["2026-09-07", "2026-09-11"] });
    expect(on("end of the week")).toMatchObject({ kind: "needs_confirmation" });
  });
});

describe("explicit dates", () => {
  it("parses month names, numeric, and ISO forms", () => {
    expect(on("Sep 6")).toMatchObject({ kind: "date", date: "2026-09-06", confidence: "high" });
    expect(on("September 6, 2026")).toMatchObject({ kind: "date", date: "2026-09-06" });
    expect(on("6 September")).toMatchObject({ kind: "date", date: "2026-09-06" });
    expect(on("9/6")).toMatchObject({ kind: "date", date: "2026-09-06" });
    expect(on("2026-09-06")).toMatchObject({ kind: "date", date: "2026-09-06" });
  });

  it("assumes next year for a month/day that already passed, at medium confidence", () => {
    expect(on("Aug 15")).toMatchObject({ kind: "date", date: "2027-08-15", confidence: "medium" });
  });
});

describe("invalid components block resolution (finding 13)", () => {
  it("an invalid date with a valid time does not fall back to today", () => {
    const result = on("February 30 at 9am");
    expect(result.kind).toBe("needs_confirmation");
    if (result.kind === "needs_confirmation") expect(result.reason).toMatch(/not a valid date/);
  });

  it("a valid day with an invalid time does not become a date-only value", () => {
    const result = on("tomorrow at 25:00");
    expect(result.kind).toBe("needs_confirmation");
    if (result.kind === "needs_confirmation") expect(result.reason).toMatch(/25:00/);
    expect(on("Feb 30")).toMatchObject({ kind: "needs_confirmation" });
    expect(on("13pm")).toMatchObject({ kind: "needs_confirmation" });
  });
});

describe("times", () => {
  it("builds an instant in the user's zone for explicit times", () => {
    expect(on("tomorrow at 5pm")).toMatchObject({
      kind: "instant",
      instant: "2026-09-02T21:00:00.000Z",
      timezone: "America/New_York",
      local: "2026-09-02T17:00",
      confidence: "high",
    });
    expect(on("Friday 17:30")).toMatchObject({ kind: "instant", local: "2026-09-04T17:30" });
  });

  it("infers pm for small bare hours, asks for ambiguous ones", () => {
    expect(on("at 5")).toMatchObject({ kind: "instant", local: "2026-09-01T17:00", confidence: "medium" });
    const nine = on("at 9");
    expect(nine.kind).toBe("needs_confirmation");
    if (nine.kind === "needs_confirmation") {
      expect(nine.suggestions.some((s) => s.startsWith("2026-09-01T09:00"))).toBe(true);
      expect(nine.suggestions.some((s) => s.startsWith("2026-09-01T21:00"))).toBe(true);
    }
  });

  it("moves a time that already passed today to tomorrow, and says so", () => {
    expect(on("at 8am")).toMatchObject({ kind: "instant", local: "2026-09-02T08:00", note: expect.stringContaining("tomorrow") });
  });

  it("uses the reference day for a time-only phrase when one is given (event ends)", () => {
    const referenceDay = DateTime.fromISO("2026-09-12T00:00:00", { zone: "America/New_York" });
    expect(resolveTemporal("11am", "on", { now, referenceDay })).toMatchObject({ kind: "instant", local: "2026-09-12T11:00" });
  });
});

describe("explicit zones and offsets (finding 11)", () => {
  it("honors an IANA zone in the text and keeps it", () => {
    expect(on("September 12 at 9am Europe/London")).toMatchObject({
      kind: "instant",
      instant: "2026-09-12T08:00:00.000Z",
      timezone: "Europe/London",
      local: "2026-09-12T09:00",
      confidence: "high",
    });
  });

  it("an explicit offset selects the occurrence in a DST fold", () => {
    expect(on("November 1, 2026 at 1:30am, UTC-05:00")).toMatchObject({
      kind: "instant",
      instant: "2026-11-01T06:30:00.000Z",
      timezone: "America/New_York",
    });
    expect(on("November 1, 2026 at 1:30am UTC−04:00")).toMatchObject({ kind: "instant", instant: "2026-11-01T05:30:00.000Z" });
  });

  it("a contradictory offset asks instead of guessing", () => {
    expect(on("November 1, 2026 at 1:30am UTC+09:00")).toMatchObject({ kind: "needs_confirmation" });
  });
});

describe("durations and anchors (finding 12)", () => {
  it("elapsed durations keep sub-day precision, including within", () => {
    expect(resolveTemporal("in two hours", "duration_after", ctx)).toMatchObject({ kind: "instant", instant: "2026-09-01T15:00:00.000Z", confidence: "high" });
    expect(resolveTemporal("within two hours", "within", ctx)).toMatchObject({ kind: "instant", local: "2026-09-01T11:00", confidence: "medium" });
  });

  it("calendar durations follow the wall clock across a fall-back day", () => {
    const halfPastMidnight = DateTime.fromISO("2026-11-01T00:30:00", { zone: "America/New_York" });
    expect(resolveTemporal("in one day", "duration_after", { now: halfPastMidnight })).toMatchObject({ kind: "date", date: "2026-11-02" });
    // "calendar" spelled out (eval-v2 case 16) is the same wall-clock day count.
    expect(resolveTemporal("in one calendar day", "within", { now: halfPastMidnight })).toMatchObject({ kind: "date", date: "2026-11-02" });
    expect(resolveTemporal("in three days", "duration_after", ctx)).toMatchObject({ kind: "date", date: "2026-09-04" });
    expect(resolveTemporal("within two weeks", "within", ctx)).toMatchObject({ kind: "date", date: "2026-09-15", confidence: "medium" });
  });

  it("finds a zone written right after a phrase, and resolves with it (eval-v2 cases 12 and 14)", () => {
    const fallBack = "Appointment November 1, 2026 at 1:30am, UTC−05:00.";
    expect(zoneSpecAfter(fallBack, fallBack.indexOf(", UTC"))).toBe("UTC−05:00");
    const london = "Design review September 12, 2026, 9am Europe/London, ending 10am there.";
    expect(zoneSpecAfter(london, london.indexOf(" Europe"))).toBe("Europe/London");
    expect(zoneSpecAfter("call at 5pm tomorrow, then rest", 11)).toBeNull();
    expect(zoneSpecAfter("meet at Boston/Cambridge", 4)).toBeNull();
    expect(zoneSpecIn("9am Europe/London")).toBe("Europe/London");
    expect(zoneSpecIn("9am tomorrow")).toBeNull();
    expect(resolveTemporal("November 1, 2026 at 1:30am UTC−05:00", "on", ctx)).toMatchObject({
      kind: "instant",
      instant: "2026-11-01T06:30:00.000Z",
      timezone: "America/New_York",
    });
  });

  it("a duration relative to an unidentified anchor is never resolved from now", () => {
    const result = resolveTemporal("two hours after the launch meeting", "duration_after", ctx);
    expect(result.kind).toBe("needs_confirmation");
    if (result.kind === "needs_confirmation") expect(result.reason).toMatch(/event that could not be identified/);
  });

  it("a validated anchor resolves relative to the anchor", () => {
    const anchor = DateTime.fromISO("2026-09-10T15:00:00", { zone: "America/New_York" });
    expect(resolveTemporal("two hours after the launch meeting", "duration_after", { now, anchor: { instant: anchor } })).toMatchObject({
      kind: "instant",
      local: "2026-09-10T17:00",
    });
    expect(resolveTemporal("a few days before the deadline", "before", { now, anchor: { date: "2026-09-20" } })).toMatchObject({
      kind: "date",
      date: "2026-09-17",
    });
  });

  it("parses durations in minutes", () => {
    expect(parseDurationMinutes("for two hours")).toBe(120);
    expect(parseDurationMinutes("90 min")).toBe(90);
    expect(parseDurationMinutes("half an hour")).toBe(30);
    expect(parseDurationMinutes("a day")).toBe(1440);
    expect(parseDurationMinutes("soon")).toBeNull();
  });

  it("returns unresolved for text it cannot interpret", () => {
    expect(on("whenever")).toMatchObject({ kind: "unresolved" });
  });
});

describe("detectTemporalPhrases", () => {
  it("finds day, date, time, and duration cues with their relations", () => {
    const text = "finish the deck by Friday, call at 3pm, review Sept 5 at 10, reply in two hours";
    const phrases = detectTemporalPhrases(text);
    expect(phrases.map((p) => [p.literal, p.relation])).toEqual([
      ["by Friday", "before"],
      ["at 3pm", "on"],
      ["Sept 5 at 10", "on"],
      ["in two hours", "duration_after"],
    ]);
    expect(text.slice(phrases[0].start, phrases[0].end)).toBe("by Friday");
  });

  it("returns nothing for text without temporal cues", () => {
    expect(detectTemporalPhrases("order printer ink")).toEqual([]);
  });
});

describe("DST policy (spec §8.1, finding 10)", () => {
  it("a nonexistent spring-forward time needs confirmation with the first valid time after the gap", () => {
    const result = on("March 8, 2026 at 2:30am");
    expect(result.kind).toBe("needs_confirmation");
    if (result.kind === "needs_confirmation") {
      expect(result.reason).toMatch(/does not exist/);
      expect(result.suggestions).toEqual(["2026-03-08T03:00:00.000-04:00"]);
    }
  });

  it("a duplicated fall-back time needs confirmation with both offsets", () => {
    const result = on("November 1, 2026 at 1:30am");
    expect(result.kind).toBe("needs_confirmation");
    if (result.kind === "needs_confirmation") {
      expect(result.reason).toMatch(/occurs 2 times/);
      expect(result.suggestions).toEqual(["2026-11-01T01:30:00.000-04:00", "2026-11-01T01:30:00.000-05:00"]);
    }
  });

  it("detects a 30-minute fold (Lord Howe Island) that a one-hour assumption misses", () => {
    const lordHowe = DateTime.fromISO("2026-03-01T09:00:00", { zone: "Australia/Lord_Howe" });
    const result = resolveTemporal("April 5, 2026 at 1:45am", "on", { now: lordHowe });
    expect(result.kind).toBe("needs_confirmation");
    if (result.kind === "needs_confirmation") {
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0]).toContain("+11:00");
      expect(result.suggestions[1]).toContain("+10:30");
    }
  });

  it("an ordinary time on a DST day resolves normally", () => {
    expect(on("March 8, 2026 at 5pm")).toMatchObject({ kind: "instant", local: "2026-03-08T17:00" });
  });
});

describe("resolveTemporalRange (finding 20)", () => {
  it("parses multi-day inclusive ranges", () => {
    expect(resolveTemporalRange("September 12 through September 14", ctx)).toEqual({ kind: "dates", start: "2026-09-12", endInclusive: "2026-09-14" });
    expect(resolveTemporalRange("Sept 12–14", ctx)).toEqual({ kind: "dates", start: "2026-09-12", endInclusive: "2026-09-14" });
  });

  it("parses same-day time ranges with the end on the start's day", () => {
    const range = resolveTemporalRange("September 12, 9am–11am", ctx);
    expect(range?.kind).toBe("instants");
    if (range?.kind === "instants") {
      expect(range.start.local).toBe("2026-09-12T09:00");
      expect(range.end.local).toBe("2026-09-12T11:00");
    }
  });

  it("returns null for non-ranges", () => {
    expect(resolveTemporalRange("tomorrow at 5pm", ctx)).toBeNull();
    expect(resolveTemporalRange("2026-09-06", ctx)).toBeNull();
  });
});

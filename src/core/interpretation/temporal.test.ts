/**
 * Temporal resolution table (plan test list B): relative days, weekdays with
 * qualifiers, vague windows, explicit dates, times with/without meridiem,
 * durations, and the §8.1 DST gap/fold policy. Never a silent assumption.
 */
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { detectTemporalPhrases, parseDurationMinutes, resolveTemporal } from "./temporal";

// Tuesday 2026-09-01 09:00 in New York (EDT, UTC-4).
const now = DateTime.fromISO("2026-09-01T09:00:00", { zone: "America/New_York" });
const ctx = { now };
const on = (literal: string) => resolveTemporal(literal, "on", ctx);

describe("relative days and weekdays", () => {
  it("resolves tomorrow/today and keeps a vague time of day open", () => {
    expect(on("tomorrow")).toMatchObject({ kind: "date", date: "2026-09-02", confidence: "high" });
    expect(on("today")).toMatchObject({ kind: "date", date: "2026-09-01" });
    expect(on("tomorrow afternoon")).toMatchObject({
      kind: "date",
      date: "2026-09-02",
      confidence: "medium",
    });
    expect(on("tonight")).toMatchObject({ kind: "date", date: "2026-09-01", confidence: "medium" });
  });

  it("resolves a plain weekday to the upcoming one, but asks when it is today", () => {
    expect(on("Friday")).toMatchObject({ kind: "date", date: "2026-09-04", confidence: "high" });
    expect(on("Tuesday")).toMatchObject({
      kind: "needs_confirmation",
      suggestions: ["2026-09-01", "2026-09-08"],
    });
  });

  it("asks about 'next Friday' when two readings exist, resolves when they agree", () => {
    expect(on("next Friday")).toMatchObject({
      kind: "needs_confirmation",
      suggestions: ["2026-09-04", "2026-09-11"],
    });
    const saturday = DateTime.fromISO("2026-09-05T10:00:00", { zone: "America/New_York" });
    expect(resolveTemporal("next Friday", "on", { now: saturday })).toMatchObject({
      kind: "date",
      date: "2026-09-11",
      confidence: "high",
    });
  });

  it("treats windows as questions with concrete suggestions", () => {
    expect(on("this weekend")).toMatchObject({
      kind: "needs_confirmation",
      suggestions: ["2026-09-05", "2026-09-06"],
    });
    expect(on("next week")).toMatchObject({
      kind: "needs_confirmation",
      suggestions: ["2026-09-07", "2026-09-11"],
    });
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

  it("rejects impossible dates", () => {
    expect(on("Feb 30")).toMatchObject({ kind: "unresolved" });
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
    expect(on("at 8am")).toMatchObject({
      kind: "instant",
      local: "2026-09-02T08:00",
      note: expect.stringContaining("tomorrow"),
    });
  });
});

describe("durations and windows", () => {
  it("resolves duration_after to now + duration", () => {
    expect(resolveTemporal("in two hours", "duration_after", ctx)).toMatchObject({
      kind: "instant",
      instant: "2026-09-01T15:00:00.000Z",
      confidence: "high",
    });
    expect(resolveTemporal("in three days", "duration_after", ctx)).toMatchObject({
      kind: "date",
      date: "2026-09-04",
    });
  });

  it("resolves 'within' to the latest date in the window", () => {
    expect(resolveTemporal("within two weeks", "within", ctx)).toMatchObject({
      kind: "date",
      date: "2026-09-15",
      confidence: "medium",
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

describe("DST policy (spec §8.1)", () => {
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
      expect(result.reason).toMatch(/occurs twice/);
      expect(result.suggestions).toEqual([
        "2026-11-01T01:30:00.000-04:00",
        "2026-11-01T01:30:00.000-05:00",
      ]);
    }
  });

  it("an ordinary time on a DST day resolves normally", () => {
    expect(on("March 8, 2026 at 5pm")).toMatchObject({ kind: "instant", local: "2026-03-08T17:00" });
  });
});

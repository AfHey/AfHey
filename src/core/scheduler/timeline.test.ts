/**
 * Suite G — timeline and free time (Phase 2 plan Section 6): interval
 * algebra, local windows across DST days (23 h / 25 h / Lord Howe 30-minute
 * shift), protected windows, buffers, grid snapping, clipping to now, and
 * zone changes.
 */
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  daysCovering,
  dayStart,
  freeOnDay,
  freeTime,
  getFreeTime,
  intersect,
  localWindowOnDay,
  normalize,
  pad,
  snapToGrid,
  subtract,
  totalMinutes,
  type DayTimelineInputs,
} from "./timeline";

const NY = "America/New_York";
const ms = (iso: string) => DateTime.fromISO(iso).toMillis();
const iv = (a: string, b: string) => ({ start: ms(a), end: ms(b) });
const base: DayTimelineInputs = { zone: NY, availability: [], protectedWindows: [], busy: [], bufferMinutes: 0 };

describe("interval algebra", () => {
  it("normalizes, subtracts, and intersects half-open intervals", () => {
    expect(normalize([iv("2026-09-07T10:00Z", "2026-09-07T11:00Z"), iv("2026-09-07T10:30Z", "2026-09-07T12:00Z"), iv("2026-09-07T12:00Z", "2026-09-07T12:30Z")]))
      .toEqual([iv("2026-09-07T10:00Z", "2026-09-07T12:30Z")]);
    expect(subtract([iv("2026-09-07T10:00Z", "2026-09-07T14:00Z")], [iv("2026-09-07T11:00Z", "2026-09-07T12:00Z")]))
      .toEqual([iv("2026-09-07T10:00Z", "2026-09-07T11:00Z"), iv("2026-09-07T12:00Z", "2026-09-07T14:00Z")]);
    expect(intersect([iv("2026-09-07T10:00Z", "2026-09-07T12:00Z")], [iv("2026-09-07T11:00Z", "2026-09-07T13:00Z")]))
      .toEqual([iv("2026-09-07T11:00Z", "2026-09-07T12:00Z")]);
    expect(totalMinutes([iv("2026-09-07T10:00Z", "2026-09-07T10:45Z"), iv("2026-09-07T10:30Z", "2026-09-07T11:00Z")])).toBe(60);
    expect(pad([iv("2026-09-07T10:00Z", "2026-09-07T11:00Z")], 10)).toEqual([iv("2026-09-07T09:50Z", "2026-09-07T11:10Z")]);
  });

  it("snaps starts up and ends down to the 5-minute grid and drops slivers", () => {
    expect(snapToGrid([iv("2026-09-07T10:03Z", "2026-09-07T10:59Z")])).toEqual([iv("2026-09-07T10:05Z", "2026-09-07T10:55Z")]);
    expect(snapToGrid([iv("2026-09-07T10:03Z", "2026-09-07T10:06Z")])).toEqual([]);
  });
});

describe("local windows across DST", () => {
  it("converts a normal evening window to instants in the user's zone", () => {
    const w = localWindowOnDay(dayStart("2026-09-07", NY), "17:30", "21:30")!;
    expect(DateTime.fromMillis(w.start).toUTC().toISO()).toBe("2026-09-07T21:30:00.000Z");
    expect(DateTime.fromMillis(w.end).toUTC().toISO()).toBe("2026-09-08T01:30:00.000Z");
  });

  it("a spring-forward day has 23 hours and a fall-back day 25", () => {
    const spring = localWindowOnDay(dayStart("2026-03-08", NY), "00:00", "23:59")!;
    const fall = localWindowOnDay(dayStart("2026-11-01", NY), "00:00", "23:59")!;
    expect(Math.round((spring.end - spring.start) / 60_000)).toBe(23 * 60 - 1);
    expect(Math.round((fall.end - fall.start) / 60_000)).toBe(25 * 60 - 1);
  });

  it("honors Lord Howe Island's 30-minute transition", () => {
    const lh = "Australia/Lord_Howe";
    const fold = localWindowOnDay(dayStart("2026-04-05", lh), "00:00", "06:00")!; // clocks go back 30 min
    expect((fold.end - fold.start) / 60_000).toBe(6 * 60 + 30);
    const gap = localWindowOnDay(dayStart("2026-10-04", lh), "00:00", "06:00")!; // clocks go forward 30 min
    expect((gap.end - gap.start) / 60_000).toBe(6 * 60 - 30);
  });

  it("skips nonexistent local times instead of lengthening a window", () => {
    // 02:00–02:30 does not exist on 2026-03-08 in New York: nothing remains.
    expect(localWindowOnDay(dayStart("2026-03-08", NY), "02:00", "02:30")).toBeNull();
    // 01:30–02:30: only 01:30–02:00 EST is real (30 minutes), ending at the jump.
    const partial = localWindowOnDay(dayStart("2026-03-08", NY), "01:30", "02:30")!;
    expect((partial.end - partial.start) / 60_000).toBe(30);
    expect(DateTime.fromMillis(partial.end).toUTC().toISO()).toBe("2026-03-08T07:00:00.000Z");
    // A window spanning the gap loses exactly the missing hour.
    const spanning = localWindowOnDay(dayStart("2026-03-08", NY), "01:00", "04:00")!;
    expect((spanning.end - spanning.start) / 60_000).toBe(120);
  });
});

describe("free time on a day", () => {
  const weekdays: DayTimelineInputs["availability"] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "17:30", endTime: "21:30" }));

  it("applies availability by weekday only", () => {
    expect(freeOnDay("2026-09-07", { ...base, availability: weekdays })).toEqual([iv("2026-09-07T21:30Z", "2026-09-08T01:30Z")]); // Monday
    expect(freeOnDay("2026-09-06", { ...base, availability: weekdays })).toEqual([]); // Sunday
  });

  it("subtracts weekly and one-off protected windows", () => {
    const inputs: DayTimelineInputs = {
      ...base,
      availability: [{ weekday: null, startTime: "08:00", endTime: "20:00" }],
      protectedWindows: [
        { recurrence: "weekly", weekday: 7, onDate: null, startTime: "08:00", endTime: "20:00" },
        { recurrence: "once", weekday: null, onDate: "2026-09-08", startTime: "12:00", endTime: "13:00" },
      ],
    };
    expect(freeOnDay("2026-09-06", inputs)).toEqual([]); // Sunday, protected all day
    expect(freeOnDay("2026-09-08", inputs)).toEqual([iv("2026-09-08T12:00Z", "2026-09-08T16:00Z"), iv("2026-09-08T17:00Z", "2026-09-09T00:00Z")]);
    expect(freeOnDay("2026-09-09", inputs)).toEqual([iv("2026-09-09T12:00Z", "2026-09-10T00:00Z")]);
  });

  it("removes busy items with buffers on both sides and merges adjacent ones", () => {
    const inputs: DayTimelineInputs = {
      ...base,
      availability: [{ weekday: null, startTime: "08:00", endTime: "12:00" }],
      busy: [iv("2026-09-07T13:00Z", "2026-09-07T13:30Z"), iv("2026-09-07T13:30Z", "2026-09-07T14:00Z")], // 09:00–10:00 New York
      bufferMinutes: 10,
    };
    expect(freeOnDay("2026-09-07", inputs)).toEqual([iv("2026-09-07T12:00Z", "2026-09-07T12:50Z"), iv("2026-09-07T14:10Z", "2026-09-07T16:00Z")]);
  });

  it("clips to the requested range so the past is never offered, and filters by minimum length", () => {
    const inputs: DayTimelineInputs = { ...base, availability: weekdays };
    const now = ms("2026-09-07T22:00Z"); // 18:00 New York on Monday
    const free = freeTime({ start: now, end: ms("2026-09-09T04:00Z") }, inputs);
    expect(free).toEqual([iv("2026-09-07T22:00Z", "2026-09-08T01:30Z"), iv("2026-09-08T21:30Z", "2026-09-09T01:30Z")]);
    expect(getFreeTime({ start: now, end: ms("2026-09-08T01:00Z") }, inputs, 240)).toEqual([]);
    expect(getFreeTime({ start: now, end: ms("2026-09-08T01:00Z") }, inputs, 180)).toEqual([iv("2026-09-07T22:00Z", "2026-09-08T01:00Z")]);
  });

  it("follows the user's current zone", () => {
    const london = freeOnDay("2026-09-07", { ...base, zone: "Europe/London", availability: weekdays });
    expect(london).toEqual([iv("2026-09-07T16:30Z", "2026-09-07T20:30Z")]);
    expect(daysCovering(ms("2026-09-07T23:00Z"), ms("2026-09-08T05:00Z"), NY)).toEqual(["2026-09-07", "2026-09-08"]);
  });

  it("is deterministic: the same inputs give the same output", () => {
    const inputs: DayTimelineInputs = {
      ...base,
      availability: [{ weekday: null, startTime: "07:00", endTime: "22:00" }],
      busy: [iv("2026-09-07T15:00Z", "2026-09-07T16:00Z")],
      bufferMinutes: 5,
    };
    expect(freeOnDay("2026-09-07", inputs)).toEqual(freeOnDay("2026-09-07", { ...inputs, busy: [...inputs.busy].reverse() }));
  });
});

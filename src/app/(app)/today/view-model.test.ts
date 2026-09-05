import { describe, expect, it } from "vitest";
import { formatMinutes, groupByBand, scheduledMinutesAhead, type TodayTaskDto } from "./view-model";

const task = (id: string, band: TodayTaskDto["band"]): TodayTaskDto => ({
  id,
  title: id,
  band,
  projectName: null,
  deadlineLabel: null,
  overdue: false,
  remainingEstimateMinutes: null,
  feasibility: null,
  shortfallMinutes: 0,
  hasBlockToday: false,
});

describe("Today view-model", () => {
  it("groups tasks into the spec's three bands in order", () => {
    const groups = groupByBand([task("a", "could"), task("b", "must"), task("c", "should"), task("d", "must")]);
    expect(groups.map((g) => [g.label, g.items.map((t) => t.id)])).toEqual([
      ["Must do", ["b", "d"]],
      ["Should do", ["c"]],
      ["Could do", ["a"]],
    ]);
  });

  it("counts only the part of planned or running blocks still ahead", () => {
    const now = "2026-09-07T22:00:00.000Z"; // 18:00 New York
    const blocks = [
      { start: "2026-09-07T21:30:00.000Z", end: "2026-09-07T22:30:00.000Z", state: "planned" as const }, // 30 ahead
      { start: "2026-09-07T23:00:00.000Z", end: "2026-09-08T00:00:00.000Z", state: "in_progress" as const }, // 60
      { start: "2026-09-07T12:00:00.000Z", end: "2026-09-07T13:00:00.000Z", state: "completed" as const }, // ignored
      { start: "2026-09-08T00:00:00.000Z", end: "2026-09-08T01:00:00.000Z", state: "cancelled" as const }, // ignored
    ];
    expect(scheduledMinutesAhead(blocks, now)).toBe(90);
  });

  it("formats minutes for humans", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(150)).toBe("2 h 30 min");
  });
});

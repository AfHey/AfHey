/**
 * Suite H — placement engine (docs/phase-2-plan.md Section 6): ordering,
 * splitting, block bounds, the deep-work cap, preferred-window scoring,
 * job-time policy, earliest start, hard versus soft deadlines, no overlaps,
 * kept blocks reducing remaining work, the diff against re-plannable blocks,
 * and determinism.
 */
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { plan, type PlanBlock, type PlanContext, type PlanTask } from "./plan";
import { normalize, pad, type Interval } from "./timeline";

const NY = "America/New_York";
const at = (date: string, time: string) => DateTime.fromISO(`${date}T${time}:00`, { zone: NY }).toMillis();
const day = (date: string): Interval => ({ start: at(date, "00:00"), end: DateTime.fromISO(date, { zone: NY }).plus({ days: 1 }).startOf("day").toMillis() });
const MON = "2026-09-07";
const TUE = "2026-09-08";
const local = (ms: number) => DateTime.fromMillis(ms, { zone: NY }).toFormat("ccc HH:mm");
const span = (p: { start: number; end: number }) => `${local(p.start)}–${local(p.end)}`;

const weekdays = [1, 2, 3, 4, 5];
const baseContext: PlanContext = {
  now: at("2026-09-06", "18:00"), // Sunday evening
  zone: NY,
  range: day(MON),
  preferences: { minBlockMinutes: 25, maxBlockMinutes: 120, bufferMinutes: 10, dailyDeepWorkCapMinutes: 240, jobTimePolicy: "work_related_only" },
  availability: [
    ...weekdays.map((weekday) => ({ weekday, startTime: "17:30", endTime: "21:30", kind: "general" as const })),
    ...weekdays.map((weekday) => ({ weekday, startTime: "08:00", endTime: "16:00", kind: "job" as const })),
  ],
  protectedWindows: [],
  preferredWindows: [
    { weekday: null, startTime: "18:00", endTime: "20:00", workType: "deep" },
    { weekday: null, startTime: "20:00", endTime: "22:00", workType: "study" },
  ],
  busy: [],
  keptBlocks: [],
  replannable: [],
  tasks: [],
};

function task(id: string, patch: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: id,
    remainingMinutes: 60,
    isSplittable: false,
    workType: "shallow",
    domain: "personal",
    deadlineAt: null,
    deadlineType: null,
    earliestStart: null,
    preferredWindow: null,
    effectivePriority: "should",
    score: 50,
    createdAt: at("2026-09-01", "09:00"),
    ...patch,
  };
}

function block(id: string, taskId: string, date: string, start: string, end: string, patch: Partial<PlanBlock> = {}): PlanBlock {
  return { id, taskId, start: at(date, start), end: at(date, end), revision: 1, state: "planned", isLocked: false, scheduleType: "flexible", ...patch };
}

function assertNoOverlaps(result: ReturnType<typeof plan>, busy: Interval[], buffer: number) {
  const all = result.placements.map((p) => ({ start: p.start, end: p.end })).sort((a, b) => a.start - b.start);
  for (let i = 1; i < all.length; i++) expect(all[i].start).toBeGreaterThanOrEqual(all[i - 1].end);
  const padded = pad(busy, buffer);
  for (const p of all) for (const b of padded) expect(p.end <= b.start || p.start >= b.end).toBe(true);
}

describe("placement", () => {
  it("prefers a preferred window over earlier job time, and reports reasons", () => {
    const result = plan({ ...baseContext, tasks: [task("deep-a", { workType: "deep", domain: "work", remainingMinutes: 90 })] });
    expect(result.placements).toHaveLength(1);
    expect(span(result.placements[0])).toBe("Mon 18:00–Mon 19:30");
    expect(result.placements[0].reasons).toContain("inside a preferred window");
    expect(result.creates).toHaveLength(1);
    expect(result.unplaced).toEqual([]);
  });

  it("a personal task never lands in job time under work_related_only, a work task may", () => {
    const personal = plan({ ...baseContext, tasks: [task("errand", { workType: "errand", domain: "personal", remainingMinutes: 30 })] });
    expect(local(personal.placements[0].start)).toBe("Mon 17:30");
    const work = plan({ ...baseContext, tasks: [task("work-shallow", { domain: "work", remainingMinutes: 30 })] });
    expect(local(work.placements[0].start)).toBe("Mon 08:00");
    expect(work.placements[0].reasons).toContain("job time for a work-area task");
    const anyPolicy = plan({ ...baseContext, preferences: { ...baseContext.preferences, jobTimePolicy: "any" }, tasks: [task("errand", { remainingMinutes: 30 })] });
    expect(local(anyPolicy.placements[0].start)).toBe("Mon 08:00");
    const unavailable = plan({ ...baseContext, preferences: { ...baseContext.preferences, jobTimePolicy: "unavailable" }, tasks: [task("work-shallow", { domain: "work", remainingMinutes: 30 })] });
    expect(local(unavailable.placements[0].start)).toBe("Mon 17:30");
  });

  it("splits a splittable task at the maximum block length and never leaves an unplaceable sliver", () => {
    const result = plan({ ...baseContext, tasks: [task("long", { remainingMinutes: 150, isSplittable: true })] });
    expect(result.placements.map(span)).toEqual(["Mon 17:30–Mon 19:30", "Mon 19:40–Mon 20:10"]);
    expect(result.placements[0].reasons).toContain("part 1 of 2");
    // Whole placement ignores the maximum block length when the task cannot be split.
    const whole = plan({ ...baseContext, tasks: [task("long", { remainingMinutes: 150, isSplittable: false })] });
    expect(whole.placements.map(span)).toEqual(["Mon 17:30–Mon 20:00"]);
    // With the evening cut to 110 minutes, a non-splittable 150 cannot go anywhere.
    const nonSplittable = plan({ ...baseContext, busy: [{ start: at(MON, "19:30"), end: at(MON, "21:30") }], tasks: [task("long", { remainingMinutes: 150, isSplittable: false })] });
    expect(nonSplittable.placements).toEqual([]);
    expect(nonSplittable.unplaced[0]).toMatchObject({ taskId: "long", minutes: 150, reason: "needs one uninterrupted slot of 150 minutes" });
  });

  it("respects the minimum block length, buffers, and busy time, with no overlaps", () => {
    const busy = [{ start: at(MON, "18:30"), end: at(MON, "19:00") }, { start: at(MON, "20:00"), end: at(MON, "20:15") }];
    const result = plan({ ...baseContext, busy, tasks: [task("a", { remainingMinutes: 60, isSplittable: true }), task("b", { remainingMinutes: 30 })] });
    assertNoOverlaps(result, busy, 10);
    // Gaps after buffers: 17:30–18:20 (50), 19:10–19:50 (40), 20:25–21:30 (65).
    // "a" (60, splittable) prefers the one gap that holds it whole over an
    // earlier split; "b" then takes the first gap. Nothing shorter than 25 appears.
    expect(result.placements.map((p) => [p.taskId, span(p)])).toEqual([
      ["a", "Mon 20:25–Mon 21:25"],
      ["b", "Mon 17:30–Mon 18:00"],
    ]);
    for (const p of result.placements) expect((p.end - p.start) / 60_000).toBeGreaterThanOrEqual(25);
  });

  it("orders must before should and tighter slack first", () => {
    const busy = [{ start: at(MON, "19:00"), end: at(MON, "21:30") }]; // only 17:30–18:50 is free
    const result = plan({
      ...baseContext,
      busy,
      tasks: [
        task("should-tight", { remainingMinutes: 60, effectivePriority: "should", deadlineAt: at(MON, "23:59") }),
        task("must-loose", { remainingMinutes: 60, effectivePriority: "must", deadlineAt: at("2026-09-12", "23:59") }),
      ],
    });
    expect(result.placements.map((p) => p.taskId)).toEqual(["must-loose"]);
    expect(result.unplaced.map((u) => u.taskId)).toEqual(["should-tight"]);
    const sameBand = plan({
      ...baseContext,
      busy,
      tasks: [
        task("loose", { remainingMinutes: 60, deadlineAt: at("2026-09-12", "23:59") }),
        task("tight", { remainingMinutes: 60, deadlineAt: at(MON, "23:59") }),
      ],
    });
    expect(sameBand.placements.map((p) => p.taskId)).toEqual(["tight"]);
  });

  it("applies the daily deep-work cap, counting kept deep blocks", () => {
    const kept = [block("k1", "deep-kept", MON, "08:00", "10:00")];
    const result = plan({
      ...baseContext,
      preferences: { ...baseContext.preferences, dailyDeepWorkCapMinutes: 180 },
      keptBlocks: kept,
      busy: kept.map((b) => ({ start: b.start, end: b.end })),
      tasks: [task("deep-kept", { workType: "deep", domain: "work", remainingMinutes: 120 }), task("deep-new", { workType: "deep", domain: "work", remainingMinutes: 120, isSplittable: true })],
    });
    // 120 kept for deep-kept covers it fully; 60 minutes of cap remain for deep-new on Monday.
    expect(result.placements.filter((p) => p.taskId === "deep-kept")).toEqual([]);
    const placed = result.placements.filter((p) => p.taskId === "deep-new");
    expect(placed.reduce((s, p) => s + (p.end - p.start) / 60_000, 0)).toBe(60);
    expect(result.unplaced.find((u) => u.taskId === "deep-new")?.minutes).toBe(60);
  });

  it("honors earliest start, and treats hard and soft deadlines differently", () => {
    const twoDays = { ...baseContext, range: { start: day(MON).start, end: day(TUE).end } };
    const later = plan({ ...twoDays, tasks: [task("later", { earliestStart: at(TUE, "00:00") })] });
    expect(local(later.placements[0].start)).toBe("Tue 17:30");
    const hard = plan({ ...twoDays, tasks: [task("hard", { deadlineAt: at(MON, "17:00"), deadlineType: "hard", domain: "personal" })] });
    expect(hard.placements).toEqual([]);
    expect(hard.unplaced[0].reason).toBe("no eligible free time before the hard deadline");
    const soft = plan({ ...twoDays, tasks: [task("soft", { deadlineAt: at(MON, "17:00"), deadlineType: "soft", domain: "personal" })] });
    expect(local(soft.placements[0].start)).toBe("Mon 17:30");
    expect(soft.placements[0].reasons).toContain("after the soft deadline: no earlier eligible time");
  });

  it("kept future blocks reduce remaining work", () => {
    const kept = [block("k", "t", TUE, "17:30", "18:30")];
    const result = plan({ ...baseContext, keptBlocks: kept, tasks: [task("t", { remainingMinutes: 90, isSplittable: true })] });
    expect(result.placements.map((p) => (p.end - p.start) / 60_000)).toEqual([30]);
  });

  it("diffs against re-plannable blocks: move, cancel, create", () => {
    const replannable = [
      block("old-a", "a", MON, "17:30", "18:30"), // will move to the preferred deep window
      block("old-b1", "b", MON, "19:00", "19:30"),
      block("old-b2", "b", MON, "20:00", "20:30", { state: "missed_unconfirmed" }), // b only needs one block now
    ];
    const result = plan({
      ...baseContext,
      replannable,
      tasks: [task("a", { workType: "deep", domain: "work", remainingMinutes: 60, effectivePriority: "must" }), task("b", { remainingMinutes: 30 }), task("c", { remainingMinutes: 25 })],
    });
    // "a" moves into its preferred window; its buffer leaves 17:30–17:50 too short, so "b" moves after it.
    expect(result.moves.map((m) => [m.block.id, span(m)])).toEqual([["old-a", "Mon 18:00–Mon 19:00"], ["old-b1", "Mon 19:10–Mon 19:40"]]);
    expect(result.cancels.map((c) => [c.block.id, c.reason])).toEqual([["old-b2", "re-placing a block that ended without an outcome"]]);
    expect(result.creates.map((c) => c.taskId)).toEqual(["c"]);
    const unchanged = plan({ ...baseContext, replannable: [block("same", "a", MON, "18:00", "19:00")], tasks: [task("a", { workType: "deep", domain: "work", remainingMinutes: 60 })] });
    expect(unchanged.moves).toEqual([]);
    expect(unchanged.creates).toEqual([]);
    // A missed block is cancelled and the work gets a new block, never a move.
    const missedOnly = plan({
      ...baseContext,
      now: at(MON, "18:05"),
      replannable: [block("missed", "m", MON, "17:30", "18:00", { state: "missed_unconfirmed" })],
      tasks: [task("m", { remainingMinutes: 30 })],
    });
    expect(missedOnly.moves).toEqual([]);
    expect(missedOnly.cancels.map((c) => c.block.id)).toEqual(["missed"]);
    expect(missedOnly.creates.map(span)).toEqual(["Mon 18:05–Mon 18:35"]);
  });

  it("is deterministic and independent of input order", () => {
    const tasks = [task("x", { remainingMinutes: 45 }), task("y", { remainingMinutes: 45, score: 60 }), task("z", { remainingMinutes: 45, workType: "deep", domain: "work" })];
    const a = plan({ ...baseContext, tasks });
    const b = plan({ ...baseContext, tasks: [...tasks].reverse() });
    expect(b.placements).toEqual(a.placements);
    expect(a.placements).toHaveLength(3);
    assertNoOverlaps(a, [], 10);
    expect(normalize(a.placements)).toHaveLength(a.placements.length);
  });
});

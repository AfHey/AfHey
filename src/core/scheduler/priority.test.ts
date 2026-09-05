/**
 * Suite I (priority): the deterministic score table, band edges, and the
 * date-only deadline rule. The database half (recompute never touches the
 * manual override) lives in tests/db/scheduler-proposals.test.ts.
 */
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { effectivePriority } from "@/core/domain/priority";
import { deadlineInstant } from "./deadline";
import { computePriorityScore, explainPriority, type PriorityInputs } from "./priority";

const NY = "America/New_York";
const now = DateTime.fromISO("2026-09-05T10:00:00", { zone: NY });
const base: PriorityInputs = {
  now,
  deadlineAt: null,
  deadlineType: null,
  remainingEstimateMinutes: null,
  importance: "medium",
  createdAt: now.minus({ days: 1 }),
  taskKind: "action",
};

describe("computePriorityScore", () => {
  it.each<[string, Partial<PriorityInputs>, number]>([
    ["new task, medium importance, no deadline", {}, 40],
    ["low importance, no deadline", { importance: "low" }, 33],
    ["high importance, no deadline", { importance: "high" }, 50],
    ["unknown importance", { importance: null }, 38],
    ["due in five days", { deadlineAt: now.plus({ days: 5 }) }, 56],
    ["due tomorrow", { deadlineAt: now.plus({ hours: 20 }) }, 70],
    ["overdue hard deadline", { deadlineAt: now.minus({ hours: 2 }), deadlineType: "hard" }, 80],
    ["due in three days with a day and a half of work left", { deadlineAt: now.plus({ days: 3 }), remainingEstimateMinutes: 36 * 60 }, 72],
    ["two weeks old", { createdAt: now.minus({ days: 15 }) }, 50],
    ["waiting for someone else", { taskKind: "waiting_for" }, 30],
    ["everything at once is capped at 100", { deadlineAt: now.minus({ days: 1 }), deadlineType: "hard", remainingEstimateMinutes: 600, importance: "high", createdAt: now.minus({ days: 30 }) }, 100],
  ])("%s → %s", (_label, patch, expected) => {
    expect(computePriorityScore({ ...base, ...patch })).toBe(expected);
  });

  it("explains its parts and stays deterministic for identical inputs", () => {
    const breakdown = explainPriority({ ...base, deadlineAt: now.plus({ days: 5 }) });
    expect(breakdown).toMatchObject({ base: 30, urgency: 16, hardDeadline: 0, pressure: 0, importance: 10, age: 0, kind: 0, score: 56 });
    expect(computePriorityScore({ ...base })).toBe(computePriorityScore({ ...base }));
  });

  it("lands on the spec's bands, and a manual value always wins", () => {
    expect(effectivePriority(null, computePriorityScore({ ...base, deadlineAt: now.plus({ hours: 20 }) }))).toBe("must");
    expect(effectivePriority(null, computePriorityScore({ ...base, deadlineAt: now.plus({ days: 5 }) }))).toBe("should");
    expect(effectivePriority(null, computePriorityScore({ ...base, importance: "low" }))).toBe("could");
    expect(effectivePriority("could", 95)).toBe("could");
  });
});

describe("deadlineInstant", () => {
  it("uses the instant for timed deadlines and the end of day in the user's zone for dates", () => {
    expect(deadlineInstant({ deadlineAt: new Date("2026-09-08T14:00:00Z"), deadlineDate: null, deadlineTimezone: "Europe/London" }, NY)!.toISO()).toBe("2026-09-08T15:00:00.000+01:00");
    expect(deadlineInstant({ deadlineAt: null, deadlineDate: new Date("2026-09-08T00:00:00Z") }, NY)!.toUTC().toISO()).toBe("2026-09-09T03:59:59.999Z");
    expect(deadlineInstant({ deadlineAt: null, deadlineDate: null }, NY)).toBeNull();
  });
});

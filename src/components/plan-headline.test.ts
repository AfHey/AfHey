import { describe, expect, it } from "vitest";
import { planHeadline, type PlanSummaryDto } from "./plan-headline";

const base: PlanSummaryDto = { created: 0, moved: 0, cancelled: 0, unplaced: [], estimateRequired: [], feasibility: [], freeMinutes: 0, eligibleTasks: 0, alreadyPlanned: 0 };

describe("planHeadline", () => {
  it("counts operations when there are any", () => {
    expect(planHeadline({ ...base, created: 2, moved: 1 }, "plan_day", true)).toBe("2 to add · 1 to move · 0 to remove. Nothing is saved until you accept.");
  });

  it("says when there is nothing eligible at all", () => {
    expect(planHeadline(base, "plan_day", false)).toBe("Nothing to place: no open, active, schedulable tasks.");
  });

  it("explains an empty result by missing free time", () => {
    expect(planHeadline({ ...base, eligibleTasks: 2, unplaced: [{ title: "a", minutes: 60, reason: "r" }, { title: "b", minutes: 30, reason: "r" }] }, "plan_week", false)).toBe(
      "No free time left in this week: availability, protected windows, and fixed events leave nothing to fill.",
    );
  });

  it("explains tasks that do not fit and tasks needing estimates", () => {
    expect(
      planHeadline({ ...base, freeMinutes: 45, eligibleTasks: 1, unplaced: [{ title: "a", minutes: 120, reason: "r" }], estimateRequired: [{ title: "b" }, { title: "c" }] }, "plan_day", false),
    ).toBe("1 task cannot fit in the free time. 2 tasks need an estimate before it can be scheduled.");
  });

  it("says when everything eligible is already planned", () => {
    expect(planHeadline({ ...base, freeMinutes: 300, eligibleTasks: 3, alreadyPlanned: 3 }, "plan_day", false)).toBe("All 3 eligible tasks already planned.");
    expect(planHeadline({ ...base, freeMinutes: 300, eligibleTasks: 3, alreadyPlanned: 1, estimateRequired: [{ title: "x" }] }, "plan_day", false)).toBe(
      "1 task needs an estimate before it can be scheduled. 1 task already planned.",
    );
  });
});

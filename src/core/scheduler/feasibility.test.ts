/**
 * Suite I (feasibility): fits / at-risk shortfall / estimate required /
 * no deadline / not schedulable, per-day capacity across a midnight, and the
 * Today capacity check.
 */
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { assessFeasibility, capacityByDay, dayCapacityCheck } from "./feasibility";

const NY = "America/New_York";
const ms = (iso: string) => DateTime.fromISO(iso).toMillis();
const iv = (a: string, b: string) => ({ start: ms(a), end: ms(b) });
const open = { status: "open" as const, isSchedulable: true };
const evenings = [iv("2026-09-07T21:30Z", "2026-09-08T01:30Z"), iv("2026-09-08T21:30Z", "2026-09-09T01:30Z")]; // Mon + Tue 17:30–21:30 NY

describe("capacityByDay", () => {
  it("attributes minutes to local days, splitting at local midnight", () => {
    expect(capacityByDay([iv("2026-09-07T22:00Z", "2026-09-08T05:00Z")], NY)).toEqual([
      { date: "2026-09-07", minutes: 360 }, // 18:00–24:00
      { date: "2026-09-08", minutes: 60 }, // 00:00–01:00
    ]);
  });
});

describe("assessFeasibility", () => {
  it("fits when the estimate is within eligible capacity before the deadline", () => {
    expect(assessFeasibility({ ...open, remainingEstimateMinutes: 90, deadlineAt: ms("2026-09-09T03:59Z") }, evenings, NY))
      .toMatchObject({ status: "fits", capacityMinutes: 480, shortfallMinutes: 0, runsOutOn: null });
  });

  it("is at risk with the shortfall and the day capacity runs out", () => {
    expect(assessFeasibility({ ...open, remainingEstimateMinutes: 600, deadlineAt: ms("2026-09-09T03:59Z") }, evenings, NY))
      .toMatchObject({ status: "at_risk", capacityMinutes: 480, shortfallMinutes: 120, runsOutOn: "2026-09-08" });
  });

  it("never treats a missing estimate as feasible, and reports the other non-answers", () => {
    expect(assessFeasibility({ ...open, remainingEstimateMinutes: null, deadlineAt: ms("2026-09-09T03:59Z") }, evenings, NY).status).toBe("estimate_required");
    expect(assessFeasibility({ ...open, remainingEstimateMinutes: 60, deadlineAt: null }, evenings, NY).status).toBe("no_deadline");
    expect(assessFeasibility({ status: "completed", isSchedulable: true, remainingEstimateMinutes: 60, deadlineAt: ms("2026-09-09T03:59Z") }, evenings, NY).status).toBe("not_schedulable");
    expect(assessFeasibility({ ...open, isSchedulable: false, remainingEstimateMinutes: 60, deadlineAt: ms("2026-09-09T03:59Z") }, evenings, NY).status).toBe("not_schedulable");
  });
});

describe("dayCapacityCheck", () => {
  it("compares scheduled minutes with the day's free minutes", () => {
    expect(dayCapacityCheck([iv("2026-09-07T21:30Z", "2026-09-08T01:30Z")], 300)).toEqual({ availableMinutes: 240, scheduledMinutes: 300, overcommittedMinutes: 60 });
    expect(dayCapacityCheck([iv("2026-09-07T21:30Z", "2026-09-08T01:30Z")], 120).overcommittedMinutes).toBe(0);
  });
});

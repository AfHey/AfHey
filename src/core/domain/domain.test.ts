import { describe, expect, it } from "vitest";
import {
  eventViolations,
  projectParentViolations,
  proposalPolicyViolations,
  taskViolations,
  workSessionViolations,
  type EventShape,
  type TaskShape,
} from "./invariants";
import { normalizeLookupKey } from "./normalize";
import { effectivePriority } from "./priority";
import {
  dbToIsoDate,
  dbToTimeOfDay,
  isoDateToDb,
  isValidTimezone,
  timeOfDayToDb,
  timeOfDayToMinutes,
} from "./time";

const baseTask: TaskShape = {
  title: "t",
  status: "open",
  taskKind: "action",
  deadlineDate: null,
  deadlineAt: null,
  deadlineTimezone: null,
  deadlineType: null,
  remindAt: null,
  reminderTimezone: null,
  waitingForPersonId: null,
  nudgeDate: null,
  estimatedDurationMinutes: null,
  remainingEstimateMinutes: null,
  computedPriorityScore: 50,
  preferredWindowStartTime: null,
  preferredWindowEndTime: null,
  completedAt: null,
};

describe("taskViolations", () => {
  it("accepts a minimal valid task", () => {
    expect(taskViolations(baseTask)).toEqual([]);
  });

  it("accepts each valid deadline mode", () => {
    expect(
      taskViolations({ ...baseTask, deadlineDate: new Date(), deadlineType: "soft" }),
    ).toEqual([]);
    expect(
      taskViolations({
        ...baseTask,
        deadlineAt: new Date(),
        deadlineTimezone: "America/New_York",
        deadlineType: "hard",
      }),
    ).toEqual([]);
  });

  const cases: Array<[string, Partial<TaskShape>, RegExp]> = [
    ["empty title", { title: "  " }, /title/],
    [
      "both deadline modes",
      {
        deadlineDate: new Date(),
        deadlineAt: new Date(),
        deadlineTimezone: "America/New_York",
        deadlineType: "soft",
      },
      /exactly one/,
    ],
    ["instant deadline without zone", { deadlineAt: new Date(), deadlineType: "hard" }, /timezone/],
    ["deadline without type", { deadlineDate: new Date() }, /deadline_type/],
    ["type without deadline", { deadlineType: "hard" }, /deadline_type/],
    [
      "bad IANA zone",
      { deadlineAt: new Date(), deadlineTimezone: "Mars/Olympus", deadlineType: "hard" },
      /IANA/,
    ],
    ["reminder without remind_at", { taskKind: "reminder" }, /remind_at/],
    [
      "remind_at on non-reminder",
      { remindAt: new Date(), reminderTimezone: "America/New_York" },
      /remind_at/,
    ],
    ["waiting_for without person", { taskKind: "waiting_for" }, /waiting_for_person_id/],
    ["nudge date on action task", { nudgeDate: new Date() }, /nudge_date/],
    ["completed without completed_at", { status: "completed" }, /completed_at/],
    ["completed_at while open", { completedAt: new Date() }, /completed_at/],
    ["score above 100", { computedPriorityScore: 101 }, /0 through 100/],
    ["zero estimate", { estimatedDurationMinutes: 0 }, /positive integer/],
    [
      "window start only",
      { preferredWindowStartTime: timeOfDayToDb("09:00") },
      /together/,
    ],
    [
      "inverted window",
      {
        preferredWindowStartTime: timeOfDayToDb("18:00"),
        preferredWindowEndTime: timeOfDayToDb("09:00"),
      },
      /before end/,
    ],
  ];
  it.each(cases)("rejects %s", (_name, patch, message) => {
    const violations = taskViolations({ ...baseTask, ...patch });
    expect(violations.join("; ")).toMatch(message);
  });

  it("accepts a valid reminder and a valid waiting_for task", () => {
    expect(
      taskViolations({
        ...baseTask,
        taskKind: "reminder",
        remindAt: new Date(),
        reminderTimezone: "Europe/Berlin",
      }),
    ).toEqual([]);
    expect(
      taskViolations({
        ...baseTask,
        taskKind: "waiting_for",
        waitingForPersonId: "c0000000-0000-4000-8000-000000000001",
        nudgeDate: new Date(),
      }),
    ).toEqual([]);
  });
});

const timedEvent: EventShape = {
  title: "e",
  kind: "meeting",
  scheduleType: "fixed",
  blockState: null,
  isLocked: false,
  startAt: new Date("2026-09-02T14:00:00Z"),
  endAt: new Date("2026-09-02T15:00:00Z"),
  allDayStartDate: null,
  allDayEndDate: null,
  timezone: "America/New_York",
  taskId: null,
};

describe("eventViolations", () => {
  it("accepts timed and all-day events", () => {
    expect(eventViolations(timedEvent)).toEqual([]);
    expect(
      eventViolations({
        ...timedEvent,
        startAt: null,
        endAt: null,
        allDayStartDate: new Date("2026-09-05T00:00:00Z"),
        allDayEndDate: new Date("2026-09-06T00:00:00Z"),
      }),
    ).toEqual([]);
  });

  const cases: Array<[string, Partial<EventShape>, RegExp]> = [
    ["empty title", { title: " " }, /title/],
    ["invalid zone", { timezone: "Not/AZone" }, /IANA/],
    ["block without task", { kind: "block", blockState: "planned" }, /task_id/],
    ["block without state", { kind: "block", taskId: "e0000000-0000-4000-8000-000000000001" }, /block_state/],
    ["state on non-block", { blockState: "planned" }, /block_state/],
    [
      "timed and all-day together",
      {
        allDayStartDate: new Date("2026-09-05T00:00:00Z"),
        allDayEndDate: new Date("2026-09-06T00:00:00Z"),
      },
      /exactly one/,
    ],
    ["only start", { endAt: null }, /exactly one/],
    ["end before start", { endAt: new Date("2026-09-02T13:00:00Z") }, /after start_at/],
    ["locked fixed event", { isLocked: true }, /fixed event cannot be locked/],
  ];
  it.each(cases)("rejects %s", (_name, patch, message) => {
    expect(eventViolations({ ...timedEvent, ...patch }).join("; ")).toMatch(message);
  });

  it("accepts a locked flexible event", () => {
    expect(
      eventViolations({ ...timedEvent, scheduleType: "flexible", isLocked: true }),
    ).toEqual([]);
  });
});

describe("workSessionViolations", () => {
  const base = {
    startedAt: new Date("2026-09-01T10:00:00Z"),
    stoppedAt: null,
    adjustedDurationMinutes: null,
    adjustmentReason: null,
  };
  it("accepts active and stopped sessions", () => {
    expect(workSessionViolations(base)).toEqual([]);
    expect(
      workSessionViolations({
        ...base,
        stoppedAt: new Date("2026-09-01T11:00:00Z"),
        adjustedDurationMinutes: 45,
        adjustmentReason: "forgot to stop the timer",
      }),
    ).toEqual([]);
  });
  it("rejects stop before start and unpaired adjustments", () => {
    expect(
      workSessionViolations({ ...base, stoppedAt: new Date("2026-09-01T09:00:00Z") }).join(),
    ).toMatch(/after started_at/);
    expect(
      workSessionViolations({ ...base, adjustedDurationMinutes: 30 }).join(),
    ).toMatch(/together/);
  });
});

describe("proposalPolicyViolations", () => {
  it("Phase 1 allows only explicit policy without a tier", () => {
    expect(
      proposalPolicyViolations({ approvalPolicy: "explicit", approvalTier: null }),
    ).toEqual([]);
    expect(
      proposalPolicyViolations({ approvalPolicy: "explicit", approvalTier: 1 }).join(),
    ).toMatch(/tier/);
    expect(
      proposalPolicyViolations({ approvalPolicy: "tiered", approvalTier: 2 }).join(),
    ).toMatch(/Phase 1/);
  });
});

describe("projectParentViolations", () => {
  const area = { id: "a", kind: "area" as const };
  const project = { id: "p", kind: "project" as const };
  it("enforces the one-level area -> project hierarchy", () => {
    expect(projectParentViolations("project", area)).toEqual([]);
    expect(projectParentViolations("project", null)).toEqual([]);
    expect(projectParentViolations("area", null)).toEqual([]);
    expect(projectParentViolations("area", area).join()).toMatch(/area cannot/);
    expect(projectParentViolations("project", project).join()).toMatch(/must be an area/);
    expect(projectParentViolations("project", { ...area, id: "self" }, "self").join()).toMatch(
      /own parent/,
    );
  });
});

describe("effectivePriority (spec §8.3 bands)", () => {
  it("manual value wins; bands 0-39/40-69/70-100", () => {
    expect(effectivePriority("could", 95)).toBe("could");
    expect(effectivePriority(null, 100)).toBe("must");
    expect(effectivePriority(null, 70)).toBe("must");
    expect(effectivePriority(null, 69)).toBe("should");
    expect(effectivePriority(null, 40)).toBe("should");
    expect(effectivePriority(null, 39)).toBe("could");
    expect(effectivePriority(null, 0)).toBe("could");
  });
});

describe("time and normalization helpers", () => {
  it("validates IANA zones", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("EST5EDT")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });
  it("round-trips time-of-day and calendar dates", () => {
    expect(dbToTimeOfDay(timeOfDayToDb("07:05"))).toBe("07:05");
    expect(timeOfDayToMinutes("23:59")).toBe(23 * 60 + 59);
    expect(timeOfDayToMinutes("24:00")).toBeNull();
    expect(dbToIsoDate(isoDateToDb("2026-09-08"))).toBe("2026-09-08");
    expect(() => isoDateToDb("2026-13-40")).toThrow(/Invalid ISO date/);
  });
  it("normalizes lookup keys deterministically", () => {
    expect(normalizeLookupKey("  Priya   RAMAN ")).toBe("priya raman");
    expect(normalizeLookupKey("Café")).toBe("cafe");
  });
});

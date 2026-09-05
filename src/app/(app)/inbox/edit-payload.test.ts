import { describe, expect, it } from "vitest";
import { applyEdit, editorStateFrom } from "./edit-payload";

const ZONE = "America/New_York";

const task = {
  title: "finish the slide deck",
  taskKind: "action",
  bucket: "backlog",
  context: "needs laptop",
  captureId: "c0000000-0000-4000-8000-000000000001",
  peopleIds: ["c0000000-0000-4000-8000-0000000000a1"],
  projectId: "b0000000-0000-4000-8000-000000000001",
  deadlineAt: "2026-09-04T21:00:00.000Z",
  deadlineTimezone: "America/New_York",
  deadlineType: "hard",
  estimatedDurationMinutes: 90,
  isSplittable: true,
  isSchedulable: true,
  computedPriorityScore: 80,
  confidence: "high",
};

describe("applyEdit (finding 6 round trips)", () => {
  it("a title-only edit changes only the title", () => {
    const initial = editorStateFrom("task", task, ZONE);
    const result = applyEdit(task, initial, { ...initial, title: "finish the slide deck v2" });
    expect(result.changedKeys).toEqual(["title"]);
    expect(result.after).toEqual({ ...task, title: "finish the slide deck v2" });
  });

  it("an untouched timed deadline, lock, and range survive a save", () => {
    const event = {
      title: "retreat",
      kind: "personal",
      scheduleType: "flexible",
      isLocked: true,
      timezone: "Europe/London",
      allDayStartDate: "2026-09-12",
      allDayEndDate: "2026-09-15",
      captureId: "c0000000-0000-4000-8000-000000000001",
    };
    const initial = editorStateFrom("event", event, ZONE);
    expect(initial.allDayLastDay).toBe("2026-09-14");
    const result = applyEdit(event, initial, { ...initial, notes: "bring boots" });
    expect(result.changedKeys).toEqual(["notes"]);
    expect(result.after).toEqual({ ...event, notes: "bring boots" });
  });

  it("switching deadline mode writes the whole deadline group and nothing else", () => {
    const initial = editorStateFrom("task", task, ZONE);
    const result = applyEdit(task, initial, {
      ...initial,
      deadlineMode: "date",
      deadlineDate: "2026-09-05",
    });
    expect(result.changedKeys.sort()).toEqual(["deadlineAt", "deadlineDate", "deadlineTimezone"]);
    expect(result.after).toMatchObject({
      deadlineDate: "2026-09-05",
      deadlineAt: null,
      deadlineTimezone: null,
      deadlineType: "hard",
      computedPriorityScore: 80,
      peopleIds: task.peopleIds,
    });
  });

  it("an inclusive last day stores an exclusive end", () => {
    const event = { title: "retreat", kind: "personal", scheduleType: "fixed", timezone: ZONE, allDayStartDate: "2026-09-12", allDayEndDate: "2026-09-13" };
    const initial = editorStateFrom("event", event, ZONE);
    const result = applyEdit(event, initial, { ...initial, allDayLastDay: "2026-09-14" });
    expect(result.after.allDayEndDate).toBe("2026-09-15");
  });

  it("converting task → note carries the capture link and uses the title as body", () => {
    const initial = editorStateFrom("task", task, ZONE);
    const result = applyEdit(task, initial, { ...initial, entityType: "note" });
    expect(result.entityType).toBe("note");
    expect(result.after).toEqual({
      captureId: task.captureId,
      body: "finish the slide deck",
      title: null,
      projectId: task.projectId,
    });
  });
});

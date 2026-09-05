import { describe, expect, it } from "vitest";
import type { Event } from "@/db/generated/client";
import { eventClassNames, formatInZone, toCalendarEvent, visibleRange } from "./view-model";

const base: Event = {
  id: "e0000000-0000-4000-8000-000000000001",
  revision: 1,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  archivedAt: null,
  aiExcluded: false,
  title: "Pipeline sync",
  kind: "meeting",
  scheduleType: "fixed",
  blockState: null,
  isLocked: false,
  startAt: new Date("2026-09-02T14:00:00Z"),
  endAt: new Date("2026-09-02T14:30:00Z"),
  allDayStartDate: null,
  allDayEndDate: null,
  timezone: "America/New_York",
  taskId: null,
  projectId: null,
  captureId: null,
  description: null,
  location: null,
  notes: null,
  sourceProvider: null,
  externalId: null,
  externalVersion: null,
  lastSyncedAt: null,
  syncStatus: "local",
};

describe("calendar view-model", () => {
  it("maps a timed event to ISO instants the library shifts into the configured zone", () => {
    expect(toCalendarEvent(base)).toMatchObject({
      id: base.id,
      title: "Pipeline sync",
      start: "2026-09-02T14:00:00.000Z",
      end: "2026-09-02T14:30:00.000Z",
      allDay: false,
      className: ["afhey-event", "afhey-fixed", "afhey-kind-meeting"],
    });
  });

  it("maps an all-day event to dates with an exclusive end", () => {
    const allDay: Event = {
      ...base,
      startAt: null,
      endAt: null,
      allDayStartDate: new Date("2026-09-05T00:00:00Z"),
      allDayEndDate: new Date("2026-09-06T00:00:00Z"),
    };
    expect(toCalendarEvent(allDay)).toMatchObject({ start: "2026-09-05", end: "2026-09-06", allDay: true });
  });

  it("returns null for an event with neither representation, and classes for locks and blocks", () => {
    expect(toCalendarEvent({ ...base, startAt: null, endAt: null })).toBeNull();
    expect(eventClassNames({ kind: "block", scheduleType: "flexible", isLocked: true, blockState: "planned" })).toEqual([
      "afhey-event", "afhey-flexible", "afhey-kind-block", "afhey-locked", "afhey-block-planned",
    ]);
  });

  it("loads the Monday-first week around the anchor, padded by a day, in the user's zone", () => {
    // 2026-09-02 is a Wednesday; the week runs Mon 31 Aug → Sun 6 Sep (New York, EDT).
    const week = visibleRange("2026-09-02", "America/New_York", "timeGridWeek");
    expect(week.anchor).toBe("2026-09-02");
    expect(week.start.toISOString()).toBe("2026-08-30T04:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-09-08T04:00:00.000Z");
    const day = visibleRange("2026-09-02", "America/New_York", "timeGridDay");
    expect(day.start.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-09-04T04:00:00.000Z");
    // An invalid date falls back to today rather than throwing.
    expect(visibleRange("not-a-date", "America/New_York", "timeGridDay").anchor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formats instants in the user's zone", () => {
    expect(formatInZone("2026-09-02T14:00:00.000Z", "America/New_York")).toBe("Wed 2 Sep 10:00");
    expect(formatInZone(new Date("2026-09-02T14:00:00.000Z"), "Europe/London")).toBe("Wed 2 Sep 15:00");
  });
});

import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "./query";

// Wednesday 2 September 2026, 12:00 New York.
const now = DateTime.fromISO("2026-09-02T12:00:00", { zone: "America/New_York" });

describe("parseSearchQuery", () => {
  it("passes plain keywords through untouched", () => {
    expect(parseSearchQuery("quartz ledger", { now })).toEqual({ keywords: "quartz ledger", due: null, phrase: null, note: null });
  });

  it("turns 'things due Friday' into a one-day window with no keywords", () => {
    expect(parseSearchQuery("things due Friday", { now })).toEqual({ keywords: "", due: { start: "2026-09-04", end: "2026-09-04" }, phrase: "due Friday", note: null });
  });

  it("keeps the remaining keywords next to a date phrase", () => {
    const parsed = parseSearchQuery("ledger by Friday", { now });
    expect(parsed.keywords).toBe("ledger");
    expect(parsed.due).toEqual({ start: "2026-09-02", end: "2026-09-04" });
  });

  it("resolves an explicit date range", () => {
    expect(parseSearchQuery("Sept 12–14", { now }).due).toEqual({ start: "2026-09-12", end: "2026-09-14" });
  });

  it("widens an ambiguous phrase to both readings and says so", () => {
    const parsed = parseSearchQuery("next Friday", { now });
    expect(parsed.due).toEqual({ start: "2026-09-04", end: "2026-09-11" });
    expect(parsed.note).toContain("could mean");
  });

  it("uses the resolved day of a time phrase", () => {
    expect(parseSearchQuery("tomorrow at 3pm", { now }).due).toEqual({ start: "2026-09-03", end: "2026-09-03" });
  });
});

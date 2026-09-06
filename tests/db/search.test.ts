/**
 * Suite L — search (Phase 2 Step 10): keyword hits across the four types,
 * filters, due-window phrases through the deterministic resolver, archived
 * rows hidden, blocks hidden, and `ai_excluded` records searchable (search
 * is local; asserted explicitly).
 */
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchRecords } from "@/core/search/search";
import type { PrismaClient } from "@/db/generated/client";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;
const zone = "America/New_York";
// Wednesday 2 September 2026, 12:00 New York; "Friday" is 2026-09-04.
const now = DateTime.fromISO("2026-09-02T12:00:00", { zone });
const ids = { project: "", area: "" };

beforeAll(async () => {
  db = await resetTestDatabase();
  const area = await db.project.create({ data: { kind: "area", name: "Household", domain: "personal" } });
  const project = await db.project.create({ data: { kind: "project", name: "Quartz ledger migration", description: "Move the family ledger to the quartz spreadsheet", parentId: area.id } });
  ids.area = area.id;
  ids.project = project.id;
  await db.task.createMany({
    data: [
      { title: "Reconcile quartz ledger totals", projectId: project.id, deadlineDate: new Date("2026-09-04T00:00:00Z"), deadlineType: "soft", notes: "check the quartz export twice" },
      { title: "Water the balcony herbs", bucket: "someday" },
      { title: "Private quartz reminder", aiExcluded: true },
      { title: "Archived quartz task", archivedAt: new Date() },
      { title: "Old quartz cleanup", status: "completed", completedAt: new Date() },
      { title: "Pay the piano tuner", deadlineAt: new Date("2026-09-04T21:00:00Z"), deadlineTimezone: zone, deadlineType: "hard" },
      { title: "Renew passport", deadlineDate: new Date("2026-09-20T00:00:00Z"), deadlineType: "soft" },
    ],
  });
  await db.note.create({ data: { title: "Quartz ledger notes", body: "Column mapping for the quartz import lives here.", projectId: project.id } });
  await db.event.createMany({
    data: [
      { title: "Quartz ledger sync", kind: "meeting", scheduleType: "fixed", timezone: zone, startAt: new Date("2026-09-04T15:00:00Z"), endAt: new Date("2026-09-04T15:30:00Z"), projectId: project.id },
      { title: "Dentist", kind: "appointment", scheduleType: "fixed", timezone: zone, startAt: new Date("2026-09-09T15:00:00Z"), endAt: new Date("2026-09-09T15:30:00Z") },
    ],
  });
  const reconcile = await db.task.findFirstOrThrow({ where: { title: "Reconcile quartz ledger totals" } });
  await db.event.create({
    data: { title: "Quartz ledger block", kind: "block", scheduleType: "flexible", timezone: zone, startAt: new Date("2026-09-03T15:00:00Z"), endAt: new Date("2026-09-03T16:00:00Z"), blockState: "planned", taskId: reconcile.id },
  });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

const search = (q: string, extra: Record<string, unknown> = {}) => searchRecords(db, { q, ...extra }, { now, zone });
const titles = (hits: Array<{ title: string }>) => hits.map((h) => h.title).sort();

describe("suite L — search", () => {
  it("finds keyword hits across tasks, projects, notes, and events, hiding archived rows and blocks", async () => {
    const r = await search("quartz");
    expect(new Set(r.hits.map((h) => h.type))).toEqual(new Set(["task", "project", "note", "event"]));
    expect(titles(r.hits)).toEqual(["Old quartz cleanup", "Private quartz reminder", "Quartz ledger migration", "Quartz ledger notes", "Quartz ledger sync", "Reconcile quartz ledger totals"]);
  });

  it("returns ai_excluded records: search is local and never reaches a provider", async () => {
    expect(titles((await search("private reminder")).hits)).toEqual(["Private quartz reminder"]);
  });

  it("highlights matches with control-character markers, not HTML", async () => {
    const note = (await search("import")).hits.find((h) => h.type === "note")!;
    expect(note.snippet).toContain("import");
    expect(note.snippet).toContain(String.fromCharCode(1));
    expect(note.snippet).not.toContain("<");
  });

  it("applies type, project, status, and bucket filters", async () => {
    expect(titles((await search("quartz", { types: ["note"] })).hits)).toEqual(["Quartz ledger notes"]);
    expect(titles((await search("quartz", { projectId: ids.project })).hits)).toEqual(["Quartz ledger migration", "Quartz ledger notes", "Quartz ledger sync", "Reconcile quartz ledger totals"]);
    expect(titles((await search("quartz", { status: "completed" })).hits)).toEqual(["Old quartz cleanup"]);
    expect(titles((await search("herbs", { bucket: "someday" })).hits)).toEqual(["Water the balcony herbs"]);
    expect(titles((await search("", { bucket: "someday" })).hits)).toEqual(["Water the balcony herbs"]);
  });

  it("resolves 'things due Friday' to the day's tasks and events, by date or instant", async () => {
    const r = await search("things due Friday");
    expect(r.due).toEqual({ start: "2026-09-04", end: "2026-09-04" });
    expect(r.parsed.keywords).toBe("");
    expect(titles(r.hits)).toEqual(["Pay the piano tuner", "Quartz ledger sync", "Reconcile quartz ledger totals"]);
  });

  it("combines keywords with a due window and honours an explicit window", async () => {
    expect(titles((await search("quartz by Friday")).hits)).toEqual(["Quartz ledger sync", "Reconcile quartz ledger totals"]);
    expect(titles((await search("", { due: { start: "2026-09-15", end: "2026-09-30" } })).hits)).toEqual(["Renew passport"]);
    expect(titles((await search("dentist", { due: { start: "2026-09-04", end: "2026-09-04" } })).hits)).toEqual([]);
  });

  it("returns nothing for an empty request", async () => {
    expect((await search("   ")).hits).toEqual([]);
  });
});

/**
 * Scheduler-constraint settings (Phase 2 Step 2): defaults, merged-row
 * validation on partial updates, revision guards, deletion, and the route
 * error mapping (400 shape, 422 invariant).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionUser } from "@/core/auth/provision";
import { resetRateLimits } from "@/core/auth/rate-limit";
import { createSession } from "@/core/auth/sessions";
import { DomainInvariantError } from "@/core/domain/invariants";
import {
  createWindow,
  deleteWindow,
  loadSchedulerSettings,
  updateSchedulerPreferences,
  updateWindow,
} from "@/core/domain/scheduler-settings";
import type { PrismaClient } from "@/db/generated/client";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let db: PrismaClient;
let cookie: string;
type Route = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const routes: Record<string, Route> = {};
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  db = await resetTestDatabase();
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as { __afheyPrisma?: unknown }).__afheyPrisma;
  routes.prefs = (await import("@/app/api/settings/scheduler/route")).PATCH as Route;
  routes.windowCreate = (await import("@/app/api/settings/windows/[kind]/route")).POST as Route;
  const byId = await import("@/app/api/settings/windows/[kind]/[id]/route");
  routes.windowPatch = byId.PATCH as Route;
  routes.windowDelete = byId.DELETE as Route;
  const user = await provisionUser(db, "scheduler-settings-password");
  cookie = `afhey_session=${(await createSession(db, user)).token}`;
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

beforeEach(() => resetRateLimits());

describe("scheduler settings model", () => {
  it("loads provisioned defaults with no windows", async () => {
    const settings = await loadSchedulerSettings(db);
    expect(settings.preferences).toMatchObject({ minBlockMinutes: 25, maxBlockMinutes: 120, bufferMinutes: 10, jobTimePolicy: "work_related_only" });
    expect(settings.preferences.revision).toBe(1);
    expect(settings.availability).toEqual([]);
    expect(settings.timezone).toBe("America/New_York");
  });

  it("validates merged preferences and bumps the revision", async () => {
    await expect(updateSchedulerPreferences(db, { minBlockMinutes: 200 })).rejects.toThrow(DomainInvariantError);
    const updated = await updateSchedulerPreferences(db, { maxBlockMinutes: 90, bufferMinutes: 5 });
    expect(updated).toMatchObject({ maxBlockMinutes: 90, bufferMinutes: 5, revision: 2 });
    await expect(updateSchedulerPreferences(db, { minBlockMinutes: 95 })).rejects.toThrow(/must not exceed/);
  });

  it("creates, updates on the merged row, and deletes windows of every kind", async () => {
    const availability = await createWindow(db, "availability", { weekday: 2, startTime: "17:30", endTime: "21:30", kind: "general", label: null });
    expect(availability).toMatchObject({ weekday: 2, kind: "general" });
    // Merged validation: moving the end before the current start is refused.
    await expect(updateWindow(db, "availability", availability.id, { endTime: "17:00" })).rejects.toThrow(DomainInvariantError);
    const moved = await updateWindow(db, "availability", availability.id, { startTime: "18:00", weekday: 3 });
    expect(moved).toMatchObject({ weekday: 3, revision: 2 });

    await expect(
      createWindow(db, "protected", { recurrence: "weekly", weekday: null, onDate: "2026-09-13", startTime: "08:00", endTime: "20:00", label: null }),
    ).rejects.toThrow(DomainInvariantError);
    const protectedWindow = await createWindow(db, "protected", { recurrence: "once", weekday: null, onDate: "2026-09-13", startTime: "08:00", endTime: "20:00", label: "Trip" });
    const switched = await updateWindow(db, "protected", protectedWindow.id, { recurrence: "weekly", weekday: 7, onDate: null });
    expect(switched).toMatchObject({ recurrence: "weekly", weekday: 7, onDate: null });

    const preferred = await createWindow(db, "preferred", { weekday: null, startTime: "18:00", endTime: "20:00", workType: "deep", label: null });
    const loaded = await loadSchedulerSettings(db);
    expect(loaded.availability.map((w) => w.startTime)).toEqual(["18:00"]);
    expect(loaded.protected).toHaveLength(1);
    expect(loaded.preferred[0]).toMatchObject({ weekday: null, workType: "deep", startTime: "18:00", endTime: "20:00" });

    await deleteWindow(db, "preferred", preferred.id);
    await deleteWindow(db, "protected", protectedWindow.id);
    await deleteWindow(db, "availability", availability.id);
    const emptied = await loadSchedulerSettings(db);
    expect([emptied.availability.length, emptied.protected.length, emptied.preferred.length]).toEqual([0, 0, 0]);
  });
});

describe("scheduler settings routes", () => {
  it("maps validation and invariant failures to 400 and 422, and creates with 201", async () => {
    expect((await routes.windowCreate(req("POST", { weekday: 9, startTime: "17:00", endTime: "18:00" }), ctx({ kind: "availability" }))).status).toBe(400);
    expect((await routes.windowCreate(req("POST", { weekday: 1, startTime: "17:00", endTime: "18:00" }), ctx({ kind: "banana" }))).status).toBe(400);
    const created = await routes.windowCreate(req("POST", { weekday: 1, startTime: "17:00", endTime: "18:00", kind: "job" }), ctx({ kind: "availability" }));
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string };

    const badPatch = await routes.windowPatch(req("PATCH", { startTime: "18:30" }), ctx({ kind: "availability", id: row.id }));
    expect(badPatch.status).toBe(422);
    const goodPatch = await routes.windowPatch(req("PATCH", { label: "Job" }), ctx({ kind: "availability", id: row.id }));
    expect(goodPatch.status).toBe(200);

    const prefs = await routes.prefs(req("PATCH", { minBlockMinutes: 500 }), ctx({}));
    expect(prefs.status).toBe(400); // above the schema maximum
    const prefs422 = await routes.prefs(req("PATCH", { minBlockMinutes: 100, maxBlockMinutes: 60 }), ctx({}));
    expect(prefs422.status).toBe(422);
    const prefsOk = await routes.prefs(req("PATCH", { planningHorizonDays: 10 }), ctx({}));
    expect(prefsOk.status).toBe(200);
    expect(((await prefsOk.json()) as { planningHorizonDays: number }).planningHorizonDays).toBe(10);

    expect((await routes.windowDelete(req("DELETE"), ctx({ kind: "availability", id: row.id }))).status).toBe(200);
    expect((await routes.windowDelete(req("DELETE"), ctx({ kind: "availability", id: row.id }))).status).toBe(404);
  });
});

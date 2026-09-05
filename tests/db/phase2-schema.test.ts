/**
 * Phase 2 migration (plan Section 4): the four scheduler-constraint tables,
 * Project.domain, and generated full-text search columns — applied from
 * scratch by `migrate deploy`, with their CHECK constraints proven at the
 * database level.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionUser } from "@/core/auth/provision";
import type { PrismaClient } from "@/db/generated/client";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;
let settingsId: string;

beforeAll(async () => {
  db = await resetTestDatabase();
  await provisionUser(db, "phase2-schema-password");
  settingsId = (await db.userSettings.findFirstOrThrow()).id;
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

async function rejects(sql: string, params: unknown[] = []) {
  await expect(db.$executeRawUnsafe(sql, ...params)).rejects.toThrow();
}

describe("Phase 2 schema", () => {
  it("adds the scheduler tables, Project.domain, and search columns", async () => {
    const tables = (
      await db.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    ).map((r) => r.table_name);
    for (const t of ["availability_window", "protected_window", "preferred_window", "scheduler_preferences"]) {
      expect(tables).toContain(t);
    }
    const columns = await db.$queryRaw<Array<{ table_name: string; column_name: string; is_generated: string }>>`
      SELECT table_name, column_name, is_generated FROM information_schema.columns
      WHERE table_schema = 'public' AND (column_name = 'search_vector' OR (table_name = 'project' AND column_name = 'domain'))`;
    expect(columns.filter((c) => c.column_name === "search_vector").map((c) => c.table_name).sort()).toEqual(["event", "note", "project", "task"]);
    expect(columns.filter((c) => c.column_name === "search_vector").every((c) => c.is_generated === "ALWAYS")).toBe(true);
    expect(columns.some((c) => c.table_name === "project" && c.column_name === "domain")).toBe(true);
    const indexes = await db.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%search_vector_idx'`;
    expect(indexes.map((i) => i.indexname).sort()).toEqual([
      "event_search_vector_idx", "note_search_vector_idx", "project_search_vector_idx", "task_search_vector_idx",
    ]);
  });

  it("provisioning creates the scheduler preferences row with the product-owner defaults", async () => {
    const prefs = await db.schedulerPreferences.findUniqueOrThrow({ where: { userSettingsId: settingsId } });
    expect(prefs).toMatchObject({
      minBlockMinutes: 25,
      maxBlockMinutes: 120,
      bufferMinutes: 10,
      dailyDeepWorkCapMinutes: 240,
      jobTimePolicy: "work_related_only",
      planningHorizonDays: 7,
    });
  });

  it("enforces window rules in the database", async () => {
    // start must precede end
    await rejects(`INSERT INTO availability_window (user_settings_id, weekday, start_time, end_time) VALUES ($1::uuid, 1, '18:00', '17:00')`, [settingsId]);
    // weekday range
    await rejects(`INSERT INTO availability_window (user_settings_id, weekday, start_time, end_time) VALUES ($1::uuid, 8, '17:00', '18:00')`, [settingsId]);
    // weekly protected window needs a weekday and no date
    await rejects(`INSERT INTO protected_window (user_settings_id, recurrence, start_time, end_time) VALUES ($1::uuid, 'weekly', '08:00', '20:00')`, [settingsId]);
    await rejects(`INSERT INTO protected_window (user_settings_id, recurrence, weekday, on_date, start_time, end_time) VALUES ($1::uuid, 'weekly', 7, '2026-09-13', '08:00', '20:00')`, [settingsId]);
    // one-off protected window needs a date and no weekday
    await rejects(`INSERT INTO protected_window (user_settings_id, recurrence, start_time, end_time) VALUES ($1::uuid, 'once', '08:00', '20:00')`, [settingsId]);
    // preferences: one row per settings, min <= max
    await rejects(`INSERT INTO scheduler_preferences (user_settings_id) VALUES ($1::uuid)`, [settingsId]);
    await rejects(`UPDATE scheduler_preferences SET min_block_minutes = 200, max_block_minutes = 100 WHERE user_settings_id = $1::uuid`, [settingsId]);
    // a valid row of each kind is accepted
    await db.$executeRawUnsafe(`INSERT INTO availability_window (user_settings_id, weekday, start_time, end_time) VALUES ($1::uuid, 1, '17:30', '21:30')`, settingsId);
    await db.$executeRawUnsafe(`INSERT INTO protected_window (user_settings_id, recurrence, on_date, start_time, end_time) VALUES ($1::uuid, 'once', '2026-09-13', '08:00', '20:00')`, settingsId);
    await db.$executeRawUnsafe(`INSERT INTO preferred_window (user_settings_id, start_time, end_time, work_type) VALUES ($1::uuid, '18:00', '20:00', 'deep')`, settingsId);
    expect(await db.availabilityWindow.count()).toBe(1);
  });

  it("allows domain on areas only", async () => {
    const area = await db.project.create({ data: { kind: "area", name: "Domain Area", domain: "work" } });
    expect(area.domain).toBe("work");
    await rejects(`INSERT INTO project (kind, name, parent_id, domain) VALUES ('project', 'Domain Project', $1::uuid, 'work')`, [area.id]);
  });

  it("keeps the search vectors current from the source columns", async () => {
    const task = await db.task.create({ data: { title: "Calibrate the zephyr ledger", notes: "quarterly reconciliation" } });
    const hits = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM task WHERE search_vector @@ plainto_tsquery('english', 'ledger reconciliation')`;
    expect(hits.map((h) => h.id)).toContain(task.id);
    await db.task.update({ where: { id: task.id }, data: { title: "Calibrate the zephyr register", notes: null } });
    const after = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM task WHERE search_vector @@ plainto_tsquery('english', 'ledger')`;
    expect(after.map((h) => h.id)).not.toContain(task.id);
  });
});

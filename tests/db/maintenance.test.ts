/**
 * Maintenance job integration (Phase 2 Step 11): one run performs the
 * missed-block transition and the priority recompute, reports retention and
 * recovery, and a second run at the same instant changes nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/db/generated/client";
import { runMaintenance } from "@/jobs/maintenance";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;
const zone = "America/New_York";
const now = new Date("2026-09-10T16:00:00Z"); // Thu 12:00 New York

beforeAll(async () => {
  db = await resetTestDatabase(); // no UserSettings row: the job falls back to America/New_York
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

describe("maintenance job", () => {
  it("marks ended planned blocks missed, recomputes priorities, and is idempotent", async () => {
    const dueTomorrow = await db.task.create({
      data: { title: "File the quarterly form", deadlineDate: new Date("2026-09-11T00:00:00Z"), deadlineType: "hard", remainingEstimateMinutes: 60 },
    });
    const later = await db.task.create({ data: { title: "Reorganise the pantry", remainingEstimateMinutes: 30 } });
    const ended = await db.event.create({
      data: { title: "File the quarterly form", kind: "block", scheduleType: "flexible", timezone: zone, startAt: new Date("2026-09-10T13:00:00Z"), endAt: new Date("2026-09-10T14:00:00Z"), blockState: "planned", taskId: dueTomorrow.id },
    });
    const ahead = await db.event.create({
      data: { title: "Reorganise the pantry", kind: "block", scheduleType: "flexible", timezone: zone, startAt: new Date("2026-09-10T18:00:00Z"), endAt: new Date("2026-09-10T18:30:00Z"), blockState: "planned", taskId: later.id },
    });
    const worked = await db.event.create({
      data: { title: "Worked block", kind: "block", scheduleType: "flexible", timezone: zone, startAt: new Date("2026-09-10T10:00:00Z"), endAt: new Date("2026-09-10T11:00:00Z"), blockState: "planned", taskId: later.id },
    });
    await db.workSession.create({ data: { taskId: later.id, eventId: worked.id, startedAt: new Date("2026-09-10T10:00:00Z"), stoppedAt: new Date("2026-09-10T11:00:00Z") } });

    const first = await runMaintenance(db, now);
    expect(first.ranAt).toBe(now.toISOString());
    expect(first.missedBlocks).toBe(1);
    expect(first.priorities.examined).toBe(2);
    expect(first.priorities.updated).toBeGreaterThanOrEqual(1);
    expect(first.recovered).toEqual([]);
    expect(first.expiry).toBeDefined();

    expect((await db.event.findUniqueOrThrow({ where: { id: ended.id } })).blockState).toBe("missed_unconfirmed");
    expect((await db.event.findUniqueOrThrow({ where: { id: ahead.id } })).blockState).toBe("planned");
    expect((await db.event.findUniqueOrThrow({ where: { id: worked.id } })).blockState).toBe("planned"); // a session was recorded: not "missed"

    const urgent = await db.task.findUniqueOrThrow({ where: { id: dueTomorrow.id } });
    const relaxed = await db.task.findUniqueOrThrow({ where: { id: later.id } });
    expect(urgent.computedPriorityScore).toBeGreaterThan(relaxed.computedPriorityScore);
    expect(urgent.userPriority).toBeNull();

    const second = await runMaintenance(db, now);
    expect(second.missedBlocks).toBe(0);
    expect(second.priorities.updated).toBe(0);
    expect(second.recovered).toEqual([]);
  });
});

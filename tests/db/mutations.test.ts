/**
 * Step 4 mutation-helper suite: direct manual mutations increment revision,
 * detect concurrent edits, enforce merged-row invariants and hierarchy rules,
 * and archive instead of delete (spec §11.2 rule 13, §9.5).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainInvariantError } from "@/core/domain/invariants";
import {
  addPersonAliasDirect,
  archiveEntity,
  completeTaskDirect,
  createPersonDirect,
  createProjectDirect,
  createTaskDirect,
  restoreEntity,
  uncompleteTaskDirect,
  updateProjectDirect,
  updateTaskDirect,
} from "@/core/domain/mutations";
import type { PrismaClient } from "@/db/generated/client";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;

beforeAll(async () => {
  db = await resetTestDatabase();
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

describe("direct mutations", () => {
  it("creates, updates, completes, and uncompletes a task with revision bumps", async () => {
    const task = await createTaskDirect(db, { title: "Revise onboarding doc" });
    expect(task.revision).toBe(1);

    const updated = await updateTaskDirect(db, task.id, {
      deadlineDate: "2026-09-10",
      deadlineType: "soft",
    });
    expect(updated.revision).toBe(2);
    expect(updated.deadlineType).toBe("soft");

    const completed = await completeTaskDirect(db, task.id);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();
    expect(completed.revision).toBe(3);

    const reopened = await uncompleteTaskDirect(db, task.id);
    expect(reopened.status).toBe("open");
    expect(reopened.completedAt).toBeNull();
    expect(reopened.revision).toBe(4);
  });

  it("rejects an update that would violate merged-row invariants", async () => {
    const task = await createTaskDirect(db, {
      title: "Deadline task",
      deadlineDate: "2026-09-10",
      deadlineType: "hard",
    });
    // Adding an instant deadline on top of the stored date-only one must fail
    // before the DB is touched.
    await expect(
      updateTaskDirect(db, task.id, {
        deadlineAt: "2026-09-10T15:00:00Z",
        deadlineTimezone: "America/New_York",
      }),
    ).rejects.toThrow(DomainInvariantError);
    const unchanged = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(unchanged.revision).toBe(1);
  });

  it("rejects attaching a task to an area", async () => {
    const area = await createProjectDirect(db, { kind: "area", name: "Fixture Area" });
    await expect(
      createTaskDirect(db, { title: "misplaced", projectId: area.id }),
    ).rejects.toThrow(/project_id must reference a project/);
  });

  it("enforces the project hierarchy on create and update", async () => {
    const area = await createProjectDirect(db, { kind: "area", name: "Hierarchy Area" });
    const project = await createProjectDirect(db, {
      kind: "project",
      name: "Hierarchy Project",
      parentId: area.id,
    });
    await expect(
      createProjectDirect(db, { kind: "project", name: "Nested", parentId: project.id }),
    ).rejects.toThrow(/must be an area/);
    await expect(
      updateProjectDirect(db, area.id, { parentId: project.id }),
    ).rejects.toThrow(/area cannot/);
  });

  it("normalizes person aliases and surfaces duplicate-alias conflicts", async () => {
    const person = await createPersonDirect(db, {
      name: "Sarah Winters",
      aliases: ["  SARAH  W "],
    });
    expect(person.aliases[0].normalizedAlias).toBe("sarah w");
    await expect(addPersonAliasDirect(db, person.id, "Sarah   w")).rejects.toThrow();
  });

  it("archives and restores instead of deleting", async () => {
    const note = await db.note.create({ data: { body: "archive me" } });
    await archiveEntity(db, "note", note.id);
    const archived = await db.note.findUniqueOrThrow({ where: { id: note.id } });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.revision).toBe(2);

    await restoreEntity(db, "note", note.id);
    const restored = await db.note.findUniqueOrThrow({ where: { id: note.id } });
    expect(restored.archivedAt).toBeNull();
    expect(restored.revision).toBe(3);
  });
});

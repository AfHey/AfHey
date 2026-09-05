/**
 * Operation executors: the only code that turns validated ProposalOperations
 * into rows, always inside the apply transaction. Every mutation takes a row
 * lock, rechecks the expected revision under it (spec §11.2 rule 4), and
 * re-runs merged-row invariants. Deletes exist solely for conflict-aware
 * undo of creates and re-verify "no acquired dependents" before removing.
 */
import type { EntityType } from "@/core/domain/enums";
import {
  assertEventShape,
  assertProjectParent,
  assertTaskShape,
} from "@/core/domain/invariants";
import {
  assertProjectRefIsProject,
  stripUndefined,
  toEventData,
  toTaskData,
  uniquePeople,
} from "@/core/domain/mutations";
import { normalizeLookupKey } from "@/core/domain/normalize";
import type {
  EventCreateInput,
  EventUpdateInput,
  NoteCreateInput,
  PersonCreateInput,
  ProjectCreateInput,
  TaskCreateInput,
  TaskUpdateInput,
} from "@/core/domain/schemas";
import type { Prisma } from "@/db/generated/client";
import { ProposalConflictError, type ConflictDetail } from "./errors";

type Tx = Prisma.TransactionClient;

// Enum values match the physical table names by construction.
const TABLE: Record<EntityType, string> = {
  task: "task",
  event: "event",
  note: "note",
  person: "person",
  project: "project",
};

interface EntityRow {
  id: string;
  revision: number;
  archivedAt?: Date | null;
  [key: string]: unknown;
}

type Delegate = {
  findUnique(args: { where: { id: string } }): Promise<EntityRow | null>;
  updateMany(args: {
    where: { id: string; revision: number };
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  delete(args: { where: { id: string } }): Promise<unknown>;
};

function delegateFor(tx: Tx, entityType: EntityType): Delegate {
  return (tx as unknown as Record<string, Delegate>)[entityType];
}

function conflict(detail: ConflictDetail): never {
  throw new ProposalConflictError([detail]);
}

/** Locks the row and returns its current revision (null when missing). */
async function lockRevision(
  tx: Tx,
  entityType: EntityType,
  id: string,
): Promise<number | null> {
  const rows = await tx.$queryRawUnsafe<Array<{ revision: number }>>(
    `SELECT revision FROM "${TABLE[entityType]}" WHERE id = $1::uuid FOR UPDATE`,
    id,
  );
  return rows[0]?.revision ?? null;
}

async function lockAndCheck(
  tx: Tx,
  entityType: EntityType,
  entityId: string,
  expectedRevision: number,
): Promise<EntityRow> {
  const actual = await lockRevision(tx, entityType, entityId);
  if (actual === null) {
    conflict({ entityType, entityId, reason: "entity no longer exists", expectedRevision, actualRevision: null });
  }
  if (actual !== expectedRevision) {
    conflict({
      entityType,
      entityId,
      reason: "entity was modified since the proposal was computed",
      expectedRevision,
      actualRevision: actual,
    });
  }
  const row = await delegateFor(tx, entityType).findUnique({ where: { id: entityId } });
  if (!row) {
    conflict({ entityType, entityId, reason: "entity vanished during apply", expectedRevision });
  }
  return row;
}

// --- create ----------------------------------------------------------------

export async function executeCreate(
  tx: Tx,
  entityType: EntityType,
  entityId: string,
  payload: unknown,
): Promise<void> {
  switch (entityType) {
    case "task": {
      const input = payload as TaskCreateInput;
      await assertProjectRefIsProject(tx, input.projectId);
      await tx.task.create({
        data: {
          ...(toTaskData(input) as Prisma.TaskUncheckedCreateInput),
          id: entityId,
          people: { create: uniquePeople(input.peopleIds).map((personId) => ({ personId })) },
        },
      });
      return;
    }
    case "event": {
      const input = payload as EventCreateInput;
      await assertProjectRefIsProject(tx, input.projectId);
      await tx.event.create({
        data: { ...toEventData(input), id: entityId } as Prisma.EventUncheckedCreateInput,
      });
      return;
    }
    case "note": {
      const input = payload as NoteCreateInput;
      await assertProjectRefIsProject(tx, input.projectId);
      await tx.note.create({ data: { ...input, id: entityId } });
      return;
    }
    case "person": {
      const { aliases, ...person } = payload as PersonCreateInput;
      await tx.person.create({
        data: {
          ...person,
          id: entityId,
          aliases: {
            create: aliases.map((alias) => ({
              alias,
              normalizedAlias: normalizeLookupKey(alias),
            })),
          },
        },
      });
      return;
    }
    case "project": {
      const input = payload as ProjectCreateInput;
      const parent = input.parentId
        ? await tx.project.findUniqueOrThrow({ where: { id: input.parentId } })
        : null;
      assertProjectParent(input.kind, parent);
      await tx.project.create({ data: { ...input, id: entityId } });
      return;
    }
  }
}

// --- update / archive / restore -------------------------------------------

export async function executeUpdate(
  tx: Tx,
  entityType: EntityType,
  entityId: string,
  expectedRevision: number,
  payload: unknown,
): Promise<void> {
  const current = await lockAndCheck(tx, entityType, entityId, expectedRevision);
  let data: Record<string, unknown>;
  switch (entityType) {
    case "task": {
      const converted = toTaskData(payload as TaskUpdateInput);
      assertTaskShape({ ...current, ...stripUndefined(converted) } as never);
      await assertProjectRefIsProject(tx, (payload as TaskUpdateInput).projectId);
      data = converted;
      break;
    }
    case "event": {
      const converted = toEventData(payload as EventUpdateInput);
      assertEventShape({ ...current, ...stripUndefined(converted) } as never);
      await assertProjectRefIsProject(tx, (payload as EventUpdateInput).projectId);
      data = converted;
      break;
    }
    case "note": {
      await assertProjectRefIsProject(
        tx,
        (payload as { projectId?: string | null }).projectId,
      );
      data = payload as Record<string, unknown>;
      break;
    }
    case "person":
      data = payload as Record<string, unknown>;
      break;
    case "project": {
      const patch = payload as { parentId?: string | null };
      const nextParentId =
        patch.parentId === undefined ? (current.parentId as string | null) : patch.parentId;
      const parent = nextParentId
        ? await tx.project.findUniqueOrThrow({ where: { id: nextParentId } })
        : null;
      assertProjectParent(current.kind as "area" | "project", parent, entityId);
      data = payload as Record<string, unknown>;
      break;
    }
  }
  const result = await delegateFor(tx, entityType).updateMany({
    where: { id: entityId, revision: expectedRevision },
    data: { ...stripUndefined(data), revision: { increment: 1 } },
  });
  if (result.count !== 1) {
    conflict({ entityType, entityId, reason: "revision changed during apply", expectedRevision });
  }
}

export async function executeSetArchived(
  tx: Tx,
  entityType: EntityType,
  entityId: string,
  expectedRevision: number,
  archived: boolean,
): Promise<void> {
  await lockAndCheck(tx, entityType, entityId, expectedRevision);
  const result = await delegateFor(tx, entityType).updateMany({
    where: { id: entityId, revision: expectedRevision },
    data: { archivedAt: archived ? new Date() : null, revision: { increment: 1 } },
  });
  if (result.count !== 1) {
    conflict({ entityType, entityId, reason: "revision changed during apply", expectedRevision });
  }
}

// --- delete (conflict-aware undo of a create; spec §9.5, §11.2 rule 9) -----

export interface DeleteManifest {
  aliases: string[];
  peopleIds: string[];
}

export async function collectDeleteBlockers(
  tx: Tx,
  entityType: EntityType,
  entityId: string,
  manifest: DeleteManifest,
): Promise<string[]> {
  const blockers: string[] = [];
  switch (entityType) {
    case "task": {
      const [sessions, blocks, links] = await Promise.all([
        tx.workSession.count({ where: { taskId: entityId } }),
        tx.event.count({ where: { taskId: entityId } }),
        tx.taskPerson.findMany({ where: { taskId: entityId }, select: { personId: true } }),
      ]);
      if (sessions) blockers.push(`${sessions} work session(s) reference the task`);
      if (blocks) blockers.push(`${blocks} block event(s) reference the task`);
      const expected = new Set(manifest.peopleIds);
      const added = links.filter((l) => !expected.has(l.personId)).length;
      if (added) blockers.push(`${added} person link(s) were added to the task after creation`);
      break;
    }
    case "event": {
      const [sessions, links] = await Promise.all([
        tx.workSession.count({ where: { eventId: entityId } }),
        tx.eventPerson.count({ where: { eventId: entityId } }),
      ]);
      if (sessions) blockers.push(`${sessions} work session(s) reference the event`);
      if (links) blockers.push(`${links} person link(s) were added to the event`);
      break;
    }
    case "person": {
      const [waiting, taskLinks, eventLinks, aliases] = await Promise.all([
        tx.task.count({ where: { waitingForPersonId: entityId } }),
        tx.taskPerson.count({ where: { personId: entityId } }),
        tx.eventPerson.count({ where: { personId: entityId } }),
        tx.personAlias.findMany({ where: { personId: entityId } }),
      ]);
      if (waiting) blockers.push(`${waiting} waiting-for task(s) reference the person`);
      if (taskLinks || eventLinks) {
        blockers.push(`${taskLinks + eventLinks} task/event link(s) reference the person`);
      }
      const current = new Set(aliases.map((a) => a.normalizedAlias));
      const expected = new Set(manifest.aliases);
      const unexpected = [...current].filter((a) => !expected.has(a));
      if (unexpected.length > 0) {
        blockers.push(`alias(es) added after creation: ${unexpected.join(", ")}`);
      }
      break;
    }
    case "project": {
      const [children, tasks, events, notes] = await Promise.all([
        tx.project.count({ where: { parentId: entityId } }),
        tx.task.count({ where: { projectId: entityId } }),
        tx.event.count({ where: { projectId: entityId } }),
        tx.note.count({ where: { projectId: entityId } }),
      ]);
      const total = children + tasks + events + notes;
      if (total) blockers.push(`${total} record(s) belong to the project`);
      break;
    }
    case "note":
      break;
  }
  return blockers;
}

export async function executeDelete(
  tx: Tx,
  entityType: EntityType,
  entityId: string,
  expectedRevision: number,
  manifest: DeleteManifest,
): Promise<void> {
  await lockAndCheck(tx, entityType, entityId, expectedRevision);
  const blockers = await collectDeleteBlockers(tx, entityType, entityId, manifest);
  if (blockers.length > 0) {
    conflict({
      entityType,
      entityId,
      reason: `cannot hard-delete: ${blockers.join("; ")}`,
      expectedRevision,
    });
  }
  try {
    if (entityType === "person") {
      await tx.personAlias.deleteMany({
        where: { personId: entityId, normalizedAlias: { in: manifest.aliases } },
      });
    }
    if (entityType === "task") {
      await tx.taskPerson.deleteMany({
        where: { taskId: entityId, personId: { in: manifest.peopleIds } },
      });
    }
    await delegateFor(tx, entityType).delete({ where: { id: entityId } });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2003") {
      conflict({
        entityType,
        entityId,
        reason: "dependent rows appeared during apply",
        expectedRevision,
      });
    }
    throw error;
  }
}

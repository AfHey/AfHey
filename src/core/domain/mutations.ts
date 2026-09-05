/**
 * Direct manual mutations (product-spec §11.2 rule 13): ordinary single-entity
 * edits mutate transactionally, increment `revision`, and write no Proposal or
 * ActionLog row. Every mutation revalidates the merged row against the §9
 * invariants before writing; the DB CHECK constraints remain the backstop.
 * Archive/soft-delete is the only removal offered here (spec §9.5).
 */
import type { PrismaClient, Prisma } from "@/db/generated/client";
import {
  assertEventShape,
  assertProjectDomain,
  assertProjectParent,
  assertTaskShape,
  DomainInvariantError,
} from "./invariants";
import { normalizeLookupKey } from "./normalize";
import type {
  EventCreateInput,
  EventUpdateInput,
  GlossaryEntryInput,
  NoteCreateInput,
  PersonCreateInput,
  ProjectCreateInput,
  TaskCreateInput,
  TaskUpdateInput,
} from "./schemas";
import { isoDateToDb, timeOfDayToDb } from "./time";

export class RevisionConflictError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was modified concurrently; reload and retry`);
    this.name = "RevisionConflictError";
  }
}

type Tx = Prisma.TransactionClient;

function bumped<T extends object>(data: T) {
  return { ...data, revision: { increment: 1 } };
}

const dateOrNull = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(v);
const isoDateOrNull = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : isoDateToDb(v);
const timeOrNull = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : timeOfDayToDb(v);

export function toTaskData(input: TaskUpdateInput) {
  return {
    title: input.title,
    taskKind: input.taskKind,
    bucket: input.bucket,
    description: input.description,
    notes: input.notes,
    location: input.location,
    context: input.context,
    projectId: input.projectId,
    captureId: input.captureId,
    deadlineDate: isoDateOrNull(input.deadlineDate),
    deadlineAt: dateOrNull(input.deadlineAt),
    deadlineTimezone: input.deadlineTimezone,
    deadlineType: input.deadlineType,
    remindAt: dateOrNull(input.remindAt),
    reminderTimezone: input.reminderTimezone,
    waitingForPersonId: input.waitingForPersonId,
    nudgeDate: isoDateOrNull(input.nudgeDate),
    estimatedDurationMinutes: input.estimatedDurationMinutes,
    remainingEstimateMinutes: input.remainingEstimateMinutes,
    isSplittable: input.isSplittable,
    isSchedulable: input.isSchedulable,
    userPriority: input.userPriority,
    computedPriorityScore: input.computedPriorityScore,
    energyLevel: input.energyLevel,
    workType: input.workType,
    earliestStartDate: isoDateOrNull(input.earliestStartDate),
    preferredWindowStartTime: timeOrNull(input.preferredWindowStartTime),
    preferredWindowEndTime: timeOrNull(input.preferredWindowEndTime),
    confidence: input.confidence,
  };
}

export async function assertProjectRefIsProject(tx: Tx, projectId: string | null | undefined) {
  if (!projectId) return;
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project || project.kind !== "project") {
    throw new DomainInvariantError("Task/Event/Note", [
      "project_id must reference a project (not an area)",
    ]);
  }
}

async function guardedUpdate<T>(
  entity: string,
  id: string,
  revision: number,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "P2025"
    ) {
      throw new RevisionConflictError(entity, `${id} (revision ${revision})`);
    }
    throw error;
  }
}

// --- Task -----------------------------------------------------------------

export async function createTaskDirect(db: PrismaClient, input: TaskCreateInput) {
  return db.$transaction(async (tx) => {
    await assertProjectRefIsProject(tx, input.projectId);
    return tx.task.create({
      data: {
        ...(toTaskData(input) as Prisma.TaskUncheckedCreateInput),
        people: { create: uniquePeople(input.peopleIds).map((personId) => ({ personId })) },
      },
    });
  });
}

export function uniquePeople(peopleIds: string[] | undefined): string[] {
  return [...new Set(peopleIds ?? [])];
}

export async function updateTaskDirect(db: PrismaClient, id: string, input: TaskUpdateInput) {
  return db.$transaction(async (tx) => {
    const current = await tx.task.findUniqueOrThrow({ where: { id } });
    const data = toTaskData(input);
    assertTaskShape({ ...current, ...stripUndefined(data) });
    await assertProjectRefIsProject(tx, input.projectId);
    return guardedUpdate("Task", id, current.revision, () =>
      tx.task.update({ where: { id, revision: current.revision }, data: bumped(data) }),
    );
  });
}

export async function completeTaskDirect(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    const current = await tx.task.findUniqueOrThrow({ where: { id } });
    return guardedUpdate("Task", id, current.revision, () =>
      tx.task.update({
        where: { id, revision: current.revision },
        data: bumped({ status: "completed" as const, completedAt: new Date() }),
      }),
    );
    // Phase 2 adds: complete current block, cancel later planned blocks.
  });
}

export async function uncompleteTaskDirect(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    const current = await tx.task.findUniqueOrThrow({ where: { id } });
    return guardedUpdate("Task", id, current.revision, () =>
      tx.task.update({
        where: { id, revision: current.revision },
        data: bumped({ status: "open" as const, completedAt: null }),
      }),
    );
  });
}

// --- Event ----------------------------------------------------------------

export function toEventData(input: EventUpdateInput) {
  return {
    title: input.title,
    kind: input.kind,
    scheduleType: input.scheduleType,
    taskId: input.taskId,
    blockState: input.blockState,
    isLocked: input.isLocked,
    startAt: dateOrNull(input.startAt),
    endAt: dateOrNull(input.endAt),
    allDayStartDate: isoDateOrNull(input.allDayStartDate),
    allDayEndDate: isoDateOrNull(input.allDayEndDate),
    timezone: input.timezone,
    projectId: input.projectId,
    captureId: input.captureId,
    description: input.description,
    location: input.location,
    notes: input.notes,
  };
}

export async function createEventDirect(db: PrismaClient, input: EventCreateInput) {
  const { peopleIds, ...fields } = input;
  return db.$transaction(async (tx) => {
    await assertProjectRefIsProject(tx, fields.projectId);
    return tx.event.create({
      data: {
        ...(toEventData(fields) as Prisma.EventUncheckedCreateInput),
        people: { create: uniquePeople(peopleIds).map((personId) => ({ personId })) },
      },
    });
  });
}

export async function updateEventDirect(db: PrismaClient, id: string, input: EventUpdateInput) {
  return db.$transaction(async (tx) => {
    const current = await tx.event.findUniqueOrThrow({ where: { id } });
    const data = toEventData(input);
    assertEventShape({ ...current, ...stripUndefined(data) });
    await assertProjectRefIsProject(tx, input.projectId);
    return guardedUpdate("Event", id, current.revision, () =>
      tx.event.update({ where: { id, revision: current.revision }, data: bumped(data) }),
    );
  });
}

// --- Note, Person, Project, Glossary, Settings ----------------------------

export async function createNoteDirect(db: PrismaClient, input: NoteCreateInput) {
  return db.$transaction(async (tx) => {
    await assertProjectRefIsProject(tx, input.projectId);
    return tx.note.create({ data: input });
  });
}

export async function updateNoteDirect(
  db: PrismaClient,
  id: string,
  input: Partial<NoteCreateInput>,
) {
  return db.$transaction(async (tx) => {
    const current = await tx.note.findUniqueOrThrow({ where: { id } });
    await assertProjectRefIsProject(tx, input.projectId);
    return guardedUpdate("Note", id, current.revision, () =>
      tx.note.update({ where: { id, revision: current.revision }, data: bumped(input) }),
    );
  });
}

export async function createPersonDirect(db: PrismaClient, input: PersonCreateInput) {
  const { aliases, ...person } = input;
  return db.person.create({
    data: {
      ...person,
      aliases: {
        create: aliases.map((alias) => ({
          alias,
          normalizedAlias: normalizeLookupKey(alias),
        })),
      },
    },
    include: { aliases: true },
  });
}

export async function updatePersonDirect(
  db: PrismaClient,
  id: string,
  input: { name?: string; role?: string | null; notes?: string | null },
) {
  return db.$transaction(async (tx) => {
    const current = await tx.person.findUniqueOrThrow({ where: { id } });
    return guardedUpdate("Person", id, current.revision, () =>
      tx.person.update({ where: { id, revision: current.revision }, data: bumped(input) }),
    );
  });
}

export async function addPersonAliasDirect(db: PrismaClient, personId: string, alias: string) {
  return db.personAlias.create({
    data: { personId, alias, normalizedAlias: normalizeLookupKey(alias) },
  });
}

export async function createProjectDirect(db: PrismaClient, input: ProjectCreateInput) {
  return db.$transaction(async (tx) => {
    const parent = input.parentId
      ? await tx.project.findUniqueOrThrow({ where: { id: input.parentId } })
      : null;
    assertProjectParent(input.kind, parent);
    assertProjectDomain(input.kind, input.domain);
    return tx.project.create({ data: input });
  });
}

export async function updateProjectDirect(
  db: PrismaClient,
  id: string,
  input: {
    name?: string;
    parentId?: string | null;
    description?: string | null;
    importance?: "low" | "medium" | "high" | null;
    domain?: "work" | "personal" | null;
    status?: "active" | "completed";
  },
) {
  return db.$transaction(async (tx) => {
    const current = await tx.project.findUniqueOrThrow({ where: { id } });
    const nextParentId =
      input.parentId === undefined ? current.parentId : input.parentId;
    const parent = nextParentId
      ? await tx.project.findUniqueOrThrow({ where: { id: nextParentId } })
      : null;
    assertProjectParent(current.kind, parent, id);
    assertProjectDomain(current.kind, input.domain === undefined ? current.domain : input.domain);
    return guardedUpdate("Project", id, current.revision, () =>
      tx.project.update({ where: { id, revision: current.revision }, data: bumped(input) }),
    );
  });
}

export async function upsertGlossaryEntryDirect(
  db: PrismaClient,
  input: GlossaryEntryInput,
  id?: string,
) {
  const data = { ...input, normalizedTerm: normalizeLookupKey(input.term) };
  return db.$transaction(async (tx) => {
    await assertGlossaryTarget(tx, input.entityType ?? null, input.entityId ?? null);
    if (!id) return tx.glossaryEntry.create({ data });
    const current = await tx.glossaryEntry.findUniqueOrThrow({ where: { id } });
    return guardedUpdate("GlossaryEntry", id, current.revision, () =>
      tx.glossaryEntry.update({ where: { id, revision: current.revision }, data: bumped(data) }),
    );
  });
}

/**
 * Finding 18: the glossary's polymorphic (type, id) pair carries no foreign
 * key, so the application verifies that the target row exists in the table
 * the type names before any write. A mismatch (an id that lives in another
 * table) is reported the same way as a missing row.
 */
async function assertGlossaryTarget(
  tx: Prisma.TransactionClient,
  entityType: GlossaryEntryInput["entityType"] | null,
  entityId: string | null,
): Promise<void> {
  if (!entityType || !entityId) return;
  const args = { where: { id: entityId }, select: { id: true } };
  const lookup: Record<string, () => Promise<{ id: string } | null>> = {
    task: () => tx.task.findUnique(args),
    event: () => tx.event.findUnique(args),
    note: () => tx.note.findUnique(args),
    person: () => tx.person.findUnique(args),
    project: () => tx.project.findUnique(args),
  };
  const find = lookup[entityType];
  if (!find) {
    throw new DomainInvariantError("GlossaryEntry", [`${entityType} cannot be a glossary target`]);
  }
  if (!(await find())) {
    throw new DomainInvariantError("GlossaryEntry", [`no ${entityType} exists with id ${entityId}`]);
  }
}

export async function updateSettingsDirect(db: PrismaClient, currentTimezone: string) {
  const settings = await db.userSettings.findFirstOrThrow();
  return db.userSettings.update({
    where: { id: settings.id },
    data: bumped({ currentTimezone }),
  });
}

// --- Archive / restore (soft delete; spec §9.5) ---------------------------

type Archivable = "task" | "event" | "note" | "person" | "project" | "glossaryEntry";

async function setArchived(
  db: PrismaClient,
  entity: Archivable,
  id: string,
  archivedAt: Date | null,
) {
  // Uniform archive behavior across entities; the delegate union is narrow
  // and the payload identical, so one indirection point is acceptable.
  const delegate = db[entity] as unknown as {
    update(args: {
      where: { id: string };
      data: { archivedAt: Date | null; revision: { increment: number } };
    }): Promise<unknown>;
  };
  return delegate.update({ where: { id }, data: bumped({ archivedAt }) });
}

export const archiveEntity = (db: PrismaClient, entity: Archivable, id: string) =>
  setArchived(db, entity, id, new Date());
export const restoreEntity = (db: PrismaClient, entity: Archivable, id: string) =>
  setArchived(db, entity, id, null);

export function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

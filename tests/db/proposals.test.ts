/**
 * Step 8 Proposal-transaction suite (plan test list C): construction and
 * validation, explicit approval, idempotent transactional apply with
 * ActionLog, stale-revision conflicts with zero partial writes,
 * partial-failure rollback, applying-recovery, and conflict-aware
 * (batch) undo including its conflict paths.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPersonAliasDirect, updateTaskDirect } from "@/core/domain/mutations";
import { applyProposal } from "@/core/proposals/apply";
import { buildProposal } from "@/core/proposals/build";
import { ProposalStateError, ProposalValidationError } from "@/core/proposals/errors";
import {
  approveProposal,
  reapproveRecoveredProposal,
  recoverApplyingProposals,
  rejectProposal,
} from "@/core/proposals/lifecycle";
import { buildUndoProposal } from "@/core/proposals/undo";
import type { ActionLog, PrismaClient } from "@/db/generated/client";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;
let areaId: string;
let key = 0;
const nextKey = () => `test-key-${++key}`;

beforeAll(async () => {
  db = await resetTestDatabase();
  const area = await db.project.create({ data: { kind: "area", name: "Undo Area" } });
  areaId = area.id;
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

async function approvedApply(proposalId: string) {
  await approveProposal(db, proposalId);
  return applyProposal(db, proposalId);
}

function actionOf(result: Awaited<ReturnType<typeof applyProposal>>): ActionLog {
  if (result.outcome !== "applied") {
    throw new Error(`expected applied, got ${result.outcome}: ${JSON.stringify(result)}`);
  }
  return result.action;
}

describe("construction and validation", () => {
  it("builds a pending explicit proposal with snapshots and dependencies", async () => {
    const task = await db.task.create({ data: { title: "existing for build" } });
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [
        { op: "create", entityType: "note", after: { body: "first" } },
        {
          op: "update",
          entityType: "task",
          entityId: task.id,
          after: { notes: "linked" },
          dependsOnSequences: [0],
        },
      ],
    });
    expect(proposal.status).toBe("pending");
    expect(proposal.approvalPolicy).toBe("explicit");
    expect(proposal.approvalTier).toBeNull();
    expect(proposal.operations).toHaveLength(2);
    const [create, update] = proposal.operations;
    expect(create.entityId).toMatch(/^[0-9a-f-]{36}$/);
    expect(create.expectedRevision).toBeNull();
    expect(update.expectedRevision).toBe(1);
    expect(update.before).toMatchObject({ title: "existing for build" });
    expect(update.dependsOnOperationIds).toEqual([create.operationId]);
  });

  it("returns the existing proposal for a reused idempotency key", async () => {
    const idempotencyKey = nextKey();
    const first = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey,
      operations: [{ op: "create", entityType: "note", after: { body: "dedupe" } }],
    });
    const second = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey,
      operations: [{ op: "create", entityType: "note", after: { body: "different" } }],
    });
    expect(second.id).toBe(first.id);
    expect(await db.proposal.count({ where: { idempotencyKey } })).toBe(1);
  });

  it("rejects invalid payloads, unknown targets, forward deps, and bad references", async () => {
    await expect(
      buildProposal(db, {
        origin: "inbox",
        idempotencyKey: nextKey(),
        operations: [{ op: "create", entityType: "task", after: { title: "x", taskKind: "waiting_for" } }],
      }),
    ).rejects.toThrow(ProposalValidationError);

    await expect(
      buildProposal(db, {
        origin: "inbox",
        idempotencyKey: nextKey(),
        operations: [
          {
            op: "update",
            entityType: "task",
            entityId: "e9999999-0000-4000-8000-00000000dead",
            after: { title: "ghost" },
          },
        ],
      }),
    ).rejects.toThrow(/unknown task/);

    await expect(
      buildProposal(db, {
        origin: "inbox",
        idempotencyKey: nextKey(),
        operations: [
          { op: "create", entityType: "note", after: { body: "a" }, dependsOnSequences: [1] },
          { op: "create", entityType: "note", after: { body: "b" } },
        ],
      }),
    ).rejects.toThrow(/not an earlier operation/);

    await expect(
      buildProposal(db, {
        origin: "inbox",
        idempotencyKey: nextKey(),
        operations: [
          { op: "create", entityType: "task", after: { title: "bad ref", projectId: areaId } },
        ],
      }),
    ).rejects.toThrow(/must reference an existing project/);
  });
});

describe("lifecycle", () => {
  it("requires approval before apply, and approves only pending proposals", async () => {
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [{ op: "create", entityType: "note", after: { body: "lifecycle" } }],
    });
    await expect(applyProposal(db, proposal.id)).rejects.toThrow(ProposalStateError);
    await approveProposal(db, proposal.id);
    await expect(approveProposal(db, proposal.id)).rejects.toThrow(/Only a pending/);
    const rejected = await rejectProposal(db, proposal.id);
    expect(rejected.status).toBe("rejected");
    await expect(applyProposal(db, proposal.id)).rejects.toThrow(/Only an approved/);
  });

  it("expires an overdue proposal instead of approving it", async () => {
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      expiresAt: new Date(Date.now() - 1000),
      operations: [{ op: "create", entityType: "note", after: { body: "late" } }],
    });
    await expect(approveProposal(db, proposal.id)).rejects.toThrow(/expired/);
    const current = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(current.status).toBe("expired");
  });
});

describe("transactional apply", () => {
  it("applies an ordered batch atomically with an ActionLog and capture resolution", async () => {
    const capture = await db.capture.create({
      data: {
        rawText: "raw",
        redactedText: "redacted",
        sourceType: "pasted",
        processingStatus: "proposed",
      },
    });
    const existingTask = await db.task.create({ data: { title: "gets an update" } });
    const existingNote = await db.note.create({ data: { body: "gets archived" } });

    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      captureId: capture.id,
      operations: [
        {
          op: "create",
          entityType: "project",
          after: { kind: "project", name: "Applied Project", parentId: areaId },
        },
        { op: "create", entityType: "note", after: { body: "applied note" }, dependsOnSequences: [0] },
        {
          op: "update",
          entityType: "task",
          entityId: existingTask.id,
          after: { deadlineDate: "2026-09-20", deadlineType: "soft" },
        },
        { op: "archive", entityType: "note", entityId: existingNote.id },
      ],
    });
    const projectId = proposal.operations[0].entityId;

    const result = actionOf(await approvedApply(proposal.id));

    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.name).toBe("Applied Project");
    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: existingTask.id } });
    expect(updatedTask.deadlineType).toBe("soft");
    expect(updatedTask.revision).toBe(2);
    const archivedNote = await db.note.findUniqueOrThrow({ where: { id: existingNote.id } });
    expect(archivedNote.archivedAt).not.toBeNull();

    const snapshots = result.operations as Array<{ sequence: number; preRevision: number | null; postRevision: number | null }>;
    expect(snapshots.map((s) => s.sequence)).toEqual([0, 1, 2, 3]);
    expect(snapshots[2]).toMatchObject({ preRevision: 1, postRevision: 2 });
    expect(result.idempotencyKey).toBe(proposal.idempotencyKey);

    const resolvedCapture = await db.capture.findUniqueOrThrow({ where: { id: capture.id } });
    expect(resolvedCapture.processingStatus).toBe("processed");
    expect(resolvedCapture.rawDeleteAfter).not.toBeNull();

    const finalStatus = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(finalStatus.status).toBe("applied");
  });

  it("replays idempotently: a second apply returns the original action", async () => {
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [{ op: "create", entityType: "note", after: { body: "once" } }],
    });
    const first = actionOf(await approvedApply(proposal.id));
    const second = actionOf(await applyProposal(db, proposal.id));
    expect(second.id).toBe(first.id);
    expect(await db.actionLog.count({ where: { proposalId: proposal.id } })).toBe(1);
    expect(await db.note.count({ where: { body: "once" } })).toBe(1);
  });

  it("turns a stale expected revision into conflicted with zero partial writes", async () => {
    const task = await db.task.create({ data: { title: "soon stale" } });
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [
        { op: "create", entityType: "note", after: { body: "must not survive" } },
        { op: "update", entityType: "task", entityId: task.id, after: { notes: "stale write" } },
      ],
    });
    await updateTaskDirect(db, task.id, { notes: "someone edited first" });

    const result = await approvedApply(proposal.id);
    expect(result.outcome).toBe("conflicted");

    const current = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(current.status).toBe("conflicted");
    expect(current.conflictDetails).toBeTruthy();
    expect(await db.note.count({ where: { body: "must not survive" } })).toBe(0);
    expect(await db.actionLog.count({ where: { proposalId: proposal.id } })).toBe(0);
    const untouched = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(untouched.notes).toBe("someone edited first");
  });

  it("rolls back completely on a mid-batch execution failure", async () => {
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [
        { op: "create", entityType: "person", after: { name: "Rollback One", aliases: ["dup-alias"] } },
        { op: "create", entityType: "person", after: { name: "Rollback Two", aliases: ["dup-alias"] } },
      ],
    });
    const result = await approvedApply(proposal.id);
    expect(result.outcome).toBe("failed");
    const current = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(current.status).toBe("failed");
    expect(current.failureReason).toBeTruthy();
    expect(await db.person.count({ where: { name: { startsWith: "Rollback" } } })).toBe(0);
    expect(await db.actionLog.count({ where: { proposalId: proposal.id } })).toBe(0);
  });
});

describe("applying recovery", () => {
  it("resolves an interrupted apply through the idempotency key", async () => {
    // Crash before commit: applying, no action.
    const preCommit = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [{ op: "create", entityType: "note", after: { body: "recovered" } }],
    });
    await approveProposal(db, preCommit.id);
    await db.proposal.update({ where: { id: preCommit.id }, data: { status: "applying" } });

    // Crash after commit: applying, action exists.
    const postCommit = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [{ op: "create", entityType: "note", after: { body: "committed" } }],
    });
    actionOf(await approvedApply(postCommit.id));
    await db.proposal.update({ where: { id: postCommit.id }, data: { status: "applying" } });

    const outcomes = await recoverApplyingProposals(db);
    const byId = new Map(outcomes.map((o) => [o.proposalId, o.resolvedTo]));
    expect(byId.get(preCommit.id)).toBe("failed");
    expect(byId.get(postCommit.id)).toBe("applied");

    // The recovery-failed proposal can be re-validated, re-approved, applied.
    const reapproved = await reapproveRecoveredProposal(db, preCommit.id);
    expect(reapproved.status).toBe("approved");
    actionOf(await applyProposal(db, preCommit.id));
    expect(await db.note.count({ where: { body: "recovered" } })).toBe(1);
  });
});

describe("conflict-aware undo", () => {
  it("undoes an applied batch: creates deleted, updates restored, original reverted", async () => {
    const existingTask = await db.task.create({ data: { title: "will be restored" } });
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [
        {
          op: "create",
          entityType: "project",
          after: { kind: "project", name: "Undoable Project", parentId: areaId },
        },
        {
          op: "create",
          entityType: "task",
          after: { title: "undoable task", projectId: undefined },
          dependsOnSequences: [0],
        },
        {
          op: "update",
          entityType: "task",
          entityId: existingTask.id,
          after: { deadlineDate: "2026-09-25", deadlineType: "hard" },
        },
      ],
    });
    const [projectOp, taskOp] = proposal.operations;
    const action = actionOf(await approvedApply(proposal.id));

    const undo = await buildUndoProposal(db, action.id, nextKey());
    expect(undo.status).toBe("pending");
    expect(undo.origin).toBe("user");
    expect(undo.undoesActionId).toBe(action.id);
    expect(undo.operations.map((o) => o.op)).toEqual(["update", "delete", "delete"]);

    const undoAction = actionOf(await approvedApply(undo.id));
    expect(undoAction.revertsActionId).toBe(action.id);

    expect(await db.project.findUnique({ where: { id: projectOp.entityId } })).toBeNull();
    expect(await db.task.findUnique({ where: { id: taskOp.entityId } })).toBeNull();
    const restored = await db.task.findUniqueOrThrow({ where: { id: existingTask.id } });
    expect(restored.deadlineDate).toBeNull();
    expect(restored.deadlineType).toBeNull();
    expect(restored.revision).toBe(3);

    const original = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(original.status).toBe("reverted");

    await expect(buildUndoProposal(db, action.id, nextKey())).rejects.toThrow(/Only an applied/);
  });

  it("a later edit makes the undo proposal conflicted, not destructive", async () => {
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [{ op: "create", entityType: "task", after: { title: "edited after apply" } }],
    });
    const action = actionOf(await approvedApply(proposal.id));
    await updateTaskDirect(db, proposal.operations[0].entityId, { notes: "user touched this" });

    const undo = await buildUndoProposal(db, action.id, nextKey());
    expect(undo.status).toBe("conflicted");
    expect(undo.conflictDetails).toBeTruthy();
    await expect(approveProposal(db, undo.id)).rejects.toThrow(ProposalStateError);
    expect(await db.task.findUnique({ where: { id: proposal.operations[0].entityId } })).not.toBeNull();
  });

  it("acquired dependents (a new alias) block undo of a person create", async () => {
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [
        { op: "create", entityType: "person", after: { name: "Undo Person", aliases: ["UP"] } },
      ],
    });
    const action = actionOf(await approvedApply(proposal.id));
    await addPersonAliasDirect(db, proposal.operations[0].entityId, "Uppy");

    const undo = await buildUndoProposal(db, action.id, nextKey());
    expect(undo.status).toBe("conflicted");
    expect(JSON.stringify(undo.conflictDetails)).toContain("alias");
    expect(await db.person.findUnique({ where: { id: proposal.operations[0].entityId } })).not.toBeNull();
  });

  it("undoes a task created with people links, but not after a link was added", async () => {
    const person = await db.person.create({ data: { name: "Linked Person" } });
    const other = await db.person.create({ data: { name: "Other Person" } });
    const build = () =>
      buildProposal(db, {
        origin: "inbox",
        idempotencyKey: nextKey(),
        operations: [
          { op: "create", entityType: "task", after: { title: "linked task", peopleIds: [person.id] } },
        ],
      });

    const clean = await build();
    const cleanAction = actionOf(await approvedApply(clean.id));
    expect(await db.taskPerson.count({ where: { taskId: clean.operations[0].entityId } })).toBe(1);
    const undo = await buildUndoProposal(db, cleanAction.id, nextKey());
    expect(undo.status).toBe("pending");
    actionOf(await approvedApply(undo.id));
    expect(await db.task.findUnique({ where: { id: clean.operations[0].entityId } })).toBeNull();
    expect(await db.taskPerson.count({ where: { taskId: clean.operations[0].entityId } })).toBe(0);

    const touched = await build();
    const touchedAction = actionOf(await approvedApply(touched.id));
    await db.taskPerson.create({
      data: { taskId: touched.operations[0].entityId, personId: other.id },
    });
    const blocked = await buildUndoProposal(db, touchedAction.id, nextKey());
    expect(blocked.status).toBe("conflicted");
    expect(JSON.stringify(blocked.conflictDetails)).toContain("person link");
  });

  it("batch undo conflicts as a whole: no member is deleted", async () => {
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [
        { op: "create", entityType: "note", after: { body: "batch member one" } },
        { op: "create", entityType: "note", after: { body: "batch member two" } },
      ],
    });
    const [noteOne, noteTwo] = proposal.operations;
    const action = actionOf(await approvedApply(proposal.id));
    await db.note.update({
      where: { id: noteTwo.entityId },
      data: { body: "edited member two", revision: { increment: 1 } },
    });

    const undo = await buildUndoProposal(db, action.id, nextKey());
    expect(undo.status).toBe("conflicted");
    // Nothing was deleted — including the untouched first member.
    expect(await db.note.findUnique({ where: { id: noteOne.entityId } })).not.toBeNull();
    expect(await db.note.findUnique({ where: { id: noteTwo.entityId } })).not.toBeNull();
  });

  it("an undo that races a concurrent edit conflicts at apply with no partial writes", async () => {
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [
        { op: "create", entityType: "note", after: { body: "race one" } },
        { op: "create", entityType: "note", after: { body: "race two" } },
      ],
    });
    const action = actionOf(await approvedApply(proposal.id));
    const undo = await buildUndoProposal(db, action.id, nextKey());
    expect(undo.status).toBe("pending");
    // Edit AFTER the undo was computed but before it is applied. The undo
    // deletes in reverse order, so "race two" (edited) is checked first —
    // but even an edit to the LAST-checked member must roll everything back.
    await db.note.update({
      where: { id: proposal.operations[0].entityId },
      data: { body: "edited during review", revision: { increment: 1 } },
    });
    const result = await approvedApply(undo.id);
    expect(result.outcome).toBe("conflicted");
    expect(await db.note.count({ where: { id: { in: proposal.operations.map((o) => o.entityId) } } })).toBe(2);
    const original = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(original.status).toBe("applied");
  });
});

/**
 * Review-service suite for findings 4/5 (2026-09-05): revising a linked
 * proposal keeps preallocated references valid, refuses dangling references
 * explicitly, and orders by reference regardless of client order.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reviseProposal } from "@/core/captures/review";
import { buildProposal } from "@/core/proposals/build";
import { ProposalStateError } from "@/core/proposals/errors";
import type { PrismaClient } from "@/db/generated/client";
import { newUuid } from "@/lib/ids";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;
let key = 0;
const nextKey = () => `review-${++key}`;

beforeAll(async () => {
  db = await resetTestDatabase();
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

async function linkedBatch() {
  const projectId = newUuid();
  const personId = newUuid();
  return buildProposal(db, {
    origin: "inbox",
    idempotencyKey: nextKey(),
    operations: [
      { op: "create", entityType: "project", entityId: projectId, after: { kind: "project", name: "Copper Kite" } },
      { op: "create", entityType: "person", entityId: personId, after: { name: "Neri Vale", aliases: [] } },
      {
        op: "create",
        entityType: "task",
        after: { title: "order fabric", projectId, peopleIds: [personId] },
        dependsOnSequences: [0, 1],
      },
    ],
  });
}

describe("reviseProposal on linked batches (finding 5)", () => {
  it("a title edit keeps every preallocated reference valid", async () => {
    const proposal = await linkedBatch();
    const [projectOp, personOp, taskOp] = proposal.operations;
    const revised = await reviseProposal(db, proposal.id, [
      { sourceOperationId: projectOp.operationId, entityType: "project", after: { ...(projectOp.after as object), name: "Copper Kite (renamed)" }, dependsOn: [] },
      { sourceOperationId: personOp.operationId, entityType: "person", after: personOp.after, dependsOn: [] },
      { sourceOperationId: taskOp.operationId, entityType: "task", after: taskOp.after, dependsOn: [0, 1] },
    ]);
    expect(revised.supersedesProposalId).toBe(proposal.id);
    const [p, n, t] = revised.operations;
    expect(p.entityId).toBe(projectOp.entityId);
    expect(n.entityId).toBe(personOp.entityId);
    expect(t.entityId).toBe(taskOp.entityId);
    expect((t.after as { projectId: string }).projectId).toBe(projectOp.entityId);
    expect((t.after as { peopleIds: string[] }).peopleIds).toEqual([personOp.entityId]);
    expect((p.after as { name: string }).name).toBe("Copper Kite (renamed)");
  });

  it("removing a referenced item requires explicit resolution", async () => {
    const proposal = await linkedBatch();
    const [, personOp, taskOp] = proposal.operations;
    await expect(
      reviseProposal(db, proposal.id, [
        { sourceOperationId: personOp.operationId, entityType: "person", after: personOp.after, dependsOn: [] },
        { sourceOperationId: taskOp.operationId, entityType: "task", after: taskOp.after, dependsOn: [0] },
      ]),
    ).rejects.toThrow(ProposalStateError);
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("pending");
  });

  it("orders items by reference even when the client sends dependents first", async () => {
    const proposal = await linkedBatch();
    const [projectOp, personOp, taskOp] = proposal.operations;
    const revised = await reviseProposal(db, proposal.id, [
      { sourceOperationId: taskOp.operationId, entityType: "task", after: taskOp.after, dependsOn: [] },
      { sourceOperationId: projectOp.operationId, entityType: "project", after: projectOp.after, dependsOn: [] },
      { sourceOperationId: personOp.operationId, entityType: "person", after: personOp.after, dependsOn: [] },
    ]);
    expect(revised.operations.map((o) => o.entityType)).toEqual(["project", "person", "task"]);
    const task = revised.operations[2];
    expect(task.dependsOnOperationIds).toHaveLength(2);
  });
});

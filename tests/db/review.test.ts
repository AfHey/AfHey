/**
 * Review-service suite for findings 4/5 (2026-09-05): revising a linked
 * proposal keeps preallocated references valid, refuses dangling references
 * explicitly, and orders by reference regardless of client order.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveAndApply, reviseProposal } from "@/core/captures/review";
import { buildProposal } from "@/core/proposals/build";
import { ProposalStateError } from "@/core/proposals/errors";
import { approveProposal } from "@/core/proposals/lifecycle";
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

describe("approveAndApply is retry-safe (finding 4)", () => {
  const noteProposal = () =>
    buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [{ op: "create", entityType: "note", after: { body: "retry me" } }],
    });

  it("a repeated request after a lost response returns the original action", async () => {
    const proposal = await noteProposal();
    const first = await approveAndApply(db, proposal.id);
    const second = await approveAndApply(db, proposal.id);
    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("applied");
    if (first.outcome === "applied" && second.outcome === "applied") {
      expect(second.action.id).toBe(first.action.id);
    }
    expect(await db.actionLog.count({ where: { proposalId: proposal.id } })).toBe(1);
  });

  it("resumes a proposal that was approved but never applied", async () => {
    const proposal = await noteProposal();
    await approveProposal(db, proposal.id);
    const result = await approveAndApply(db, proposal.id);
    expect(result.outcome).toBe("applied");
  });

  it("reports in-flight work instead of failing, and refuses terminal states", async () => {
    const inFlight = await noteProposal();
    await approveProposal(db, inFlight.id);
    await db.proposal.update({ where: { id: inFlight.id }, data: { status: "applying" } });
    expect(await approveAndApply(db, inFlight.id)).toEqual({ outcome: "in_progress" });
    await db.proposal.update({ where: { id: inFlight.id }, data: { status: "rejected" } });
    await expect(approveAndApply(db, inFlight.id)).rejects.toThrow(ProposalStateError);
  });
});

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

  it("carries evidence only for fields the edit left unchanged (finding 17)", async () => {
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [
        { op: "create", entityType: "task", after: { title: "order fabric", deadlineDate: "2026-09-12", deadlineType: "soft" } },
      ],
    });
    const op = proposal.operations[0];
    await db.fieldEvidence.createMany({
      data: [
        { proposalOperationId: op.operationId, fieldPath: "title", startOffset: 0, endOffset: 12, literalText: "order fabric", confidence: "high" },
        { proposalOperationId: op.operationId, fieldPath: "deadline", startOffset: 13, endOffset: 25, literalText: "September 12", confidence: "high" },
      ],
    });
    const revised = await reviseProposal(db, proposal.id, [
      {
        sourceOperationId: op.operationId,
        entityType: "task",
        after: { ...(op.after as object), title: "order fabric samples" },
        dependsOn: [],
      },
    ]);
    const carried = await db.fieldEvidence.findMany({
      where: { proposalOperationId: revised.operations[0].operationId },
    });
    expect(carried.map((r) => r.fieldPath)).toEqual(["deadline"]);
  });

  it("a failure while carrying evidence leaves the original review untouched (finding 7)", async () => {
    const proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: nextKey(),
      operations: [{ op: "create", entityType: "task", after: { title: "atomic" } }],
    });
    const op = proposal.operations[0];
    await db.fieldEvidence.create({
      data: { proposalOperationId: op.operationId, fieldPath: "title", startOffset: 0, endOffset: 6, literalText: "atomic", confidence: "high" },
    });
    // Inject a failure into the evidence copy inside the revision transaction.
    const wrapDelegate = (delegate: object) =>
      new Proxy(delegate, {
        get(d, m) {
          if (m === "createMany") return () => Promise.reject(new Error("injected failure"));
          const v = Reflect.get(d, m);
          return typeof v === "function" ? v.bind(d) : v;
        },
      });
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "$transaction") {
          return (fn: (tx: unknown) => Promise<unknown>) =>
            target.$transaction((tx) =>
              fn(
                new Proxy(tx, {
                  get(t, p) {
                    const v = Reflect.get(t, p);
                    return p === "fieldEvidence" ? wrapDelegate(v as object) : v;
                  },
                }),
              ),
            );
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as PrismaClient;

    await expect(
      reviseProposal(failing, proposal.id, [
        { sourceOperationId: op.operationId, entityType: "task", after: { ...(op.after as object), notes: "changed" }, dependsOn: [] },
      ]),
    ).rejects.toThrow(/injected failure/);
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("pending");
    expect(await db.proposal.count({ where: { supersedesProposalId: proposal.id } })).toBe(0);
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

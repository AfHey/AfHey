/**
 * Transactional apply (spec §11.2 rules 4, 5, 8): ordered execution under
 * row locks with revision rechecks, the immutable ActionLog row committed in
 * the same PostgreSQL transaction as every domain mutation, idempotent
 * replay by key, and conflict/failure statuses recorded reliably after
 * rollback. `applying` exists only between the approval CAS and commit.
 */
import { DomainInvariantError } from "@/core/domain/invariants";
import { retentionDeadline } from "@/core/captures/service";
import { newUuid } from "@/lib/ids";
import type { ActionLog, Prisma, PrismaClient } from "@/db/generated/client";
import { ProposalConflictError, ProposalStateError, type ConflictDetail } from "./errors";
import {
  executeCreate,
  executeDelete,
  executeSetArchived,
  executeUpdate,
} from "./executors";
import { deleteManifestSchema, parseOperationPayload } from "./payloads";

export interface OperationSnapshot {
  operationId: string;
  sequence: number;
  op: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  preRevision: number | null;
  postRevision: number | null;
  reason: string | null;
}

export type ApplyResult =
  | { outcome: "applied"; action: ActionLog }
  | { outcome: "conflicted"; details: ConflictDetail[] }
  | { outcome: "failed"; reason: string };

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function applyProposal(db: PrismaClient, proposalId: string): Promise<ApplyResult> {
  const proposal = await db.proposal.findUniqueOrThrow({
    where: { id: proposalId },
    include: { operations: { orderBy: { sequence: "asc" } } },
  });

  // Idempotent replay: an already-consumed key returns the original result.
  if (proposal.status === "applied") {
    const action = await db.actionLog.findUniqueOrThrow({ where: { proposalId } });
    return { outcome: "applied", action };
  }
  if (proposal.status === "applying") {
    throw new ProposalStateError("This proposal is already being applied");
  }
  if (proposal.status !== "approved") {
    throw new ProposalStateError(`Only an approved proposal can be applied (status: ${proposal.status})`);
  }
  if (proposal.expiresAt !== null && proposal.expiresAt.getTime() <= Date.now()) {
    await db.proposal.update({
      where: { id: proposalId },
      data: { status: "expired", revision: { increment: 1 } },
    });
    throw new ProposalStateError("This proposal expired before it was applied");
  }

  // Take the applying window via CAS so double-clicks cannot race.
  const taken = await db.proposal.updateMany({
    where: { id: proposalId, status: "approved" },
    data: { status: "applying", revision: { increment: 1 } },
  });
  if (taken.count !== 1) {
    const current = await db.proposal.findUniqueOrThrow({ where: { id: proposalId } });
    if (current.status === "applied") {
      const action = await db.actionLog.findUniqueOrThrow({ where: { proposalId } });
      return { outcome: "applied", action };
    }
    throw new ProposalStateError(`Proposal is no longer applicable (status: ${current.status})`);
  }

  try {
    const action = await db.$transaction(async (tx) => {
      const opIds = new Set<string>();
      const snapshots: OperationSnapshot[] = [];

      for (const op of proposal.operations) {
        for (const dep of op.dependsOnOperationIds) {
          if (!opIds.has(dep)) {
            throw new ProposalConflictError([
              { operationId: op.operationId, reason: "operation dependency is not an earlier operation" },
            ]);
          }
        }

        const payload = parseOperationPayload(op.op, op.entityType, op.after);
        let preRevision: number | null = op.expectedRevision;
        let postRevision: number | null = null;

        switch (op.op) {
          case "create":
            await executeCreate(tx, op.entityType, op.entityId, payload);
            preRevision = null;
            postRevision = 1;
            break;
          case "update":
            await executeUpdate(tx, op.entityType, op.entityId, op.expectedRevision!, payload);
            postRevision = op.expectedRevision! + 1;
            break;
          case "archive":
            await executeSetArchived(tx, op.entityType, op.entityId, op.expectedRevision!, true);
            postRevision = op.expectedRevision! + 1;
            break;
          case "restore":
            await executeSetArchived(tx, op.entityType, op.entityId, op.expectedRevision!, false);
            postRevision = op.expectedRevision! + 1;
            break;
          case "delete": {
            const manifest = deleteManifestSchema.parse(op.after ?? undefined);
            await executeDelete(
              tx,
              op.entityType,
              op.entityId,
              op.expectedRevision!,
              manifest ?? { aliases: [], peopleIds: [] },
            );
            postRevision = null;
            break;
          }
        }

        opIds.add(op.operationId);
        snapshots.push({
          operationId: op.operationId,
          sequence: op.sequence,
          op: op.op,
          entityType: op.entityType,
          entityId: op.entityId,
          before: op.before ?? null,
          after: op.after ?? null,
          preRevision,
          postRevision,
          reason: op.reason,
        });
      }

      // Inbox linkage: successful processing resolves the Capture and starts
      // its retention clock (spec §9.5).
      if (proposal.captureId) {
        const capture = await tx.capture.findUniqueOrThrow({ where: { id: proposal.captureId } });
        if (capture.processingStatus === "proposed" || capture.processingStatus === "redacted") {
          await tx.capture.update({
            where: { id: capture.id },
            data: {
              processingStatus: "processed",
              rawDeleteAfter: retentionDeadline(),
              revision: { increment: 1 },
            },
          });
        }
      }

      // Undo linkage: only a still-applied original can be reverted (rule 9).
      if (proposal.undoesActionId) {
        const original = await tx.actionLog.findUniqueOrThrow({
          where: { id: proposal.undoesActionId },
        });
        const reverted = await tx.proposal.updateMany({
          where: { id: original.proposalId, status: "applied" },
          data: { status: "reverted", revision: { increment: 1 } },
        });
        if (reverted.count !== 1) {
          throw new ProposalConflictError([
            { reason: "the original proposal is no longer in applied state (already reverted?)" },
          ]);
        }
      }

      const created = await tx.actionLog.create({
        data: {
          id: newUuid(),
          proposalId: proposal.id,
          origin: proposal.origin,
          appliedAt: new Date(),
          operations: toJson(snapshots),
          idempotencyKey: proposal.idempotencyKey,
          revertsActionId: proposal.undoesActionId ?? null,
        },
      });
      await tx.proposal.update({
        where: { id: proposal.id },
        data: { status: "applied", appliedAt: created.appliedAt, revision: { increment: 1 } },
      });
      return created;
    });
    return { outcome: "applied", action };
  } catch (error) {
    if (error instanceof ProposalConflictError || error instanceof DomainInvariantError) {
      const details: ConflictDetail[] =
        error instanceof ProposalConflictError
          ? error.details
          : error.violations.map((reason) => ({ reason }));
      await db.proposal.update({
        where: { id: proposal.id },
        data: { status: "conflicted", conflictDetails: toJson(details), revision: { increment: 1 } },
      });
      return { outcome: "conflicted", details };
    }
    const reason = error instanceof Error ? error.message : "unknown apply error";
    await db.proposal.update({
      where: { id: proposal.id },
      data: { status: "failed", failureReason: reason, revision: { increment: 1 } },
    });
    return { outcome: "failed", reason };
  }
}

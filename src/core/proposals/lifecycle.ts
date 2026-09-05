/**
 * Proposal lifecycle transitions outside apply: explicit approval (the only
 * Phase 1 policy), rejection, expiry, and `applying` crash recovery resolved
 * through the idempotency key (spec §11.1).
 */
import type { PrismaClient, Proposal } from "@/db/generated/client";
import { ProposalStateError } from "./errors";

export const RECOVERY_NOTE_PREFIX = "recovered after interrupted apply:";

async function expireIfDue(db: PrismaClient, proposal: Proposal): Promise<Proposal> {
  if (
    (proposal.status === "pending" || proposal.status === "approved") &&
    proposal.expiresAt !== null &&
    proposal.expiresAt.getTime() <= Date.now()
  ) {
    return db.proposal.update({
      where: { id: proposal.id },
      data: { status: "expired", revision: { increment: 1 } },
    });
  }
  return proposal;
}

export async function approveProposal(db: PrismaClient, id: string): Promise<Proposal> {
  const proposal = await db.proposal.findUniqueOrThrow({ where: { id } });
  const current = await expireIfDue(db, proposal);
  if (current.status === "expired") {
    throw new ProposalStateError("This proposal expired before it was approved");
  }
  if (current.status !== "pending") {
    throw new ProposalStateError(`Only a pending proposal can be approved (status: ${current.status})`);
  }
  const updated = await db.proposal.updateMany({
    where: { id, status: "pending" },
    data: { status: "approved", approvedAt: new Date(), revision: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw new ProposalStateError("The proposal changed while approving; reload and retry");
  }
  return db.proposal.findUniqueOrThrow({ where: { id } });
}

export async function rejectProposal(db: PrismaClient, id: string): Promise<Proposal> {
  const updated = await db.proposal.updateMany({
    where: { id, status: { in: ["pending", "approved"] } },
    data: { status: "rejected", revision: { increment: 1 } },
  });
  if (updated.count !== 1) {
    const current = await db.proposal.findUniqueOrThrow({ where: { id } });
    throw new ProposalStateError(`Only a pending or approved proposal can be rejected (status: ${current.status})`);
  }
  return db.proposal.findUniqueOrThrow({ where: { id } });
}

export interface RecoveryOutcome {
  proposalId: string;
  resolvedTo: "applied" | "failed";
}

/**
 * Execution lease (finding 3, 2026-09-05): the CAS into `applying` stamps
 * updatedAt; a worker's apply transaction finishes within seconds (the
 * interactive-transaction timeout is 5s), so an `applying` row older than
 * this lease belongs to an interrupted worker, never to an active one.
 */
export const APPLY_LEASE_MS = 2 * 60 * 1000;

/**
 * Recovery: any proposal stuck in `applying` past its lease either committed
 * its ActionLog (→ applied) or did not (→ failed with a recovery note,
 * eligible for re-approval). Rows inside the lease are left to their worker.
 * Runs on Inbox load and from the maintenance job.
 */
export async function recoverApplyingProposals(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<RecoveryOutcome[]> {
  const stuck = await db.proposal.findMany({
    where: { status: "applying", updatedAt: { lt: new Date(now.getTime() - APPLY_LEASE_MS) } },
  });
  const outcomes: RecoveryOutcome[] = [];
  for (const proposal of stuck) {
    const action = await db.actionLog.findUnique({ where: { proposalId: proposal.id } });
    if (action) {
      await db.proposal.update({
        where: { id: proposal.id },
        data: { status: "applied", appliedAt: action.appliedAt, revision: { increment: 1 } },
      });
      outcomes.push({ proposalId: proposal.id, resolvedTo: "applied" });
    } else {
      await db.proposal.update({
        where: { id: proposal.id },
        data: {
          status: "failed",
          failureReason: `${RECOVERY_NOTE_PREFIX} no action was recorded; re-validate and re-approve`,
          revision: { increment: 1 },
        },
      });
      outcomes.push({ proposalId: proposal.id, resolvedTo: "failed" });
    }
  }
  return outcomes;
}

/**
 * Re-approval path for recovery-failed proposals only (spec §11.1): verifies
 * every expected revision still holds, then returns the proposal to
 * `approved` for a fresh apply.
 */
export async function reapproveRecoveredProposal(db: PrismaClient, id: string): Promise<Proposal> {
  const proposal = await db.proposal.findUniqueOrThrow({
    where: { id },
    include: { operations: true },
  });
  if (proposal.status !== "failed" || !proposal.failureReason?.startsWith(RECOVERY_NOTE_PREFIX)) {
    throw new ProposalStateError("Only a recovery-failed proposal can be re-approved");
  }
  for (const op of proposal.operations) {
    if (op.expectedRevision === null) continue;
    const row = await (
      db[op.entityType] as unknown as {
        findUnique(args: { where: { id: string } }): Promise<{ revision: number } | null>;
      }
    ).findUnique({ where: { id: op.entityId } });
    if (!row || row.revision !== op.expectedRevision) {
      throw new ProposalStateError(
        `Cannot re-approve: ${op.entityType} ${op.entityId} changed since the proposal was computed`,
      );
    }
  }
  return db.proposal.update({
    where: { id },
    data: {
      status: "approved",
      approvedAt: new Date(),
      failureReason: null,
      revision: { increment: 1 },
    },
  });
}

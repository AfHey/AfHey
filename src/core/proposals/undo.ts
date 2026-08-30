/**
 * Conflict-aware undo (spec §11.2 rules 9-10): a NEW Proposal computed from
 * the original Action's snapshots — never blind inverse replay. Expected
 * revisions are the original post-apply revisions; acquired dependents and
 * later edits surface as a `conflicted` proposal with reviewable details,
 * and no batch member is ever silently deleted.
 */
import { normalizeLookupKey } from "@/core/domain/normalize";
import type { EntityType } from "@/core/domain/enums";
import type { PrismaClient } from "@/db/generated/client";
import type { OperationSnapshot } from "./apply";
import { buildProposal, type DraftOperation, type ProposalWithOperations } from "./build";
import { ProposalStateError, ProposalValidationError } from "./errors";
import { snapshotValueToDto } from "./payloads";

function undoPatchFrom(
  entityType: EntityType,
  originalPatch: Record<string, unknown>,
  beforeRow: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(originalPatch)) {
    patch[key] = snapshotValueToDto(entityType, key, beforeRow[key] ?? null);
  }
  return patch;
}

export async function buildUndoProposal(
  db: PrismaClient,
  actionId: string,
  idempotencyKey: string,
): Promise<ProposalWithOperations> {
  const action = await db.actionLog.findUniqueOrThrow({
    where: { id: actionId },
    include: { proposal: true },
  });
  if (action.proposal.status !== "applied") {
    throw new ProposalStateError(
      `Only an applied proposal can be undone (status: ${action.proposal.status})`,
    );
  }

  const snapshots = action.operations as unknown as OperationSnapshot[];
  const operations: DraftOperation[] = [];

  for (const snapshot of [...snapshots].reverse()) {
    const entityType = snapshot.entityType as EntityType;
    const base = {
      entityType,
      entityId: snapshot.entityId,
      dependsOnSequences: operations.length > 0 ? [operations.length - 1] : [],
      reason: `undo of ${snapshot.op} (action ${actionId})`,
    };
    switch (snapshot.op) {
      case "create": {
        const aliases =
          entityType === "person"
            ? ((snapshot.after as { aliases?: string[] })?.aliases ?? []).map(normalizeLookupKey)
            : [];
        operations.push({
          ...base,
          op: "delete",
          after: entityType === "person" ? { aliases } : undefined,
          expectedRevisionOverride: snapshot.postRevision ?? 1,
        });
        break;
      }
      case "update":
        operations.push({
          ...base,
          op: "update",
          after: undoPatchFrom(
            entityType,
            (snapshot.after ?? {}) as Record<string, unknown>,
            (snapshot.before ?? {}) as Record<string, unknown>,
          ),
          expectedRevisionOverride: snapshot.postRevision ?? undefined,
        });
        break;
      case "archive":
        operations.push({
          ...base,
          op: "restore",
          expectedRevisionOverride: snapshot.postRevision ?? undefined,
        });
        break;
      case "restore":
        operations.push({
          ...base,
          op: "archive",
          expectedRevisionOverride: snapshot.postRevision ?? undefined,
        });
        break;
      case "delete":
        throw new ProposalValidationError([
          "undoing a proposal that contains delete operations (an undo of an undo) is not supported in V1",
        ]);
      default:
        throw new ProposalValidationError([`unknown snapshot operation: ${snapshot.op}`]);
    }
  }

  return buildProposal(db, {
    origin: "user",
    idempotencyKey,
    undoesActionId: actionId,
    operations,
    conflictPolicy: "persist",
  });
}

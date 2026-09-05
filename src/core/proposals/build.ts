/**
 * Proposal construction (spec §11.2 rule 3): trusted code preallocates final
 * entity and operation UUIDs, captures `before` snapshots and expected
 * revisions, validates payload schemas, references, and the dependency
 * graph, and persists the Proposal atomically. Phase 1 policy is always
 * `explicit` with a null tier (rule 7).
 */
import type { EntityType, OperationType, ProposalOrigin } from "@/core/domain/enums";
import { newUuid } from "@/lib/ids";
import type { Prisma, PrismaClient, Proposal, ProposalOperation } from "@/db/generated/client";
import { ProposalStateError, ProposalValidationError, type ConflictDetail } from "./errors";
import { collectDeleteBlockers } from "./executors";
import { deleteManifestSchema, parseOperationPayload } from "./payloads";

export interface DraftOperation {
  op: OperationType;
  entityType: EntityType;
  /** Required for non-creates; optional preallocated UUID for creates. */
  entityId?: string;
  after?: unknown;
  reason?: string;
  /** Indices (sequence numbers) of earlier operations this one depends on. */
  dependsOnSequences?: number[];
  /**
   * Undo only: require this exact current revision instead of snapshotting
   * whatever revision the entity has now (spec §11.2 rule 9).
   */
  expectedRevisionOverride?: number;
}

export interface ProposalDraft {
  origin: ProposalOrigin;
  idempotencyKey: string;
  operations: DraftOperation[];
  captureId?: string;
  expiresAt?: Date;
  undoesActionId?: string;
  supersedesProposalId?: string;
  /**
   * "throw" (default) rejects a draft whose preconditions already fail;
   * "persist" stores it as `conflicted` with reviewable details — the
   * behavior undo requires (rule 9: the undo Proposal is conflicted, nothing
   * is silently dropped).
   */
  conflictPolicy?: "throw" | "persist";
}

export type ProposalWithOperations = Proposal & { operations: ProposalOperation[] };

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

interface PendingCreate {
  entityType: EntityType;
  kind?: "area" | "project";
}

type RefWant = "project" | "area" | "person" | "capture";

function referencesOf(
  op: OperationType,
  entityType: EntityType,
  payload: unknown,
): Array<{ field: string; id: string; want: RefWant }> {
  if (op !== "create" && op !== "update") return [];
  const p = payload as Record<string, unknown>;
  const refs: Array<{ field: string; id: string; want: RefWant }> = [];
  if (entityType === "task" || entityType === "event" || entityType === "note") {
    if (typeof p.projectId === "string") refs.push({ field: "projectId", id: p.projectId, want: "project" });
    if (typeof p.captureId === "string") refs.push({ field: "captureId", id: p.captureId, want: "capture" });
  }
  if (entityType === "task" && typeof p.waitingForPersonId === "string") {
    refs.push({ field: "waitingForPersonId", id: p.waitingForPersonId, want: "person" });
  }
  if (entityType === "task" && op === "create" && Array.isArray(p.peopleIds)) {
    for (const id of p.peopleIds) {
      if (typeof id === "string") refs.push({ field: "peopleIds", id, want: "person" });
    }
  }
  if (entityType === "project" && typeof p.parentId === "string") {
    refs.push({ field: "parentId", id: p.parentId, want: "area" });
  }
  return refs;
}

export async function buildProposal(
  db: PrismaClient,
  draft: ProposalDraft,
): Promise<ProposalWithOperations> {
  const existing = await db.proposal.findUnique({
    where: { idempotencyKey: draft.idempotencyKey },
    include: { operations: { orderBy: { sequence: "asc" } } },
  });
  if (existing) return existing;

  const problems: string[] = [];
  const preconditionConflicts: ConflictDetail[] = [];
  if (draft.operations.length === 0) {
    throw new ProposalValidationError(["a proposal needs at least one operation"]);
  }

  const pendingCreates = new Map<string, PendingCreate>();
  const prepared: Array<{
    operationId: string;
    sequence: number;
    op: OperationType;
    entityType: EntityType;
    entityId: string;
    after: unknown;
    before: unknown;
    expectedRevision: number | null;
    reason: string | null;
    dependsOnSequences: number[];
  }> = [];

  for (const [index, op] of draft.operations.entries()) {
    for (const dep of op.dependsOnSequences ?? []) {
      if (dep < 0 || dep >= index) {
        problems.push(`operation ${index} depends on ${dep}, which is not an earlier operation`);
      }
    }

    let payload: unknown;
    try {
      payload = parseOperationPayload(op.op, op.entityType, op.after);
    } catch (error) {
      problems.push(
        `operation ${index} (${op.op} ${op.entityType}): ${
          error instanceof Error ? error.message : "invalid payload"
        }`,
      );
      continue;
    }

    let entityId = op.entityId;
    let before: unknown = null;
    let expectedRevision: number | null = null;

    if (op.op === "create") {
      entityId ??= newUuid();
      if (pendingCreates.has(entityId)) {
        problems.push(`operation ${index} reuses a preallocated create id`);
      }
      const kind =
        op.entityType === "project"
          ? ((payload as { kind: "area" | "project" }).kind ?? undefined)
          : undefined;
      pendingCreates.set(entityId, { entityType: op.entityType, kind });
    } else {
      if (!entityId) {
        problems.push(`operation ${index} (${op.op}) needs an entityId`);
        continue;
      }
      const row = await (
        db[op.entityType] as unknown as {
          findUnique(args: { where: { id: string } }): Promise<{ revision: number } | null>;
        }
      ).findUnique({ where: { id: entityId } });
      if (!row) {
        problems.push(`operation ${index} targets unknown ${op.entityType} ${entityId}`);
        continue;
      }
      before = row;
      expectedRevision = op.expectedRevisionOverride ?? row.revision;
      if (op.expectedRevisionOverride !== undefined && row.revision !== op.expectedRevisionOverride) {
        preconditionConflicts.push({
          entityType: op.entityType,
          entityId,
          reason: "entity was modified after the original apply",
          expectedRevision: op.expectedRevisionOverride,
          actualRevision: row.revision,
        });
      }
      if (op.op === "delete") {
        const manifest = deleteManifestSchema.parse(op.after ?? undefined);
        const blockers = await collectDeleteBlockers(
          db as never,
          op.entityType,
          entityId,
          manifest ?? { aliases: [], peopleIds: [] },
        );
        for (const blocker of blockers) {
          preconditionConflicts.push({ entityType: op.entityType, entityId, reason: blocker });
        }
      }
    }

    // Reference validation: an id must exist (with the right kind) or be
    // created by an earlier operation in this proposal.
    for (const ref of referencesOf(op.op, op.entityType, payload)) {
      const pending = pendingCreates.get(ref.id);
      if (pending && ref.id !== entityId) {
        const pendingKind = pending.kind;
        const okType =
          ref.want === "person"
            ? pending.entityType === "person"
            : pending.entityType === "project" && (pendingKind === undefined || pendingKind === ref.want);
        if (!okType) {
          problems.push(`operation ${index}: ${ref.field} refers to a pending create of the wrong type`);
        }
        continue;
      }
      if (ref.want === "person") {
        const person = await db.person.findUnique({ where: { id: ref.id } });
        if (!person) problems.push(`operation ${index}: ${ref.field} refers to unknown person ${ref.id}`);
      } else if (ref.want === "capture") {
        const capture = await db.capture.findUnique({ where: { id: ref.id } });
        if (!capture) problems.push(`operation ${index}: ${ref.field} refers to unknown capture ${ref.id}`);
      } else {
        const project = await db.project.findUnique({ where: { id: ref.id } });
        if (!project || project.kind !== ref.want) {
          problems.push(`operation ${index}: ${ref.field} must reference an existing ${ref.want}`);
        }
      }
    }

    prepared.push({
      operationId: newUuid(),
      sequence: index,
      op: op.op,
      entityType: op.entityType,
      entityId: entityId ?? newUuid(),
      after: op.op === "create" || op.op === "update" || op.op === "delete" ? op.after ?? null : null,
      before,
      expectedRevision,
      reason: op.reason ?? null,
      dependsOnSequences: op.dependsOnSequences ?? [],
    });
  }

  if (problems.length > 0) throw new ProposalValidationError(problems);

  const conflicted = preconditionConflicts.length > 0;
  if (conflicted && draft.conflictPolicy !== "persist") {
    throw new ProposalValidationError(preconditionConflicts.map((c) => c.reason));
  }

  const idBySequence = new Map(prepared.map((p) => [p.sequence, p.operationId]));

  return db.$transaction(async (tx) => {
    if (draft.supersedesProposalId) {
      const updated = await tx.proposal.updateMany({
        where: {
          id: draft.supersedesProposalId,
          status: { in: ["pending", "approved", "conflicted", "failed"] },
        },
        data: { status: "superseded", revision: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new ProposalStateError("the proposal being superseded is not editable");
      }
    }
    return tx.proposal.create({
      data: {
        origin: draft.origin,
        idempotencyKey: draft.idempotencyKey,
        approvalPolicy: "explicit",
        approvalTier: null,
        status: conflicted ? "conflicted" : "pending",
        conflictDetails: conflicted ? toJson(preconditionConflicts) : undefined,
        captureId: draft.captureId ?? null,
        expiresAt: draft.expiresAt ?? null,
        undoesActionId: draft.undoesActionId ?? null,
        supersedesProposalId: draft.supersedesProposalId ?? null,
        operations: {
          create: prepared.map((p) => ({
            operationId: p.operationId,
            sequence: p.sequence,
            op: p.op,
            entityType: p.entityType,
            entityId: p.entityId,
            expectedRevision: p.expectedRevision,
            after: p.after === null ? undefined : toJson(p.after),
            before: p.before === null ? undefined : toJson(p.before),
            reason: p.reason,
            dependsOnOperationIds: p.dependsOnSequences.map((s) => {
              const id = idBySequence.get(s);
              if (!id) throw new ProposalValidationError([`unknown dependency sequence ${s}`]);
              return id;
            }),
          })),
        },
      },
      include: { operations: { orderBy: { sequence: "asc" } } },
    });
  });
}

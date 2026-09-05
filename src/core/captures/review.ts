/**
 * Inbox review service (spec §3, §11.2 rules 6-7, 10): the user-facing
 * composition over the capture service, the interpretation pipeline, and
 * the Proposal engine. Every AI-originated change still flows through
 * explicit approval; editing supersedes; rejection resolves the Capture per
 * the 2026-08-30 "Capture rejected status" decision.
 */
import type { ExtractionProvider } from "@/ai/adapters/types";
import type { CaptureSourceType, EntityType } from "@/core/domain/enums";
import { EVIDENCE_FIELD_KEYS } from "@/core/interpretation/evidence-fields";
import { loadLexicon } from "@/core/resolution/lexicon";
import { prepareProviderPayload, type PreparedPayload } from "@/core/resolution/resolve";
import { applyProposal, type ApplyResult } from "@/core/proposals/apply";
import { buildProposal, type DraftOperation, type ProposalWithOperations } from "@/core/proposals/build";
import { ProposalStateError } from "@/core/proposals/errors";
import { approveProposal, rejectProposal } from "@/core/proposals/lifecycle";
import { buildUndoProposal } from "@/core/proposals/undo";
import { newUuid } from "@/lib/ids";
import type { Capture, Note, PrismaClient } from "@/db/generated/client";
import { processCaptureWithExtraction, type ExtractionOutcome } from "./extract";
import { createCapture, processCaptureNoAi, rejectCapture } from "./service";

export interface PreviewMention {
  placeholder: string;
  entityType: "person" | "project";
  candidates: Array<{ id: string; name: string }>;
  confidence: string;
}

export interface CapturePreview {
  payloadText: string;
  redactions: PreparedPayload["redactions"];
  mentions: PreviewMention[];
}

async function describeMentions(
  db: PrismaClient,
  prepared: PreparedPayload,
): Promise<PreviewMention[]> {
  const personIds = prepared.mentions.filter((m) => m.entityType === "person").flatMap((m) => m.candidateIds);
  const projectIds = prepared.mentions.filter((m) => m.entityType === "project").flatMap((m) => m.candidateIds);
  const [people, projects] = await Promise.all([
    db.person.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true } }),
    db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...people, ...projects].map((r) => [r.id, r.name]));
  return prepared.mentions.map((m) => ({
    placeholder: m.placeholder,
    entityType: m.entityType,
    candidates: m.candidateIds.map((id) => ({ id, name: names.get(id) ?? "unknown" })),
    confidence: m.confidence,
  }));
}

export type SubmitOutcome =
  | { mode: "preview"; capture: Capture; preview: CapturePreview }
  | { mode: "no_ai"; capture: Capture; note: Note };

/** Capture on receipt; either the no-AI note path or a redaction preview. */
export async function submitCapture(
  db: PrismaClient,
  input: { text: string; sourceType: CaptureSourceType; noAi: boolean },
): Promise<SubmitOutcome> {
  const capture = await createCapture(db, { text: input.text, sourceType: input.sourceType });
  if (input.noAi) {
    const result = await processCaptureNoAi(db, capture.id);
    return { mode: "no_ai", capture: result.capture, note: result.note };
  }
  const prepared = prepareProviderPayload(input.text, await loadLexicon(db));
  return {
    mode: "preview",
    capture,
    preview: {
      payloadText: prepared.payloadText,
      redactions: prepared.redactions,
      mentions: await describeMentions(db, prepared),
    },
  };
}

export async function extractCapture(
  db: PrismaClient,
  captureId: string,
  provider: ExtractionProvider,
  editedPayloadText?: string,
): Promise<ExtractionOutcome> {
  return processCaptureWithExtraction(db, captureId, provider, { editedPayloadText });
}

export type ReviewApplyResult = ApplyResult | { outcome: "in_progress" };

/**
 * "Accept all": explicit approval immediately followed by transactional
 * apply — idempotent end to end (finding 4). A retry after a lost response
 * returns the original Action; a proposal already approved (interrupted
 * between approval and apply) resumes; work still inside its apply window
 * is reported as in progress rather than failing.
 */
export async function approveAndApply(db: PrismaClient, proposalId: string): Promise<ReviewApplyResult> {
  const current = await db.proposal.findUniqueOrThrow({ where: { id: proposalId } });
  switch (current.status) {
    case "pending":
      await approveProposal(db, proposalId);
      return applyProposal(db, proposalId);
    case "approved":
    case "applied":
      return applyProposal(db, proposalId);
    case "applying":
      return { outcome: "in_progress" };
    default:
      throw new ProposalStateError(`This review can no longer be applied (status: ${current.status})`);
  }
}

/** "Reject all": refuses the proposal and, unless re-extraction is wanted, the Capture. */
export async function rejectReview(
  db: PrismaClient,
  proposalId: string,
  options: { rejectCapture: boolean },
) {
  const proposal = await rejectProposal(db, proposalId);
  if (options.rejectCapture && proposal.captureId) {
    const capture = await db.capture.findUniqueOrThrow({ where: { id: proposal.captureId } });
    if (!["processed", "no_ai", "rejected"].includes(capture.processingStatus)) {
      await rejectCapture(db, capture.id);
    }
  }
  return proposal;
}

/** Discards a capture the user declined before or without extraction. */
export async function discardCapture(db: PrismaClient, captureId: string) {
  await db.proposal.updateMany({
    where: { captureId, status: { in: ["pending", "approved"] } },
    data: { status: "rejected", revision: { increment: 1 } },
  });
  return rejectCapture(db, captureId);
}

export interface EditedOperation {
  /** Operation of the current proposal this edit derives from, for evidence carry-over. */
  sourceOperationId?: string;
  entityType: EntityType;
  after: unknown;
  /** Indices into the edited list this operation depends on. */
  dependsOn: number[];
}

/**
 * Review edits (spec §11.2 rule 6): any edit produces a new validated
 * Proposal that supersedes the current one; prior approval never carries
 * over. Field evidence follows the operation it explained.
 */
export async function reviseProposal(
  db: PrismaClient,
  proposalId: string,
  edits: EditedOperation[],
): Promise<ProposalWithOperations> {
  const current = await db.proposal.findUniqueOrThrow({
    where: { id: proposalId },
    include: { operations: true },
  });
  if (!["pending", "approved", "conflicted", "failed"].includes(current.status)) {
    throw new ProposalStateError(`A ${current.status} proposal cannot be edited`);
  }
  if (edits.length === 0) throw new ProposalStateError("Remove the whole proposal by rejecting it instead");
  const sourceById = new Map(current.operations.map((o) => [o.operationId, o]));

  // Finding 5 (2026-09-05): edited creates keep their preallocated entity
  // ids so references between items stay valid; references to an item the
  // user removed must be resolved explicitly rather than silently dropped.
  const keptSourceIds = new Set(edits.map((e) => e.sourceOperationId).filter(Boolean));
  const removedEntityIds = new Set(
    current.operations.filter((o) => !keptSourceIds.has(o.operationId)).map((o) => o.entityId),
  );
  const referencedIds = (after: unknown): string[] => {
    const a = (after ?? {}) as Record<string, unknown>;
    return [a.projectId, a.waitingForPersonId, ...(Array.isArray(a.peopleIds) ? a.peopleIds : [])].filter(
      (v): v is string => typeof v === "string",
    );
  };
  for (const edit of edits) {
    const dangling = referencedIds(edit.after).filter((id) => removedEntityIds.has(id));
    if (dangling.length > 0) {
      const title = String((edit.after as { title?: string; name?: string; body?: string })?.title ?? (edit.after as { name?: string })?.name ?? "an item");
      throw new ProposalStateError(
        `"${title}" still refers to an item you removed; change or remove it first`,
      );
    }
  }

  // Order edits so every referenced create comes first (references imply
  // dependencies regardless of the order the client sent).
  const entityIdOf = (edit: EditedOperation) =>
    edit.sourceOperationId ? sourceById.get(edit.sourceOperationId)?.entityId : undefined;
  const indexByEntityId = new Map<string, number>();
  edits.forEach((edit, i) => {
    const id = entityIdOf(edit);
    if (id) indexByEntityId.set(id, i);
  });
  const deps = edits.map((edit, i) => {
    const derived = referencedIds(edit.after)
      .map((id) => indexByEntityId.get(id))
      .filter((j): j is number => j !== undefined && j !== i);
    return new Set([...edit.dependsOn, ...derived]);
  });
  const ordered: number[] = [];
  const placed = new Set<number>();
  while (ordered.length < edits.length) {
    const next = edits.findIndex((_, i) => !placed.has(i) && [...deps[i]].every((d) => placed.has(d)));
    if (next === -1) throw new ProposalStateError("Items reference each other in a circle; fix the references first");
    ordered.push(next);
    placed.add(next);
  }
  const newIndex = new Map(ordered.map((original, position) => [original, position]));

  const operations: DraftOperation[] = ordered.map((i) => {
    const edit = edits[i];
    return {
      op: "create",
      entityType: edit.entityType,
      entityId: entityIdOf(edit),
      after: edit.after,
      dependsOnSequences: [...deps[i]].map((d) => newIndex.get(d)!).sort((a, b) => a - b),
      reason: edit.sourceOperationId ? sourceById.get(edit.sourceOperationId)?.reason ?? undefined : "added at review",
    };
  });
  // Supersession, the new proposal, and its carried evidence commit together
  // (finding 7): a failure anywhere leaves the original review untouched.
  return db.$transaction(async (tx) => {
    const next = await buildProposal(tx, {
      origin: current.origin,
      idempotencyKey: `revise:${proposalId}:${newUuid()}`,
      captureId: current.captureId ?? undefined,
      supersedesProposalId: proposalId,
      operations,
    });
    const carried = ordered
      .map((i, position) => ({ edit: edits[i], op: next.operations[position] }))
      .filter(({ edit }) => edit.sourceOperationId && sourceById.has(edit.sourceOperationId));
    for (const { edit, op } of carried) {
      const source = sourceById.get(edit.sourceOperationId!)!;
      const before = (source.after ?? {}) as Record<string, unknown>;
      const after = (edit.after ?? {}) as Record<string, unknown>;
      // Evidence follows a field only while the field still says what the
      // source said (finding 17): a user edit is not source-supported.
      const unchanged = (fieldPath: string) => {
        const keys = EVIDENCE_FIELD_KEYS[fieldPath];
        if (!keys || edit.entityType !== source.entityType) return false;
        return keys.every((k) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null));
      };
      const rows = (await tx.fieldEvidence.findMany({ where: { proposalOperationId: edit.sourceOperationId } })).filter(
        (r) => unchanged(r.fieldPath),
      );
      if (rows.length > 0) {
        await tx.fieldEvidence.createMany({
          data: rows.map((r) => ({
            proposalOperationId: op.operationId,
            fieldPath: r.fieldPath,
            startOffset: r.startOffset,
            endOffset: r.endOffset,
            literalText: r.literalText,
            confidence: r.confidence,
            resolverMeta: r.resolverMeta ?? undefined,
          })),
        });
      }
    }
    return next;
  });
}

/** Batch undo (rule 10): builds the conflict-aware undo Proposal for review. */
export async function startUndo(db: PrismaClient, actionId: string): Promise<ProposalWithOperations> {
  return buildUndoProposal(db, actionId, `undo:${actionId}:${newUuid()}`);
}

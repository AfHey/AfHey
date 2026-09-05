/**
 * Deterministic interpretation (product-spec §8, §14.1): turns a
 * schema-valid extraction result into a mandatory-review Inbox Proposal.
 * Trusted code owns everything the model may not: evidence bounds,
 * dependency ordering, reference resolution to preallocated UUIDs, date
 * resolution, business invariants, duplicate warnings, and FieldEvidence.
 * Nothing here is saved to domain tables; only the Proposal is persisted.
 */
import type { DateTime } from "luxon";
import type { ExtractionItem, ExtractionResult } from "@/ai/adapters/extraction-contract";
import type { Confidence } from "@/core/domain/enums";
import type {
  EventCreateInput,
  NoteCreateInput,
  PersonCreateInput,
  ProjectCreateInput,
  TaskCreateInput,
} from "@/core/domain/schemas";
import { buildProposal, type DraftOperation, type ProposalWithOperations } from "@/core/proposals/build";
import { ProposalValidationError } from "@/core/proposals/errors";
import { newUuid } from "@/lib/ids";
import type { Prisma, PrismaClient } from "@/db/generated/client";
import { findDuplicates, type DuplicateCandidate, type DuplicateWarning } from "./duplicates";
import { resolveTemporal, type TemporalResolution } from "./temporal";

export interface InterpretationWarning {
  itemRef: string | null;
  message: string;
  /** needs_confirmation marks something the user must decide at review. */
  severity: "info" | "needs_confirmation";
}

export interface InterpretationInput {
  captureId: string;
  /** The exact guarded payload transmitted to the provider. */
  payloadText: string;
  extraction: ExtractionResult;
  /** Current instant in the user's current timezone. */
  now: DateTime;
  idempotencyKey: string;
}

export interface InterpretationResult {
  proposal: ProposalWithOperations | null;
  warnings: InterpretationWarning[];
  duplicates: DuplicateWarning[];
  skipped: Array<{ itemRef: string; reason: string }>;
}

const TASK_KINDS = new Set(["action", "waiting_for", "reminder"]);
const BUCKETS = new Set(["active", "backlog", "someday"]);
const EVENT_KINDS = new Set(["meeting", "appointment", "personal", "other"]);
const SCHEDULE_TYPES = new Set(["fixed", "flexible"]);
const ENERGY = new Set(["low", "medium", "high"]);
const WORK_TYPES = new Set(["deep", "shallow", "study", "communication", "errand", "other"]);

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, needs_confirmation: 2 };
const worst = (values: Confidence[]): Confidence | null =>
  values.length === 0
    ? null
    : values.reduce((acc, v) => (CONFIDENCE_RANK[v] > CONFIDENCE_RANK[acc] ? v : acc));

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;
const bool = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;
const posInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
const oneOf = <T extends string>(value: unknown, allowed: Set<string>): T | null =>
  typeof value === "string" && allowed.has(value) ? (value as T) : null;

interface PreparedItem {
  item: ExtractionItem;
  entityId: string;
  draft: DraftOperation;
  confidences: Confidence[];
  duplicateCandidate: DuplicateCandidate | null;
}

function evidenceInBounds(item: ExtractionItem, length: number): boolean {
  const spans = [
    ...item.field_evidence.map((f) => f.evidence),
    ...item.temporal_expressions.map((t) => t.evidence),
    ...item.entity_references.map((r) => r.evidence),
  ];
  return spans.every((s) => s.start >= 0 && s.end >= s.start && s.end <= length);
}

/** Kahn ordering over depends_on_item_refs; cycle members are reported. */
function orderItems(items: ExtractionItem[]): { ordered: ExtractionItem[]; cyclic: string[] } {
  const byRef = new Map(items.map((i) => [i.item_ref, i]));
  const indegree = new Map(items.map((i) => [i.item_ref, 0]));
  for (const item of items) {
    for (const dep of item.depends_on_item_refs) {
      if (byRef.has(dep)) indegree.set(item.item_ref, (indegree.get(item.item_ref) ?? 0) + 1);
    }
  }
  const ready = items.filter((i) => indegree.get(i.item_ref) === 0);
  const ordered: ExtractionItem[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    ordered.push(next);
    for (const item of items) {
      if (item.depends_on_item_refs.includes(next.item_ref)) {
        const remaining = (indegree.get(item.item_ref) ?? 0) - 1;
        indegree.set(item.item_ref, remaining);
        if (remaining === 0) ready.push(item);
      }
    }
  }
  const placed = new Set(ordered.map((i) => i.item_ref));
  return { ordered, cyclic: items.filter((i) => !placed.has(i.item_ref)).map((i) => i.item_ref) };
}

interface Refs {
  single(field: string): { id: string; confidence: Confidence } | "ambiguous" | null;
  /** All unambiguous candidates for a field, plus whether any were ambiguous. */
  many(field: string): { ids: string[]; ambiguous: boolean };
}

function referenceLookup(item: ExtractionItem): Refs {
  return {
    single(field) {
      const ref = item.entity_references.find((r) => r.field === field);
      if (!ref || ref.candidate_ids.length === 0) return null;
      if (ref.candidate_ids.length > 1) return "ambiguous";
      return { id: ref.candidate_ids[0], confidence: ref.confidence };
    },
    many(field) {
      const ids: string[] = [];
      let ambiguous = false;
      for (const ref of item.entity_references.filter((r) => r.field === field)) {
        if (ref.candidate_ids.length === 1) ids.push(ref.candidate_ids[0]);
        else if (ref.candidate_ids.length > 1) ambiguous = true;
      }
      return { ids: [...new Set(ids)], ambiguous };
    },
  };
}

export async function interpretExtraction(
  db: PrismaClient,
  input: InterpretationInput,
): Promise<InterpretationResult> {
  const warnings: InterpretationWarning[] = [];
  const skipped: Array<{ itemRef: string; reason: string }> = [];
  const zone = input.now.zoneName!;

  const inBounds: ExtractionItem[] = [];
  for (const item of input.extraction.items) {
    if (evidenceInBounds(item, input.payloadText.length)) inBounds.push(item);
    else skipped.push({ itemRef: item.item_ref, reason: "evidence span outside the capture text" });
  }
  const { ordered, cyclic } = orderItems(inBounds);
  for (const ref of cyclic) skipped.push({ itemRef: ref, reason: "circular item dependency" });

  const prepared = new Map<string, PreparedItem>();
  const skippedRefs = new Set(skipped.map((s) => s.itemRef));

  const resolve = (
    item: ExtractionItem,
    fieldNames: string[],
  ): { resolution: TemporalResolution; literal: string; confidence: Confidence } | null => {
    const expressions = item.temporal_expressions.filter((t) => fieldNames.includes(t.field));
    if (expressions.length === 0) return null;
    // A day and a time often arrive as separate literals ("Thursday", "3pm");
    // resolving them together yields the instant, so try the combination first.
    if (expressions.length > 1) {
      const combined = expressions.map((t) => t.literal).join(" ");
      const together = resolveTemporal(combined, expressions[0].relation, { now: input.now });
      if (together.kind === "date" || together.kind === "instant") {
        const confidence = expressions.some((t) => t.confidence === "needs_confirmation")
          ? "needs_confirmation"
          : expressions.some((t) => t.confidence === "medium") ? "medium" : "high";
        return { resolution: together, literal: combined, confidence };
      }
    }
    const expression = expressions[0];
    const resolution = resolveTemporal(expression.literal, expression.relation, { now: input.now });
    return { resolution, literal: expression.literal, confidence: expression.confidence };
  };

  for (const item of ordered) {
    if (item.depends_on_item_refs.some((d) => skippedRefs.has(d))) {
      skipped.push({ itemRef: item.item_ref, reason: "depends on a skipped item" });
      skippedRefs.add(item.item_ref);
      continue;
    }
    const entityId = newUuid();
    const refs = referenceLookup(item);
    const confidences: Confidence[] = [
      ...item.field_evidence.map((f) => f.confidence),
      ...item.entity_references.map((r) => r.confidence),
      ...item.temporal_expressions.map((t) => t.confidence),
    ];
    const dependencyOf = (type: "project" | "person") =>
      item.depends_on_item_refs
        .map((ref) => prepared.get(ref))
        .find((p) => p && p.item.entity_type === type);
    // Filled in against the final ordering after all items are prepared.
    const dependsOnSequences: number[] = [];

    const projectRef = refs.single("project_id") ?? refs.single("project");
    let projectId: string | null = null;
    if (projectRef === "ambiguous") {
      warnings.push({
        itemRef: item.item_ref,
        message: "several projects match; choose one at review",
        severity: "needs_confirmation",
      });
      confidences.push("needs_confirmation");
    } else if (projectRef) {
      projectId = projectRef.id;
    } else {
      projectId = dependencyOf("project")?.entityId ?? null;
    }

    let draft: DraftOperation | null = null;
    let duplicateCandidate: DuplicateCandidate | null = null;
    const f = item.fields;

    switch (item.entity_type) {
      case "task": {
        const title = str(f.title);
        if (!title) {
          skipped.push({ itemRef: item.item_ref, reason: "task without a title" });
          skippedRefs.add(item.item_ref);
          continue;
        }
        let taskKind = oneOf<"action" | "waiting_for" | "reminder">(f.task_kind, TASK_KINDS) ?? "action";
        // People involved (spec §3): unambiguous references and proposed
        // person items become TaskPerson links; ambiguous ones are flagged.
        const people = refs.many("people");
        const peopleIds = [...people.ids];
        for (const ref of item.depends_on_item_refs) {
          const dep = prepared.get(ref);
          if (dep && dep.item.entity_type === "person" && !peopleIds.includes(dep.entityId)) {
            peopleIds.push(dep.entityId);
          }
        }
        if (people.ambiguous) {
          warnings.push({
            itemRef: item.item_ref,
            message: "a person mention matched several people; confirm who is involved at review",
            severity: "needs_confirmation",
          });
          confidences.push("needs_confirmation");
        }
        const payload: Partial<TaskCreateInput> & { title: string } = {
          title,
          taskKind,
          bucket: oneOf<"active" | "backlog" | "someday">(f.bucket, BUCKETS) ?? "active",
          description: str(f.description),
          notes: str(f.notes),
          location: str(f.location),
          context: str(f.context),
          projectId,
          captureId: input.captureId,
          peopleIds,
          estimatedDurationMinutes: posInt(f.estimated_duration_minutes),
          isSplittable: bool(f.is_splittable) ?? false,
          isSchedulable: bool(f.is_schedulable) ?? true,
          energyLevel: oneOf<"low" | "medium" | "high">(f.energy_level, ENERGY),
          workType: oneOf<TaskCreateInput["workType"] & string>(f.work_type, WORK_TYPES),
          computedPriorityScore:
            typeof f.proposed_priority_score === "number" &&
            Number.isInteger(f.proposed_priority_score) &&
            f.proposed_priority_score >= 0 &&
            f.proposed_priority_score <= 100
              ? f.proposed_priority_score
              : 50,
        };

        const deadline = resolve(item, ["deadline", "due", "due_date"]);
        let dueDate: string | null = null;
        if (deadline) {
          const r = deadline.resolution;
          if (r.kind === "date") {
            payload.deadlineDate = r.date;
            payload.deadlineType = "soft";
            dueDate = r.date;
            confidences.push(r.confidence);
          } else if (r.kind === "instant") {
            payload.deadlineAt = r.instant;
            payload.deadlineTimezone = r.timezone;
            payload.deadlineType = "soft";
            dueDate = r.local.slice(0, 10);
            confidences.push(r.confidence);
          } else {
            warnings.push({
              itemRef: item.item_ref,
              message:
                r.kind === "needs_confirmation"
                  ? `deadline "${deadline.literal}": ${r.reason}; suggestions: ${r.suggestions.join(", ")}`
                  : `deadline "${deadline.literal}" could not be resolved; set it at review`,
              severity: "needs_confirmation",
            });
            confidences.push("needs_confirmation");
          }
        }

        if (taskKind === "reminder") {
          const remind = resolve(item, ["remind_at", "reminder", "deadline"]);
          const r = remind?.resolution;
          if (r?.kind === "instant") {
            payload.remindAt = r.instant;
            payload.reminderTimezone = r.timezone;
          } else if (r?.kind === "date") {
            const local = input.now.setZone(zone).set({
              year: Number(r.date.slice(0, 4)),
              month: Number(r.date.slice(5, 7)),
              day: Number(r.date.slice(8, 10)),
              hour: 9,
              minute: 0,
              second: 0,
              millisecond: 0,
            });
            payload.remindAt = local.toUTC().toISO()!;
            payload.reminderTimezone = zone;
            warnings.push({
              itemRef: item.item_ref,
              message: "reminder time assumed 09:00; adjust at review",
              severity: "info",
            });
            confidences.push("medium");
          } else {
            taskKind = "action";
            payload.taskKind = "action";
            warnings.push({
              itemRef: item.item_ref,
              message: "reminder had no resolvable time; kept as an action task",
              severity: "needs_confirmation",
            });
            confidences.push("needs_confirmation");
          }
          if (taskKind === "reminder") {
            payload.deadlineDate = undefined;
            payload.deadlineAt = undefined;
            payload.deadlineTimezone = undefined;
            payload.deadlineType = undefined;
          }
        }

        if (taskKind === "waiting_for") {
          const personRef = refs.single("waiting_for_person_id") ?? refs.single("people");
          const dependencyPerson = dependencyOf("person");
          if (personRef && personRef !== "ambiguous") {
            payload.waitingForPersonId = personRef.id;
          } else if (dependencyPerson) {
            payload.waitingForPersonId = dependencyPerson.entityId;
          } else {
            payload.taskKind = "action";
            warnings.push({
              itemRef: item.item_ref,
              message:
                personRef === "ambiguous"
                  ? "waiting-for needs one confirmed person; several matched — kept as an action task"
                  : "waiting-for needs a person; none resolved — kept as an action task",
              severity: "needs_confirmation",
            });
            confidences.push("needs_confirmation");
          }
          const nudge = resolve(item, ["nudge_date", "nudge"]);
          if (payload.taskKind === "waiting_for" && nudge?.resolution.kind === "date") {
            payload.nudgeDate = nudge.resolution.date;
          }
        }

        const overall = worst(confidences);
        payload.confidence = overall;
        draft = { op: "create", entityType: "task", entityId, after: payload, dependsOnSequences };
        duplicateCandidate = { itemRef: item.item_ref, entityType: "task", title, projectId, dueDate };
        break;
      }

      case "event": {
        const title = str(f.title);
        if (!title) {
          skipped.push({ itemRef: item.item_ref, reason: "event without a title" });
          skippedRefs.add(item.item_ref);
          continue;
        }
        const start = resolve(item, ["start", "starts", "when", "on", "start_at"]);
        const end = resolve(item, ["end", "ends", "end_at"]);
        const s = start?.resolution;
        if (!s || (s.kind !== "date" && s.kind !== "instant")) {
          // No usable time: keep the content as a task rather than losing it.
          warnings.push({
            itemRef: item.item_ref,
            message:
              s?.kind === "needs_confirmation"
                ? `event time "${start!.literal}": ${s.reason} — kept as a task; suggestions: ${s.suggestions.join(", ")}`
                : "event had no resolvable time; kept as a task",
            severity: "needs_confirmation",
          });
          draft = {
            op: "create",
            entityType: "task",
            entityId,
            after: {
              title,
              projectId,
              captureId: input.captureId,
              location: str(f.location),
              notes: str(f.notes),
              confidence: "needs_confirmation",
            },
            dependsOnSequences,
          };
          duplicateCandidate = { itemRef: item.item_ref, entityType: "task", title, projectId, dueDate: null };
          break;
        }
        const payload: Partial<EventCreateInput> & Pick<EventCreateInput, "title" | "kind" | "scheduleType" | "timezone"> = {
          title,
          kind: oneOf<"meeting" | "appointment" | "personal" | "other">(f.event_kind, EVENT_KINDS) ?? "other",
          scheduleType: oneOf<"fixed" | "flexible">(f.schedule_type, SCHEDULE_TYPES) ?? "fixed",
          isLocked: false,
          timezone: zone,
          projectId,
          captureId: input.captureId,
          location: str(f.location),
          description: str(f.description),
          notes: str(f.notes),
        };
        confidences.push(s.confidence);
        let dueDate: string;
        if (s.kind === "date") {
          const startDate = input.now.setZone(zone).set({
            year: Number(s.date.slice(0, 4)),
            month: Number(s.date.slice(5, 7)),
            day: Number(s.date.slice(8, 10)),
          });
          payload.allDayStartDate = s.date;
          payload.allDayEndDate = startDate.plus({ days: 1 }).toISODate()!;
          dueDate = s.date;
        } else {
          payload.startAt = s.instant;
          payload.timezone = s.timezone;
          dueDate = s.local.slice(0, 10);
          if (end?.resolution.kind === "instant" && Date.parse(end.resolution.instant) > Date.parse(s.instant)) {
            payload.endAt = end.resolution.instant;
          } else {
            payload.endAt = new Date(Date.parse(s.instant) + 60 * 60 * 1000).toISOString();
            warnings.push({
              itemRef: item.item_ref,
              message: "event end assumed one hour after start",
              severity: "info",
            });
            confidences.push("medium");
          }
        }
        draft = { op: "create", entityType: "event", entityId, after: payload, dependsOnSequences };
        duplicateCandidate = { itemRef: item.item_ref, entityType: "event", title, projectId, dueDate };
        break;
      }

      case "note": {
        const body = str(f.body) ?? str(f.title);
        if (!body) {
          skipped.push({ itemRef: item.item_ref, reason: "note without content" });
          skippedRefs.add(item.item_ref);
          continue;
        }
        const payload: NoteCreateInput = {
          body,
          title: str(f.body) ? str(f.title) : null,
          projectId,
          captureId: input.captureId,
        };
        draft = { op: "create", entityType: "note", entityId, after: payload, dependsOnSequences };
        duplicateCandidate = {
          itemRef: item.item_ref,
          entityType: "note",
          title: payload.title ?? body.slice(0, 80),
          projectId,
          dueDate: null,
        };
        break;
      }

      case "person": {
        const name = str(f.name) ?? str(f.title);
        if (!name) {
          skipped.push({ itemRef: item.item_ref, reason: "person without a name" });
          skippedRefs.add(item.item_ref);
          continue;
        }
        const payload: PersonCreateInput = { name, role: str(f.role), notes: str(f.notes), aliases: [] };
        draft = { op: "create", entityType: "person", entityId, after: payload, dependsOnSequences };
        break;
      }

      case "project": {
        const name = str(f.name) ?? str(f.title);
        if (!name) {
          skipped.push({ itemRef: item.item_ref, reason: "project without a name" });
          skippedRefs.add(item.item_ref);
          continue;
        }
        const payload: ProjectCreateInput = {
          kind: "project",
          name,
          parentId: null,
          description: str(f.description),
          importance: null,
        };
        draft = { op: "create", entityType: "project", entityId, after: payload, dependsOnSequences };
        break;
      }
    }

    if (draft) {
      draft.reason = `extracted from capture (${item.item_ref})`;
      prepared.set(item.item_ref, { item, entityId, draft, confidences, duplicateCandidate });
    }
  }

  const preparedList = [...prepared.values()];
  const duplicates = await findDuplicates(
    db,
    preparedList.map((p) => p.duplicateCandidate).filter((c): c is DuplicateCandidate => c !== null),
  );
  for (const d of duplicates) {
    warnings.push({
      itemRef: d.itemRef,
      message: `possible duplicate of "${d.existingTitle}" (${d.reason})`,
      severity: "info",
    });
  }

  if (preparedList.length === 0) {
    return { proposal: null, warnings, duplicates, skipped };
  }

  // Dependency sequences: recompute against the final ordering. Per-item
  // warnings ride on the operation's `reason` so the review screen can show
  // them after any reload.
  const sequenceOf = new Map(preparedList.map((p, index) => [p.item.item_ref, index]));
  for (const p of preparedList) {
    p.draft.dependsOnSequences = p.item.depends_on_item_refs
      .map((ref) => sequenceOf.get(ref))
      .filter((s): s is number => s !== undefined);
    const notes = warnings.filter((w) => w.itemRef === p.item.item_ref).map((w) => w.message);
    p.draft.reason = [p.draft.reason, ...notes].filter(Boolean).join(" · ");
  }

  let proposal: ProposalWithOperations;
  try {
    proposal = await buildProposal(db, {
      origin: "inbox",
      idempotencyKey: input.idempotencyKey,
      captureId: input.captureId,
      operations: preparedList.map((p) => p.draft),
    });
  } catch (error) {
    if (error instanceof ProposalValidationError) {
      return {
        proposal: null,
        warnings: [
          ...warnings,
          ...error.problems.map((message) => ({ itemRef: null, message, severity: "needs_confirmation" as const })),
        ],
        duplicates,
        skipped,
      };
    }
    throw error;
  }

  // FieldEvidence rows: offsets index into the transmitted payload text.
  const evidenceRows: Prisma.FieldEvidenceCreateManyInput[] = [];
  for (const [index, p] of preparedList.entries()) {
    const operation = proposal.operations[index];
    const slice = (start: number, end: number) => input.payloadText.slice(start, end);
    for (const fe of p.item.field_evidence) {
      evidenceRows.push({
        proposalOperationId: operation.operationId,
        fieldPath: fe.field,
        startOffset: fe.evidence.start,
        endOffset: fe.evidence.end,
        literalText: slice(fe.evidence.start, fe.evidence.end),
        confidence: fe.confidence,
      });
    }
    for (const t of p.item.temporal_expressions) {
      const resolution = resolveTemporal(t.literal, t.relation, { now: input.now });
      evidenceRows.push({
        proposalOperationId: operation.operationId,
        fieldPath: t.field,
        startOffset: t.evidence.start,
        endOffset: t.evidence.end,
        literalText: slice(t.evidence.start, t.evidence.end),
        confidence: t.confidence,
        resolverMeta: JSON.parse(JSON.stringify({ literal: t.literal, relation: t.relation, resolution })),
      });
    }
    for (const r of p.item.entity_references) {
      evidenceRows.push({
        proposalOperationId: operation.operationId,
        fieldPath: r.field,
        startOffset: r.evidence.start,
        endOffset: r.evidence.end,
        literalText: slice(r.evidence.start, r.evidence.end),
        confidence: r.confidence,
        resolverMeta: { candidateIds: r.candidate_ids, unresolvedLiteral: r.unresolved_literal },
      });
    }
  }
  if (evidenceRows.length > 0) await db.fieldEvidence.createMany({ data: evidenceRows });

  await db.capture.updateMany({
    where: { id: input.captureId, processingStatus: { in: ["received", "redacted"] } },
    data: {
      processingStatus: "proposed",
      redactedText: input.payloadText,
      revision: { increment: 1 },
    },
  });

  return { proposal, warnings, duplicates, skipped };
}

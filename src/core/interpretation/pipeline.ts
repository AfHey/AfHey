/**
 * Deterministic interpretation (product-spec §8, §14.1): turns a
 * schema-valid extraction result into a mandatory-review Inbox Proposal.
 * Trusted code owns everything the model may not: evidence bounds,
 * dependency ordering, reference resolution to preallocated UUIDs, date
 * resolution, business invariants, duplicate warnings, and FieldEvidence.
 * Nothing here is saved to domain tables; only the Proposal is persisted.
 */
import { DateTime } from "luxon";
import type { ExtractionItem, ExtractionResult } from "@/ai/adapters/extraction-contract";
import type { ResolutionMention } from "@/ai/adapters/types";
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
import { fieldEvidenceIsMeaningful } from "./evidence-fields";
import {
  detectTemporalPhrases,
  resolveTemporal,
  resolveTemporalRange,
  type TemporalContext,
  type TemporalResolution,
} from "./temporal";

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
  /** The exact candidate map transmitted with it; references outside it are dropped. */
  mentions: ResolutionMention[];
  extraction: ExtractionResult;
  /** Current instant in the user's current timezone. */
  now: DateTime;
  idempotencyKey: string;
  /** Processing claim held by the caller; the capture transition requires it. */
  claimKey?: string;
}

export interface InterpretationResult {
  proposal: ProposalWithOperations | null;
  warnings: InterpretationWarning[];
  duplicates: DuplicateWarning[];
  skipped: Array<{ itemRef: string; reason: string }>;
  /** True when the capture was resolved by someone else and the proposal was voided. */
  superseded?: boolean;
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

const TEMPORAL_FIELDS = new Set([
  "deadline", "due", "due_date", "remind_at", "reminder", "nudge_date", "nudge",
  "start", "starts", "when", "on", "start_at", "end", "ends", "end_at",
]);

/**
 * Deterministic salvage for a model slip (finding A, 2026-09-05): when an
 * item carries no temporal expression but its own title/context/notes
 * contain a recognizable date phrase, recover it as a temporal expression
 * anchored to the phrase's occurrence in the payload. Only phrases that
 * can be located in the source are recovered; nothing is invented.
 */
function salvageTemporal(
  item: ExtractionItem,
  payloadText: string,
  field: "deadline" | "start",
): { item: ExtractionItem; recovered: boolean } {
  if (item.temporal_expressions.some((t) => TEMPORAL_FIELDS.has(t.field))) {
    return { item, recovered: false };
  }
  const fields = { ...item.fields };
  const sources: Array<[key: string, text: string]> = (["context", "title", "description", "notes"] as const)
    .filter((k) => typeof fields[k] === "string")
    .map((k) => [k, fields[k] as string]);
  const anchor = item.field_evidence[0]?.evidence.start ?? 0;
  for (const [key, text] of sources) {
    const phrases = detectTemporalPhrases(text);
    if (phrases.length === 0) continue;
    const phrase = phrases[0];
    const lowerPayload = payloadText.toLowerCase();
    const needle = phrase.literal.toLowerCase();
    let best = -1;
    let index = lowerPayload.indexOf(needle);
    while (index >= 0) {
      if (best === -1 || Math.abs(index - anchor) < Math.abs(best - anchor)) best = index;
      index = lowerPayload.indexOf(needle, index + 1);
    }
    if (best === -1) continue;
    if (key === "context" && text.trim().toLowerCase() === needle) fields.context = null;
    return {
      recovered: true,
      item: {
        ...item,
        fields,
        temporal_expressions: [
          ...item.temporal_expressions,
          {
            field,
            literal: phrase.literal,
            relation: phrase.relation,
            anchor_entity_id: null,
            evidence: { start: best, end: best + phrase.literal.length },
            confidence: "medium",
          },
        ],
      },
    };
  }
  return { item, recovered: false };
}

const REFERENCE_FIELD_TYPE: Record<string, "person" | "project"> = {
  people: "person",
  waiting_for_person_id: "person",
  project_id: "project",
  project: "project",
};

/**
 * Trusted-candidate enforcement (finding 16, 2026-09-05). The provider may
 * only reference ids trusted code supplied for the matching entity type, and
 * may not narrow an ambiguous placeholder to one candidate: such a reference
 * is widened back to the full candidate set with needs_confirmation.
 * Anchor ids that were never supplied are dropped.
 */
function enforceSuppliedCandidates(
  item: ExtractionItem,
  mentions: ResolutionMention[],
): { item: ExtractionItem; problems: string[] } {
  const problems: string[] = [];
  const supplied = new Set(mentions.flatMap((m) => m.candidateIds));
  const byType = { person: new Set<string>(), project: new Set<string>() };
  for (const m of mentions) for (const id of m.candidateIds) byType[m.entityType].add(id);

  const references = item.entity_references.flatMap((ref) => {
    const wantType = REFERENCE_FIELD_TYPE[ref.field];
    if (!wantType) {
      if (ref.candidate_ids.length > 0) problems.push(`reference field "${ref.field}" is not recognized; dropped`);
      return [];
    }
    const kept = ref.candidate_ids.filter((id) => byType[wantType].has(id));
    if (kept.length < ref.candidate_ids.length) {
      problems.push(`a ${ref.field} reference pointed at an id that was not offered; dropped`);
    }
    if (kept.length === 0) {
      return ref.unresolved_literal !== null ? [{ ...ref, candidate_ids: [] }] : [];
    }
    // Widen a narrowed ambiguous placeholder back to its full candidate set.
    const home = mentions.find(
      (m) => m.entityType === wantType && m.candidateIds.length > 1 && kept.every((id) => m.candidateIds.includes(id)),
    );
    if (home && kept.length < home.candidateIds.length) {
      problems.push(`an ambiguous ${wantType} mention was narrowed by the provider; all candidates restored`);
      return [{ ...ref, candidate_ids: [...home.candidateIds], confidence: "needs_confirmation" as const }];
    }
    return [{ ...ref, candidate_ids: kept }];
  });

  const temporal = item.temporal_expressions.map((t) => {
    if (t.anchor_entity_id !== null && !supplied.has(t.anchor_entity_id)) {
      problems.push("a temporal anchor pointed at an id that was not offered; dropped");
      return { ...t, anchor_entity_id: null };
    }
    return t;
  });
  return { item: { ...item, entity_references: references, temporal_expressions: temporal }, problems };
}

/**
 * Evidence integrity (finding 17, 2026-09-05): a temporal phrase whose span
 * does not actually contain the phrase is fabricated or unlocatable and is
 * discarded (no authoritative date from it); zero-length field evidence is
 * discarded; source-derived titles need at least one real evidence span.
 */
function enforceEvidenceIntegrity(
  item: ExtractionItem,
  payloadText: string,
): { item: ExtractionItem; problems: string[]; titleCovered: boolean } {
  const problems: string[] = [];
  const lower = payloadText.toLowerCase();
  const spanHolds = (start: number, end: number, literal: string) =>
    end > start && lower.slice(start, end).includes(literal.toLowerCase().trim());

  const temporal = item.temporal_expressions.filter((t) => {
    if (spanHolds(t.evidence.start, t.evidence.end, t.literal)) return true;
    problems.push("a date phrase could not be matched to the source and was ignored");
    return false;
  });
  const fieldEvidence = item.field_evidence.filter((f) => f.evidence.end > f.evidence.start);
  const titleCovered = fieldEvidence.some((f) => ["title", "name", "body"].includes(f.field));
  return { item: { ...item, temporal_expressions: temporal, field_evidence: fieldEvidence }, problems, titleCovered };
}

/** Strips any source-derived wording from a resolution before persistence. */
function textFreeResolution(resolution: TemporalResolution): Record<string, unknown> {
  switch (resolution.kind) {
    case "date":
      return { kind: "date", date: resolution.date, confidence: resolution.confidence };
    case "instant":
      return { kind: "instant", instant: resolution.instant, timezone: resolution.timezone, confidence: resolution.confidence };
    case "needs_confirmation":
      return { kind: "needs_confirmation", suggestions: resolution.suggestions };
    case "unresolved":
      return { kind: "unresolved" };
  }
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
  const uncoveredTitles = new Set<string>();
  for (const rawItem of input.extraction.items) {
    if (!evidenceInBounds(rawItem, input.payloadText.length)) {
      skipped.push({ itemRef: rawItem.item_ref, reason: "evidence span outside the capture text" });
      continue;
    }
    const trusted = enforceSuppliedCandidates(rawItem, input.mentions);
    const integrity = enforceEvidenceIntegrity(trusted.item, input.payloadText);
    for (const message of [...trusted.problems, ...integrity.problems]) {
      warnings.push({ itemRef: rawItem.item_ref, message, severity: "needs_confirmation" });
    }
    if (!integrity.titleCovered) uncoveredTitles.add(rawItem.item_ref);
    const salvage = salvageTemporal(
      integrity.item,
      input.payloadText,
      rawItem.entity_type === "event" ? "start" : "deadline",
    );
    if (salvage.recovered) {
      warnings.push({
        itemRef: rawItem.item_ref,
        message: "a date phrase was recovered from the item text; check it",
        severity: "info",
      });
    }
    inBounds.push(salvage.item);
  }
  const { ordered, cyclic } = orderItems(inBounds);
  for (const ref of cyclic) skipped.push({ itemRef: ref, reason: "circular item dependency" });

  const prepared = new Map<string, PreparedItem>();
  const skippedRefs = new Set(skipped.map((s) => s.itemRef));

  const resolve = (
    item: ExtractionItem,
    fieldNames: string[],
    extra: Partial<TemporalContext> = {},
  ): { resolution: TemporalResolution; literal: string; confidence: Confidence } | null => {
    const expressions = item.temporal_expressions.filter((t) => fieldNames.includes(t.field));
    if (expressions.length === 0) return null;
    const context: TemporalContext = { now: input.now, ...extra };
    // A day and a time often arrive as separate literals ("Thursday", "3pm");
    // resolving them together yields the instant, so try the combination first.
    if (expressions.length > 1) {
      const combined = expressions.map((t) => t.literal).join(" ");
      const together = resolveTemporal(combined, expressions[0].relation, context);
      if (together.kind === "date" || together.kind === "instant") {
        const confidence = expressions.some((t) => t.confidence === "needs_confirmation")
          ? "needs_confirmation"
          : expressions.some((t) => t.confidence === "medium") ? "medium" : "high";
        return { resolution: together, literal: combined, confidence };
      }
    }
    const expression = expressions[0];
    const resolution = resolveTemporal(expression.literal, expression.relation, context);
    return { resolution, literal: expression.literal, confidence: expression.confidence };
  };

  /** Deadline firmness (finding 21): provider field first, then wording. */
  const deadlineTypeFor = (item: ExtractionItem, literal: string): "hard" | "soft" => {
    const declared = item.fields.deadline_type;
    if (declared === "hard" || declared === "soft") return declared;
    const text = `${literal} ${str(item.fields.title) ?? ""}`.toLowerCase();
    return /\b(hard deadline|no later than|at the latest|final deadline|non-negotiable|must be (?:in|done|submitted|filed|sent))\b/.test(text)
      ? "hard"
      : "soft";
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
    if (uncoveredTitles.has(item.item_ref) && warnings.every((w) => !(w.itemRef === item.item_ref && /source evidence/.test(w.message)))) {
      warnings.push({
        itemRef: item.item_ref,
        message: "no source evidence for the title; confirm it is really in the capture",
        severity: "needs_confirmation",
      });
      confidences.push("needs_confirmation");
    }
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
            payload.deadlineType = deadlineTypeFor(item, deadline.literal);
            dueDate = r.date;
            confidences.push(r.confidence);
          } else if (r.kind === "instant") {
            payload.deadlineAt = r.instant;
            payload.deadlineTimezone = r.timezone;
            payload.deadlineType = deadlineTypeFor(item, deadline.literal);
            dueDate = r.local.slice(0, 10);
            confidences.push(r.confidence);
          } else {
            // Warnings ride on audit-bound operation reasons, so they carry
            // no source wording (finding 8); the evidence chip shows the phrase.
            warnings.push({
              itemRef: item.item_ref,
              message:
                r.kind === "needs_confirmation"
                  ? `the deadline phrase is ambiguous (${r.reason}); suggestions: ${r.suggestions.join(", ")}`
                  : "the deadline phrase could not be resolved; set it at review",
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
        // Finding 20: a range inside the start phrase ("Sept 12–14", "9am–11am")
        // is resolved as a whole; an explicit end resolves relative to the
        // start's day and is never replaced by an invented duration.
        const startFields = ["start", "starts", "when", "on", "start_at"];
        const startLiteral = item.temporal_expressions
          .filter((t) => startFields.includes(t.field))
          .map((t) => t.literal)
          .join(" ");
        const range = startLiteral ? resolveTemporalRange(startLiteral, { now: input.now }) : null;
        const start = range
          ? {
              resolution:
                range.kind === "dates"
                  ? ({ kind: "date", date: range.start, confidence: "high" } as TemporalResolution)
                  : range.start,
              literal: startLiteral,
              confidence: "high" as Confidence,
            }
          : resolve(item, startFields);
        const s = start?.resolution;
        const startDay =
          s?.kind === "instant"
            ? input.now.setZone(s.timezone).set({
                year: Number(s.local.slice(0, 4)),
                month: Number(s.local.slice(5, 7)),
                day: Number(s.local.slice(8, 10)),
              }).startOf("day")
            : s?.kind === "date"
              ? input.now.set({
                  year: Number(s.date.slice(0, 4)),
                  month: Number(s.date.slice(5, 7)),
                  day: Number(s.date.slice(8, 10)),
                }).startOf("day")
              : undefined;
        const end = resolve(item, ["end", "ends", "end_at"], startDay ? { referenceDay: startDay } : {});
        if (!s || (s.kind !== "date" && s.kind !== "instant")) {
          // No usable time: keep the content as a task rather than losing it.
          warnings.push({
            itemRef: item.item_ref,
            message:
              s?.kind === "needs_confirmation"
                ? `the event time is ambiguous (${s.reason}) — kept as a task; suggestions: ${s.suggestions.join(", ")}`
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
          const explicitLast =
            range?.kind === "dates" ? range.endInclusive : end?.resolution.kind === "date" ? end.resolution.date : null;
          if (explicitLast && explicitLast >= s.date) {
            payload.allDayEndDate = DateTime.fromISO(explicitLast).plus({ days: 1 }).toISODate()!;
          } else {
            payload.allDayEndDate = startDate.plus({ days: 1 }).toISODate()!;
            if (end) {
              warnings.push({ itemRef: item.item_ref, message: "the stated last day could not be used; confirm the range", severity: "needs_confirmation" });
              confidences.push("needs_confirmation");
            }
          }
          dueDate = s.date;
        } else {
          payload.startAt = s.instant;
          payload.timezone = s.timezone;
          dueDate = s.local.slice(0, 10);
          const explicitEnd =
            range?.kind === "instants" ? range.end.instant : end?.resolution.kind === "instant" ? end.resolution.instant : null;
          if (explicitEnd && Date.parse(explicitEnd) > Date.parse(s.instant)) {
            payload.endAt = explicitEnd;
          } else if (end) {
            payload.endAt = new Date(Date.parse(s.instant) + 60 * 60 * 1000).toISOString();
            warnings.push({
              itemRef: item.item_ref,
              message: "the stated end could not be used; end set provisionally to one hour after start — confirm",
              severity: "needs_confirmation",
            });
            confidences.push("needs_confirmation");
          } else {
            payload.endAt = new Date(Date.parse(s.instant) + 60 * 60 * 1000).toISOString();
            warnings.push({ itemRef: item.item_ref, message: "event end assumed one hour after start", severity: "info" });
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

  class CaptureResolvedElsewhere extends Error {}

  // FieldEvidence rows: offsets index into the transmitted payload text.
  // Field evidence is kept only for fields that actually populated the
  // proposed item (finding B): evidence for absent or default-valued fields
  // is noise that misleads review.
  const evidenceRowsFor = (built: ProposalWithOperations): Prisma.FieldEvidenceCreateManyInput[] => {
    const rows: Prisma.FieldEvidenceCreateManyInput[] = [];
    for (const [index, p] of preparedList.entries()) {
      const operation = built.operations[index];
      const slice = (start: number, end: number) => input.payloadText.slice(start, end);
      const after = (p.draft.after ?? {}) as Record<string, unknown>;
      for (const fe of p.item.field_evidence) {
        if (!fieldEvidenceIsMeaningful(fe.field, after)) continue;
        rows.push({
          proposalOperationId: operation.operationId,
          fieldPath: fe.field,
          startOffset: fe.evidence.start,
          endOffset: fe.evidence.end,
          literalText: slice(fe.evidence.start, fe.evidence.end),
          confidence: fe.confidence,
        });
      }
      // Resolver metadata is structured and text-free (finding 8): the source
      // phrase lives only in literalText, which the retention job clears.
      for (const t of p.item.temporal_expressions) {
        const resolution = resolveTemporal(t.literal, t.relation, { now: input.now });
        rows.push({
          proposalOperationId: operation.operationId,
          fieldPath: t.field,
          startOffset: t.evidence.start,
          endOffset: t.evidence.end,
          literalText: slice(t.evidence.start, t.evidence.end),
          confidence: t.confidence,
          resolverMeta: JSON.parse(JSON.stringify({ relation: t.relation, resolution: textFreeResolution(resolution) })),
        });
      }
      for (const r of p.item.entity_references) {
        rows.push({
          proposalOperationId: operation.operationId,
          fieldPath: r.field,
          startOffset: r.evidence.start,
          endOffset: r.evidence.end,
          literalText: slice(r.evidence.start, r.evidence.end),
          confidence: r.confidence,
          resolverMeta: { candidateIds: r.candidate_ids, unresolved: r.unresolved_literal !== null },
        });
      }
    }
    return rows;
  };

  // Proposal, evidence, and the capture transition commit together
  // (finding 7). The transition is conditional on still holding the claim
  // (finding 2): losing it means another action resolved the capture
  // meanwhile, so the whole review rolls back rather than staying applicable.
  try {
    const proposal = await db.$transaction(async (tx) => {
      const built = await buildProposal(tx, {
        origin: "inbox",
        idempotencyKey: input.idempotencyKey,
        captureId: input.captureId,
        operations: preparedList.map((p) => p.draft),
      });
      const evidenceRows = evidenceRowsFor(built);
      if (evidenceRows.length > 0) await tx.fieldEvidence.createMany({ data: evidenceRows });
      const transitioned = await tx.capture.updateMany({
        where: {
          id: input.captureId,
          processingStatus: { in: ["received", "redacted"] },
          ...(input.claimKey ? { processingClaimKey: input.claimKey } : {}),
        },
        data: {
          processingStatus: "proposed",
          redactedText: input.payloadText,
          processingClaimKey: null,
          processingClaimedAt: null,
          revision: { increment: 1 },
        },
      });
      if (transitioned.count !== 1) throw new CaptureResolvedElsewhere();
      return built;
    });
    return { proposal, warnings, duplicates, skipped };
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
    if (error instanceof CaptureResolvedElsewhere) {
      return { proposal: null, warnings, duplicates, skipped, superseded: true };
    }
    throw error;
  }
}

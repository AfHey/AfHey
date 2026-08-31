/**
 * Deterministic entity resolution (product-spec §3.1 item 3): finds lexicon
 * phrases in raw Capture text, substitutes opaque placeholder tokens, and
 * merges with the privacy guard so the provider receives only placeholders,
 * candidate UUIDs, and safe minimal context — never a People/glossary dump.
 *
 * Ambiguity rule (product-owner decision, 2026-08-30): a phrase matching
 * several entities — e.g. a first name shared by two people — becomes ONE
 * mention with multiple candidates and `needs_confirmation`. It is never an
 * error.
 */
import { detectSpans } from "@/ai/redaction/patterns";
import type { Confidence } from "@/core/domain/enums";
import {
  TIER_CONFIDENCE,
  TIER_PRIORITY,
  type LexiconEntry,
  type ResolutionEntityType,
} from "./lexicon";

export interface MentionOccurrence {
  rawStart: number;
  rawEnd: number;
  payloadStart: number;
  payloadEnd: number;
}

export interface EntityMention {
  placeholder: string;
  entityType: ResolutionEntityType;
  candidateIds: string[];
  confidence: Confidence;
  occurrences: MentionOccurrence[];
}

export interface PayloadRedaction {
  type: string;
  placeholder: string;
  rawStart: number;
  rawEnd: number;
  payloadStart: number;
  payloadEnd: number;
}

export interface PreparedPayload {
  payloadText: string;
  mentions: EntityMention[];
  redactions: PayloadRedaction[];
}

interface MentionSpan {
  start: number;
  end: number;
  entries: LexiconEntry[];
}

function escapePhrase(phrase: string): string {
  return phrase
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
}

function findMentionSpans(rawText: string, lexicon: LexiconEntry[]): MentionSpan[] {
  const byRange = new Map<string, MentionSpan>();
  for (const entry of lexicon) {
    const pattern = new RegExp(`(?<![\\w])${escapePhrase(entry.phrase)}(?![\\w])`, "gi");
    for (const match of rawText.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const key = `${start}:${end}`;
      const span = byRange.get(key);
      if (span) span.entries.push(entry);
      else byRange.set(key, { start, end, entries: [entry] });
    }
  }
  // Longest span wins where matches overlap ("Priya Raman" beats "Priya").
  const sorted = [...byRange.values()].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  );
  const kept: MentionSpan[] = [];
  let lastEnd = -1;
  for (const span of sorted) {
    if (span.start >= lastEnd) {
      kept.push(span);
      lastEnd = span.end;
    }
  }
  return kept;
}

function mentionMeta(entries: LexiconEntry[]): {
  entityType: ResolutionEntityType;
  candidateIds: string[];
  confidence: Confidence;
} {
  // If one phrase names both a person and a project, the higher-priority
  // tier decides the mention type; same-type candidates are kept.
  const best = [...entries].sort((a, b) => TIER_PRIORITY[a.tier] - TIER_PRIORITY[b.tier])[0];
  const sameType = entries.filter((e) => e.entityType === best.entityType);
  const candidateIds = [...new Set(sameType.map((e) => e.entityId))].sort();
  const confidence: Confidence =
    candidateIds.length > 1 ? "needs_confirmation" : TIER_CONFIDENCE[best.tier];
  return { entityType: best.entityType, candidateIds, confidence };
}

export function prepareProviderPayload(
  rawText: string,
  lexicon: LexiconEntry[],
): PreparedPayload {
  const mentionSpans = findMentionSpans(rawText, lexicon);
  let pii = detectSpans(rawText);

  // A PII span overlapping a mention is absorbed by it: the placeholder must
  // cover the whole detected identifier so nothing leaks around the token.
  let changed = true;
  while (changed) {
    changed = false;
    const remaining: typeof pii = [];
    for (const span of pii) {
      const host = mentionSpans.find((m) => span.start < m.end && span.end > m.start);
      if (host) {
        host.start = Math.min(host.start, span.start);
        host.end = Math.max(host.end, span.end);
        changed = true;
      } else {
        remaining.push(span);
      }
    }
    pii = remaining;
  }

  // Defensive: extension could make mentions touch; merge any that overlap.
  mentionSpans.sort((a, b) => a.start - b.start);
  const merged: MentionSpan[] = [];
  for (const span of mentionSpans) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) {
      last.end = Math.max(last.end, span.end);
      last.entries.push(...span.entries);
    } else {
      merged.push(span);
    }
  }

  // Assign shared placeholders per (type, candidate set); number per type in
  // first-occurrence order.
  const counters: Record<ResolutionEntityType, number> = { person: 0, project: 0 };
  const mentionByKey = new Map<string, EntityMention>();
  const spanPlan: Array<
    | { kind: "mention"; start: number; end: number; mention: EntityMention }
    | { kind: "pii"; start: number; end: number; type: string; placeholder: string }
  > = [];

  for (const span of merged) {
    const meta = mentionMeta(span.entries);
    const key = `${meta.entityType}:${meta.candidateIds.join(",")}`;
    let mention = mentionByKey.get(key);
    if (!mention) {
      counters[meta.entityType] += 1;
      mention = {
        placeholder: `[${meta.entityType.toUpperCase()}_${counters[meta.entityType]}]`,
        entityType: meta.entityType,
        candidateIds: meta.candidateIds,
        confidence: meta.confidence,
        occurrences: [],
      };
      mentionByKey.set(key, mention);
    }
    spanPlan.push({ kind: "mention", start: span.start, end: span.end, mention });
  }

  const piiCounters = new Map<string, number>();
  for (const span of pii) {
    const n = (piiCounters.get(span.type) ?? 0) + 1;
    piiCounters.set(span.type, n);
    spanPlan.push({
      kind: "pii",
      start: span.start,
      end: span.end,
      type: span.type,
      placeholder: `[REDACTED_${span.type.toUpperCase()}_${n}]`,
    });
  }
  spanPlan.sort((a, b) => a.start - b.start);

  let payloadText = "";
  let cursor = 0;
  const redactions: PayloadRedaction[] = [];
  for (const span of spanPlan) {
    payloadText += rawText.slice(cursor, span.start);
    const payloadStart = payloadText.length;
    const token = span.kind === "mention" ? span.mention.placeholder : span.placeholder;
    payloadText += token;
    const payloadEnd = payloadText.length;
    cursor = span.end;
    if (span.kind === "mention") {
      span.mention.occurrences.push({
        rawStart: span.start,
        rawEnd: span.end,
        payloadStart,
        payloadEnd,
      });
    } else {
      redactions.push({
        type: span.type,
        placeholder: span.placeholder,
        rawStart: span.start,
        rawEnd: span.end,
        payloadStart,
        payloadEnd,
      });
    }
  }
  payloadText += rawText.slice(cursor);

  return { payloadText, mentions: [...mentionByKey.values()], redactions };
}

/**
 * Safe minimal provider context: placeholder, type, candidate UUIDs, and an
 * ambiguity marker. Deliberately free of names, aliases, and glossary text.
 */
export function buildResolutionContext(mentions: EntityMention[]): string {
  if (mentions.length === 0) return "No known entities were referenced.";
  return mentions
    .map((m) => {
      const ambiguity =
        m.candidateIds.length > 1
          ? " (ambiguous — include all candidates and mark needs_confirmation)"
          : "";
      return `${m.placeholder}: ${m.entityType} candidate id(s): ${m.candidateIds.join(", ")}${ambiguity}`;
    })
    .join("\n");
}

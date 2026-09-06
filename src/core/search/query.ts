import type { DateTime } from "luxon";
import { detectTemporalPhrases, resolveTemporal, resolveTemporalRange, type TemporalRelation } from "@/core/interpretation/temporal";

/**
 * Search query parsing (spec §10.7, §10.8.6; Phase 2 Step 10). Keywords go
 * to PostgreSQL full-text search; a date phrase ("due Friday", "by Sept 12",
 * "this weekend") becomes a due window through the deterministic temporal
 * resolver. No model is involved.
 */
export interface DueWindow {
  /** ISO dates, inclusive, in the user's zone. */
  start: string;
  end: string;
}

export interface ParsedSearch {
  keywords: string;
  due: DueWindow | null;
  /** The phrase that produced `due`, as typed. */
  phrase: string | null;
  note: string | null;
}

// Words that carry no search meaning once a date window is present:
// "things due Friday" means "items due Friday".
const FILLER = /\b(things?|items?|stuff|tasks?|events?|anything|everything|what'?s|whats|show|find|list|me|all|is|are|due)\b/gi;

function windowFor(date: string, relation: TemporalRelation, today: string): DueWindow {
  switch (relation) {
    case "before":
    case "within":
    case "duration_after":
      return today <= date ? { start: today, end: date } : { start: date, end: today };
    case "after":
      return { start: date, end: shiftDays(date, 30) };
    default:
      return { start: date, end: date };
  }
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function parseSearchQuery(text: string, ctx: { now: DateTime }): ParsedSearch {
  const today = ctx.now.toISODate()!;
  let due: DueWindow | null = null;
  let phrase: string | null = null;
  let note: string | null = null;
  let remaining = text;

  for (const p of detectTemporalPhrases(text)) {
    // "Sept 12–14": the detector stops at the first day; extend over a range tail.
    const tail = /^\s*[–—-]\s*\d{1,2}(?:st|nd|rd|th)?\b/.exec(text.slice(p.end));
    const end = tail ? p.end + tail[0].length : p.end;
    const literal = text.slice(p.start, end);
    // In a search, "due Friday" asks for that day; "by Friday" asks for everything up to it.
    const relation: TemporalRelation = /^(due|on)\b/i.test(literal) ? "on" : p.relation;
    const range = resolveTemporalRange(literal, { now: ctx.now });
    if (range?.kind === "dates") {
      due = { start: range.start, end: range.endInclusive };
    } else if (range?.kind === "instants") {
      due = { start: range.start.local.slice(0, 10), end: range.end.local.slice(0, 10) };
    } else {
      const r = resolveTemporal(literal, relation, { now: ctx.now });
      if (r.kind === "date") due = windowFor(r.date, relation, today);
      else if (r.kind === "instant") due = windowFor(r.local.slice(0, 10), relation, today);
      else if (r.kind === "needs_confirmation" && r.suggestions.length > 0) {
        const sorted = [...r.suggestions].sort();
        due = { start: sorted[0], end: sorted[sorted.length - 1] };
        note = `“${literal}” could mean ${sorted.join(" or ")}; showing both.`;
      } else continue;
    }
    phrase = literal;
    remaining = text.slice(0, p.start) + " " + text.slice(end);
    break;
  }

  let keywords = remaining;
  if (due) keywords = keywords.replace(FILLER, " ");
  keywords = keywords.replace(/\s+/g, " ").trim();
  return { keywords, due, phrase, note };
}

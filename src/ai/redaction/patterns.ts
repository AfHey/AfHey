/**
 * Deterministic detectors for the privacy guard (product-spec §13.2). One
 * tested module owns every pattern. The guard is a last-resort leakage
 * detector, not de-identification: it deliberately over-matches in places
 * (capitalized name pairs) and under-matches in others (unlabeled dates).
 * The non-PHI input policy remains primary.
 */

export type RedactionType =
  | "mrn"
  | "dob"
  | "phone"
  | "email"
  | "address"
  | "name";

export interface RedactionSpan {
  type: RedactionType;
  start: number;
  end: number;
}

interface Detector {
  type: RedactionType;
  pattern: RegExp;
  /** Apply the capitalized-pair stopword/honorific damper to matches. */
  pairFilter?: boolean;
}

// Words that start a capitalized pair without being a person name. Small and
// deliberate — this is a false-positive damper, never a privacy whitelist
// (unknown names still match; these words are not names at all).
const WEEKDAYS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);
const MONTHS = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);
const NAME_PAIR_STOPWORDS = new Set([
  ...WEEKDAYS,
  ...MONTHS,
  "the", "this", "that", "next", "last", "every",
]);
// Sentence-initial imperative verbs ("Add Neri", "Call Ada"): the verb is not
// a name, and a lone first name after a lowercase verb is not masked either,
// so this only removes a false positive that the preview could never repair
// (edits are re-guarded in full). None of these words is a plausible given
// name (eval-v2, 2026-09-05).
const LEADING_VERBS = new Set([
  "add", "ask", "book", "bring", "buy", "call", "cancel", "check", "confirm", "contact",
  "email", "finish", "follow", "invite", "meet", "message", "order", "pay", "ping", "prepare",
  "remind", "reply", "return", "review", "schedule", "send", "submit", "tell", "text", "thank",
  "update", "visit", "write",
]);

const DETECTORS: Detector[] = [
  // Labeled medical record numbers: "MRN 1234567", "MRN#: 1234567".
  { type: "mrn", pattern: /\bMRN\s*[#:]?\s*\d{4,12}\b/gi },
  // Standalone long digit runs (7-12) that are not part of a formatted phone
  // or date; conservative catch-all for record identifiers.
  { type: "mrn", pattern: /(?<![\d/.\-()+])\d{7,12}(?![\d/.\-])/g },
  // Labeled dates of birth: "DOB: 4/12/1961", "born 1961-04-12",
  // "date of birth 04-12-1961".
  {
    type: "dob",
    pattern:
      /\b(?:DOB|date of birth|born(?: on)?)\s*[:\-]?\s*(?:\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/gi,
  },
  // Phone numbers: +1 (555) 123-4567, 555-123-4567, 555.123.4567, +49 30 ...
  {
    type: "phone",
    pattern:
      /(?<![\w.])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}[\s.-]\d{3,4}(?:[\s.-]\d{3,4})?(?![\w-])|(?<![\w.])\+\d{7,15}\b/g,
  },
  { type: "email", pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  // Street addresses: number + words + street suffix (+ optional unit).
  {
    type: "address",
    pattern:
      /\b\d{1,6}\s+(?:[A-Z][\w']*\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Place|Pl|Way|Terrace|Circle|Cir)\.?(?:,?\s*(?:Apt|Suite|Unit|#)\s*\w+)?\b/g,
  },
  // Honorific + capitalized name(s): "Dr. Nowak", "Mrs Ada Byron-Smith".
  {
    type: "name",
    pattern:
      /\b(?:Dr|Mr|Mrs|Ms|Mx|Prof|Professor)\.?\s+[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?/g,
  },
  // Bare capitalized pairs: "Ada Byron". Over-matches place names by design;
  // the redaction preview lets the user restore false positives, and edits
  // are re-guarded in full.
  {
    type: "name",
    pattern: /\b[A-Z][a-z'-]{1,20}\s+[A-Z][a-z'-]{1,20}\b/g,
    pairFilter: true,
  },
];

/** All spans found in `text`, sorted, longest-first on ties, overlaps removed. */
export function detectSpans(text: string): RedactionSpan[] {
  const raw: RedactionSpan[] = [];
  for (const { type, pattern, pairFilter } of DETECTORS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      if (pairFilter) {
        const verdict = classifyPair(match[0], text.slice(match.index + match[0].length, match.index + match[0].length + 6));
        if (verdict === "not-a-name-first-word") {
          // The first word is not a name; the second may start a real pair
          // ("Call Ada Byron" → "Ada Byron"), so rescan from it.
          pattern.lastIndex = match.index + match[0].split(/\s+/)[0].length;
          continue;
        }
        if (verdict === "not-a-name") continue;
      }
      raw.push({ type, start: match.index, end: match.index + match[0].length });
    }
  }
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: RedactionSpan[] = [];
  let lastEnd = -1;
  for (const span of raw) {
    if (span.start >= lastEnd) {
      result.push(span);
      lastEnd = span.end;
    } else if (span.end > lastEnd) {
      // Partial overlap: extend coverage with a trimmed span of this type.
      result.push({ type: span.type, start: lastEnd, end: span.end });
      lastEnd = span.end;
    }
  }
  return result;
}

const HONORIFICS = new Set(["dr", "mr", "mrs", "ms", "mx", "prof", "professor"]);

type PairVerdict = "name" | "not-a-name-first-word" | "not-a-name";

function classifyPair(match: string, following = ""): PairVerdict {
  const words = match.split(/\s+/).map((w) => w.toLowerCase().replace(/\.$/, ""));
  if (words[0] !== undefined && (NAME_PAIR_STOPWORDS.has(words[0]) || LEADING_VERBS.has(words[0]))) {
    return "not-a-name-first-word";
  }
  // "Dentist February 30", "Retreat September 12", "Appointment Thursday": a
  // capitalized word followed by a weekday, or by a month and a day number, is
  // a date phrase, not a surname (eval-v2, 2026-09-05). A month without a day
  // number ("Theresa May") is still masked.
  const last = words[words.length - 1];
  if (last !== undefined && (WEEKDAYS.has(last) || (MONTHS.has(last) && /^\s+\d{1,2}(?!\d)/.test(following)))) {
    return "not-a-name";
  }
  // Pairs touching an honorific belong to the honorific detector, which also
  // captures the name that follows; matching them here splits the span.
  return words.some((w) => HONORIFICS.has(w)) ? "not-a-name" : "name";
}

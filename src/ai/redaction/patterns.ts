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
const NAME_PAIR_STOPWORDS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "the", "this", "that", "next", "last", "every",
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
    for (const match of text.matchAll(pattern)) {
      if (pairFilter && isStopwordPair(match[0])) continue;
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

function isStopwordPair(match: string): boolean {
  const words = match.split(/\s+/).map((w) => w.toLowerCase().replace(/\.$/, ""));
  if (words[0] !== undefined && NAME_PAIR_STOPWORDS.has(words[0])) return true;
  // Pairs touching an honorific belong to the honorific detector, which also
  // captures the name that follows; matching them here splits the span.
  return words.some((w) => HONORIFICS.has(w));
}

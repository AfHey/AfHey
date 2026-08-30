/**
 * Normalization used for PersonAlias and GlossaryEntry uniqueness and for
 * deterministic entity resolution (Step 9): lowercase, trimmed, internal
 * whitespace collapsed, diacritics stripped.
 */
export function normalizeLookupKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

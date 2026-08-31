/**
 * Entity-resolution suite (plan test list B, resolution cases): placeholder
 * substitution, tier confidences, guard merging, and the product-owner
 * ambiguity rule — multiple matches become candidates, never an error.
 */
import { describe, expect, it } from "vitest";
import type { LexiconEntry } from "./lexicon";
import { buildResolutionContext, prepareProviderPayload } from "./resolve";

const P1 = "c0000000-0000-4000-8000-000000000001";
const P2 = "c0000000-0000-4000-8000-000000000002";
const PROJ = "b0000000-0000-4000-8000-000000000001";

const entry = (
  phrase: string,
  entityType: "person" | "project",
  entityId: string,
  tier: LexiconEntry["tier"],
): LexiconEntry => ({ phrase, normalized: phrase.toLowerCase(), entityType, entityId, tier });

describe("prepareProviderPayload", () => {
  it("substitutes an alias match with a person placeholder and high confidence", () => {
    const result = prepareProviderPayload("email Priya about the review", [
      entry("Priya", "person", P1, "alias"),
    ]);
    expect(result.payloadText).toBe("email [PERSON_1] about the review");
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      placeholder: "[PERSON_1]",
      entityType: "person",
      candidateIds: [P1],
      confidence: "high",
    });
    const occ = result.mentions[0].occurrences[0];
    expect(result.payloadText.slice(occ.payloadStart, occ.payloadEnd)).toBe("[PERSON_1]");
  });

  it("two people named Sarah resolve to one mention with both candidates, not an error", () => {
    const result = prepareProviderPayload("ask Sarah for the quote", [
      entry("Sarah", "person", P1, "person_first_name"),
      entry("Sarah", "person", P2, "person_first_name"),
    ]);
    expect(result.payloadText).toBe("ask [PERSON_1] for the quote");
    expect(result.mentions[0].candidateIds).toEqual([P1, P2]);
    expect(result.mentions[0].confidence).toBe("needs_confirmation");
  });

  it("a unique first-name match is medium confidence", () => {
    const result = prepareProviderPayload("ping Priya today", [
      entry("Priya", "person", P1, "person_first_name"),
    ]);
    expect(result.mentions[0].confidence).toBe("medium");
  });

  it("matches project names and glossary terms case-insensitively to one shared placeholder", () => {
    const result = prepareProviderPayload(
      "move the aurora data pipeline launch; ADP review is Friday",
      [
        entry("Aurora Data Pipeline", "project", PROJ, "project_name"),
        entry("ADP", "project", PROJ, "glossary"),
      ],
    );
    expect(result.payloadText).toBe("move the [PROJECT_1] launch; [PROJECT_1] review is Friday");
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0].occurrences).toHaveLength(2);
    expect(result.mentions[0].candidateIds).toEqual([PROJ]);
  });

  it("prefers the longest overlapping phrase match", () => {
    const result = prepareProviderPayload("talk to Priya Raman tomorrow", [
      entry("Priya", "person", P1, "alias"),
      entry("Priya Raman", "person", P1, "person_name"),
    ]);
    expect(result.payloadText).toBe("talk to [PERSON_1] tomorrow");
  });

  it("absorbs an overlapping guard name-span so nothing leaks around the token", () => {
    // Lexicon only knows the first name; the guard's capitalized-pair
    // detector sees "Priya Raman" — the mention must swallow the whole pair.
    const result = prepareProviderPayload("talk to Priya Raman tomorrow", [
      entry("Priya", "person", P1, "alias"),
    ]);
    expect(result.payloadText).toBe("talk to [PERSON_1] tomorrow");
    expect(result.payloadText).not.toContain("Raman");
    expect(result.redactions).toHaveLength(0);
  });

  it("leaves unknown identifiers to the guard and known-free text untouched", () => {
    const result = prepareProviderPayload(
      "email Zork Fenwick at zf@example.org, then buy detergent",
      [entry("Priya", "person", P1, "alias")],
    );
    expect(result.mentions).toHaveLength(0);
    expect(result.payloadText).toBe(
      "email [REDACTED_NAME_1] at [REDACTED_EMAIL_1], then buy detergent",
    );
    expect(result.redactions.map((r) => r.type)).toEqual(["name", "email"]);
  });

  it("does not match inside words", () => {
    const result = prepareProviderPayload("the ADPQ dashboard broke", [
      entry("ADP", "project", PROJ, "glossary"),
    ]);
    expect(result.mentions).toHaveLength(0);
  });
});

describe("buildResolutionContext", () => {
  it("lists placeholders with candidate ids and ambiguity, and never names", () => {
    const result = prepareProviderPayload("ask Sarah about Aurora Data Pipeline", [
      entry("Sarah", "person", P1, "person_first_name"),
      entry("Sarah", "person", P2, "person_first_name"),
      entry("Aurora Data Pipeline", "project", PROJ, "project_name"),
    ]);
    const context = buildResolutionContext(result.mentions);
    expect(context).toContain(`[PERSON_1]: person candidate id(s): ${P1}, ${P2}`);
    expect(context).toContain("ambiguous");
    expect(context).toContain(`[PROJECT_1]: project candidate id(s): ${PROJ}`);
    expect(context).not.toMatch(/Sarah|Aurora/);
  });
});

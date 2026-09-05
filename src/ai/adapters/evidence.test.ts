import { describe, expect, it } from "vitest";
import { snapEvidence } from "./evidence";
import type { ExtractionResult } from "./extraction-contract";

const P1 = "c0000000-0000-4000-8000-000000000001";
const payload = "email [PERSON_1] about the tile order tomorrow, then call again tomorrow night";

const item: ExtractionResult["items"][number] = {
  item_ref: "item-1",
  depends_on_item_refs: [],
  entity_type: "task",
  fields: { title: "email about the tile order" },
  temporal_expressions: [
    { field: "deadline", literal: "Tomorrow", relation: "on", anchor_entity_id: null, evidence: { start: 30, end: 38 }, confidence: "high" },
    { field: "deadline", literal: "tomorrow night", relation: "on", anchor_entity_id: null, evidence: { start: 55, end: 69 }, confidence: "high" },
  ],
  entity_references: [
    { field: "people", candidate_ids: [P1], unresolved_literal: null, evidence: { start: 3, end: 13 }, confidence: "high" },
  ],
  field_evidence: [
    { field: "title", evidence: { start: 0, end: 20 }, confidence: "high", quote: "email [PERSON_1] about the tile order" },
    { field: "task_kind", evidence: { start: 0, end: 5 }, confidence: "medium", quote: null },
  ],
};

describe("snapEvidence", () => {
  it("re-anchors literals, placeholders, and quotes to their nearest real occurrence", () => {
    const snapped = snapEvidence(
      { schema_version: "1", prompt_version: "t", items: [item] },
      { payloadText: payload, mentions: [{ placeholder: "[PERSON_1]", entityType: "person", candidateIds: [P1], confidence: "high" }], currentDateTime: "2026-09-01T09:00:00-04:00", timezone: "America/New_York" },
    ).items[0];
    const slice = (e: { start: number; end: number }) => payload.slice(e.start, e.end);
    expect(slice(snapped.temporal_expressions[0].evidence)).toBe("tomorrow");
    expect(snapped.temporal_expressions[0].evidence.start).toBe(38); // nearest of two occurrences
    expect(slice(snapped.temporal_expressions[1].evidence)).toBe("tomorrow night");
    expect(slice(snapped.entity_references[0].evidence)).toBe("[PERSON_1]");
    expect(slice(snapped.field_evidence[0].evidence)).toBe("email [PERSON_1] about the tile order");
    // No quote → untouched.
    expect(snapped.field_evidence[1].evidence).toEqual({ start: 0, end: 5 });
  });

  it("collapses the span to zero length when the literal is not in the payload", () => {
    const snapped = snapEvidence(
      { schema_version: "1", prompt_version: "t", items: [{ ...item, temporal_expressions: [{ ...item.temporal_expressions[0], literal: "yesterday" }] }] },
      { payloadText: payload, mentions: [], currentDateTime: "2026-09-01T09:00:00-04:00", timezone: "America/New_York" },
    ).items[0];
    expect(snapped.temporal_expressions[0].evidence).toEqual({ start: 30, end: 30 });
  });
});

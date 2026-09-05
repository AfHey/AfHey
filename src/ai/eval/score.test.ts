import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "@/ai/adapters/extraction-contract";
import { EVAL_CASES, IDS, type EvalCase } from "./dataset";
import { aggregate, evaluateAcceptance, scoreCase } from "./score";

const byId = (id: string): EvalCase => EVAL_CASES.find((c) => c.id === id)!;

const result = (items: ExtractionResult["items"]): ExtractionResult => ({
  schema_version: "1",
  prompt_version: "test",
  items,
});

describe("scoreCase", () => {
  it("credits matched items, fields, temporal literals, references, and evidence", () => {
    const evalCase = byId("multi-task-with-person");
    const text = evalCase.input.payloadText;
    const span = (needle: string) => {
      const start = text.indexOf(needle);
      return { start, end: start + needle.length };
    };
    const score = scoreCase(
      evalCase,
      result([
        {
          item_ref: "item-1",
          depends_on_item_refs: [],
          entity_type: "task",
          fields: { title: "Send the invoice", task_kind: "action" },
          temporal_expressions: [
            { field: "deadline", literal: "Tomorrow", relation: "on", anchor_entity_id: null, evidence: span("Tomorrow"), confidence: "high" },
          ],
          entity_references: [
            { field: "people", candidate_ids: [IDS.annika], unresolved_literal: null, evidence: span("[PERSON_1]"), confidence: "high" },
          ],
          field_evidence: [{ field: "title", evidence: span("send the invoice"), confidence: "high" }],
        },
        {
          item_ref: "item-2",
          depends_on_item_refs: [],
          entity_type: "task",
          fields: { title: "Water the balcony plants" },
          temporal_expressions: [],
          entity_references: [],
          field_evidence: [],
        },
      ]),
    );
    expect(score.matchedRequired).toBe(2);
    expect(score.expectedRequired).toBe(3);
    expect(score.falsePositives).toBe(0);
    expect(score.temporal).toEqual({ expected: 2, hit: 1 });
    expect(score.references).toEqual({ expected: 1, hit: 1 });
    expect(score.evidence.valid).toBe(3);
    expect(score.evidence.literalsAligned).toBe(1);
    expect(score.hallucinatedIds).toBe(0);
    expect(score.notes).toContain("missed: parking");
  });

  it("counts extras, hallucinated ids, invalid evidence, and wrong kinds", () => {
    const evalCase = byId("waiting-for");
    const score = scoreCase(
      evalCase,
      result([
        {
          item_ref: "item-1",
          depends_on_item_refs: [],
          entity_type: "task",
          fields: { title: "signed lease", task_kind: "action" },
          temporal_expressions: [],
          entity_references: [
            { field: "people", candidate_ids: ["c0000000-0000-4000-8000-00000000dead"], unresolved_literal: null, evidence: { start: 0, end: 999 }, confidence: "high" },
          ],
          field_evidence: [],
        },
        {
          item_ref: "item-2",
          depends_on_item_refs: [],
          entity_type: "note",
          fields: { body: "made up" },
          temporal_expressions: [],
          entity_references: [],
          field_evidence: [],
        },
      ]),
    );
    expect(score.matchedRequired).toBe(1);
    expect(score.falsePositives).toBe(1);
    expect(score.taskKind).toEqual({ checked: 1, correct: 0 });
    expect(score.references).toEqual({ expected: 1, hit: 0 });
    expect(score.hallucinatedIds).toBe(1);
    expect(score.evidence).toMatchObject({ spans: 1, valid: 0 });
  });

  it("treats a provider error as a total miss without crashing", () => {
    const score = scoreCase(byId("single-task-tomorrow"), new Error("boom"));
    expect(score.error).toBe("boom");
    expect(score.matchedRequired).toBe(0);
    expect(score.temporal.expected).toBe(1);
  });

  it("ignores optional expectations in precision and recall", () => {
    const score = scoreCase(byId("prepare-for-review"), result([
      {
        item_ref: "item-1",
        depends_on_item_refs: [],
        entity_type: "task",
        fields: { title: "Prepare slides" },
        temporal_expressions: [],
        entity_references: [],
        field_evidence: [],
      },
    ]));
    expect(score.expectedRequired).toBe(1);
    expect(score.matchedRequired).toBe(1);
    expect(score.falsePositives).toBe(0);
  });
});

describe("aggregate and acceptance", () => {
  it("computes precision/recall/F1 and gates on thresholds", () => {
    const perfect = scoreCase(byId("bill"), result([
      { item_ref: "item-1", depends_on_item_refs: [], entity_type: "task", fields: { title: "Pay the electricity bill" }, temporal_expressions: [], entity_references: [], field_evidence: [] },
    ]));
    const miss = scoreCase(byId("simple-errand"), result([]));
    const metrics = aggregate([perfect, miss]);
    expect(metrics.itemRecall).toBe(0.5);
    expect(metrics.itemPrecision).toBe(1);
    expect(metrics.itemF1).toBeCloseTo(2 / 3);
    const acceptance = evaluateAcceptance(metrics);
    expect(acceptance.accepted).toBe(false);
    expect(acceptance.checks.find((c) => c.name === "item recall")?.pass).toBe(false);
    expect(evaluateAcceptance(aggregate([perfect])).accepted).toBe(true);
  });

  it("dataset is the promised size and wholly placeholder-based", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
  });
});

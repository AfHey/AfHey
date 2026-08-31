/**
 * Deterministic extraction stand-in for tests, CI, and local development.
 * Live OpenAI extraction stays disabled until the versioned evaluation
 * passes (decisions.md 2026-08-30); until then every flow runs against this.
 *
 * Rules (deliberately simple and stable):
 * - each non-empty line becomes one item: "note:"-prefixed lines are notes,
 *   everything else a task titled with the line text
 * - a small set of temporal keywords becomes temporal_expressions
 * - placeholder occurrences become entity_references with the given
 *   candidate ids ([PROJECT_n] -> project_id, [PERSON_n] -> people)
 */
import type { ExtractionResult } from "./extraction-contract";
import { extractionResultSchema } from "./extraction-contract";
import type { ExtractionInput, ExtractionProvider } from "./types";

export const FAKE_PROMPT_VERSION = "fake-1";

const TEMPORAL_KEYWORDS = [
  "tomorrow afternoon",
  "tomorrow",
  "today",
  "tonight",
  "next week",
  "this weekend",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

export class FakeExtractionProvider implements ExtractionProvider {
  readonly name = "fake";

  extract(input: ExtractionInput): Promise<ExtractionResult> {
    const items: ExtractionResult["items"] = [];
    const text = input.payloadText;
    let lineStart = 0;
    for (const rawLine of text.split("\n")) {
      const lineEnd = lineStart + rawLine.length;
      const trimmed = rawLine.trim();
      if (trimmed !== "") {
        const contentStart = lineStart + rawLine.indexOf(trimmed);
        const isNote = /^note:/i.test(trimmed);
        const bodyText = isNote ? trimmed.replace(/^note:\s*/i, "") : trimmed;
        const itemRef = `item-${items.length + 1}`;
        const evidence = { start: contentStart, end: contentStart + trimmed.length };

        const temporal: ExtractionResult["items"][number]["temporal_expressions"] = [];
        const lower = rawLine.toLowerCase();
        for (const keyword of TEMPORAL_KEYWORDS) {
          const index = lower.indexOf(keyword);
          if (index >= 0 && !temporal.some((t) => t.evidence.start === lineStart + index)) {
            temporal.push({
              field: "deadline",
              literal: rawLine.slice(index, index + keyword.length),
              relation: "on",
              anchor_entity_id: null,
              evidence: { start: lineStart + index, end: lineStart + index + keyword.length },
              confidence: "medium",
            });
          }
        }

        const references: ExtractionResult["items"][number]["entity_references"] = [];
        for (const mention of input.mentions) {
          const index = rawLine.indexOf(mention.placeholder);
          if (index >= 0) {
            references.push({
              field: mention.entityType === "project" ? "project_id" : "people",
              candidate_ids: mention.candidateIds,
              unresolved_literal: null,
              evidence: {
                start: lineStart + index,
                end: lineStart + index + mention.placeholder.length,
              },
              confidence: mention.confidence,
            });
          }
        }

        items.push({
          item_ref: itemRef,
          depends_on_item_refs: [],
          entity_type: isNote ? "note" : "task",
          fields: isNote
            ? { body: bodyText }
            : { title: bodyText, task_kind: "action" },
          temporal_expressions: temporal,
          entity_references: references,
          field_evidence: [
            { field: isNote ? "body" : "title", evidence, confidence: "high" },
          ],
        });
      }
      lineStart = lineEnd + 1;
    }

    return Promise.resolve(
      extractionResultSchema.parse({
        schema_version: "1",
        prompt_version: FAKE_PROMPT_VERSION,
        items,
      }),
    );
  }
}

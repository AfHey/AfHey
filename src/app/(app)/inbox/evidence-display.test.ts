import { describe, expect, it } from "vitest";
import { selectDisplayEvidence } from "./evidence-display";

const op = {
  after: {
    title: "call the plumber",
    deadlineDate: "2026-09-02",
    context: null,
    peopleIds: [],
    projectId: null,
    taskKind: "action",
    computedPriorityScore: 50,
  },
  evidence: [
    { fieldPath: "title", literalText: "call the plumber", confidence: "high" },
    { fieldPath: "deadline", literalText: "Tomorrow", confidence: "medium" },
    { fieldPath: "context", literalText: "Tomorrow", confidence: "high" }, // context is null → hidden
    { fieldPath: "bucket", literalText: "Tomorrow call the plumber", confidence: "medium" }, // unknown → hidden
    { fieldPath: "people", literalText: "[PERSON_1]", confidence: "high" }, // no people → hidden
    { fieldPath: "title", literalText: "call the plumber", confidence: "high" }, // duplicate → once
    { fieldPath: "notes", literalText: null, confidence: "high" }, // empty literal, not expired → hidden
  ],
};

describe("selectDisplayEvidence", () => {
  it("shows only populated, labeled, deduplicated evidence", () => {
    expect(selectDisplayEvidence(op, false)).toEqual([
      { label: "title", literal: "call the plumber", confidence: "high" },
      { label: "date", literal: "Tomorrow", confidence: "medium" },
    ]);
  });

  it("keeps expired literals visible as such", () => {
    const expired = { ...op, evidence: [{ fieldPath: "title", literalText: null, confidence: "high" }] };
    expect(selectDisplayEvidence(expired, true)).toEqual([
      { label: "title", literal: null, confidence: "high" },
    ]);
  });
});

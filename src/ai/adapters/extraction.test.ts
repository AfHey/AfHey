/**
 * Step 10 adapter suite: §14.1 contract validation, deterministic fake
 * provider, bounded retry/backoff behavior, the final-payload guard, and
 * provider selection.
 */
import { afterEach, describe, expect, it } from "vitest";
import { extractionResultSchema } from "./extraction-contract";
import { FakeExtractionProvider } from "./fake-extraction";
import {
  createOpenAIClient,
  OpenAIExtractionProvider,
  PROVIDER_CLIENT_OPTIONS,
  type TransportRequest,
} from "./openai-extraction";
import { getExtractionProvider } from "./registry";
import { ExtractionProviderError, type ExtractionInput } from "./types";

const UUID = "c0000000-0000-4000-8000-000000000001";

const validItem = {
  item_ref: "item-1",
  depends_on_item_refs: [],
  entity_type: "task",
  fields: { title: "buy stamps" },
  temporal_expressions: [
    {
      field: "deadline",
      literal: "tomorrow",
      relation: "on",
      anchor_entity_id: null,
      evidence: { start: 0, end: 8 },
      confidence: "medium",
    },
  ],
  entity_references: [
    {
      field: "people",
      candidate_ids: [UUID],
      unresolved_literal: null,
      evidence: { start: 10, end: 20 },
      confidence: "high",
    },
  ],
  field_evidence: [{ field: "title", evidence: { start: 0, end: 10 }, confidence: "high" }],
};

const validResult = { schema_version: "1", prompt_version: "p-test", items: [validItem] };

describe("extraction contract", () => {
  it("accepts a valid result", () => {
    expect(() => extractionResultSchema.parse(validResult)).not.toThrow();
  });

  it.each([
    ["bad relation", { temporal_expressions: [{ ...validItem.temporal_expressions[0], relation: "around" }] }],
    ["inverted evidence", { field_evidence: [{ field: "title", evidence: { start: 9, end: 3 }, confidence: "high" }] }],
    ["non-uuid candidate", { entity_references: [{ ...validItem.entity_references[0], candidate_ids: ["evt_2911"] }] }],
    ["bad entity type", { entity_type: "block" }],
  ])("rejects %s", (_name, patch) => {
    expect(() =>
      extractionResultSchema.parse({
        ...validResult,
        items: [{ ...validItem, ...patch }],
      }),
    ).toThrow();
  });

  it("rejects duplicate and unknown item_refs", () => {
    expect(() =>
      extractionResultSchema.parse({ ...validResult, items: [validItem, validItem] }),
    ).toThrow(/duplicate item_ref/);
    expect(() =>
      extractionResultSchema.parse({
        ...validResult,
        items: [{ ...validItem, depends_on_item_refs: ["item-9"] }],
      }),
    ).toThrow(/unknown item_ref/);
  });
});

const fakeInput: ExtractionInput = {
  payloadText:
    "email [PERSON_1] about the tile order tomorrow\nnote: grout samples live in the garage",
  mentions: [
    {
      placeholder: "[PERSON_1]",
      entityType: "person",
      candidateIds: [UUID],
      confidence: "high",
    },
  ],
  currentDateTime: "2026-08-31T09:00:00-04:00",
  timezone: "America/New_York",
};

describe("fake provider", () => {
  it("is deterministic and contract-valid", async () => {
    const provider = new FakeExtractionProvider();
    const first = await provider.extract(fakeInput);
    const second = await provider.extract(fakeInput);
    expect(second).toEqual(first);
    expect(() => extractionResultSchema.parse(first)).not.toThrow();
  });

  it("maps lines, placeholders, and temporal keywords", async () => {
    const result = await new FakeExtractionProvider().extract(fakeInput);
    expect(result.items).toHaveLength(2);
    const [task, note] = result.items;
    expect(task.entity_type).toBe("task");
    expect(task.fields.title).toBe("email [PERSON_1] about the tile order tomorrow");
    expect(task.entity_references[0]).toMatchObject({ field: "people", candidate_ids: [UUID] });
    expect(task.temporal_expressions[0]).toMatchObject({ literal: "tomorrow", relation: "on" });
    // Evidence spans index into the payload text.
    const t = task.temporal_expressions[0];
    expect(fakeInput.payloadText.slice(t.evidence.start, t.evidence.end)).toBe("tomorrow");
    expect(note.entity_type).toBe("note");
    expect(note.fields.body).toBe("grout samples live in the garage");
  });
});

describe("OpenAI provider retry and guard behavior", () => {
  const goodResponse = JSON.stringify(validResult);
  const sleeps: number[] = [];
  const sleep = (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  };

  afterEach(() => {
    sleeps.length = 0;
  });

  it("retries transient failures with backoff and succeeds", async () => {
    let attempts = 0;
    const provider = new OpenAIExtractionProvider({
      transport: () => {
        attempts += 1;
        if (attempts < 3) return Promise.reject(new Error("rate limited"));
        return Promise.resolve(goodResponse);
      },
      sleep,
    });
    const result = await provider.extract(fakeInput);
    expect(result.items).toHaveLength(1);
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("retries schema-invalid output and gives up after two retries", async () => {
    let attempts = 0;
    const provider = new OpenAIExtractionProvider({
      transport: () => {
        attempts += 1;
        return Promise.resolve('{"schema_version":"2","items":[]}');
      },
      sleep,
    });
    await expect(provider.extract(fakeInput)).rejects.toThrow(ExtractionProviderError);
    expect(attempts).toBe(3);
  });

  it("recovers from one invalid-JSON response", async () => {
    let attempts = 0;
    const provider = new OpenAIExtractionProvider({
      transport: () => {
        attempts += 1;
        return Promise.resolve(attempts === 1 ? "not json {" : goodResponse);
      },
      sleep,
    });
    await expect(provider.extract(fakeInput)).resolves.toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("guards the complete assembled payload immediately before transmission", async () => {
    const seen: TransportRequest[] = [];
    const provider = new OpenAIExtractionProvider({
      transport: (request) => {
        seen.push(request);
        return Promise.resolve(goodResponse);
      },
      sleep,
    });
    // Simulate an upstream miss: a phone number survived into the payload.
    await provider.extract({
      ...fakeInput,
      payloadText: "call the clinic at 555-123-4567 tomorrow",
    });
    expect(seen[0].userContent).not.toContain("555-123-4567");
    expect(seen[0].userContent).toContain("[REDACTED_PHONE_1]");
    expect(seen[0].userContent).toContain("RESOLUTION CONTEXT");
    expect(seen[0].model).toBe("gpt-5.4-mini-2026-03-17");
  });

  it("requires a key or transport", () => {
    expect(() => new OpenAIExtractionProvider({})).toThrow(/API key/);
  });

  it("owns retrying: the SDK client is created with retries disabled and a per-attempt timeout (finding 9)", () => {
    const client = createOpenAIClient("test-key-not-real");
    expect(client.maxRetries).toBe(0);
    expect(client.timeout).toBe(PROVIDER_CLIENT_OPTIONS.timeout);
  });

  it("forwards the intent key to every attempt", async () => {
    const seen: TransportRequest[] = [];
    const provider = new OpenAIExtractionProvider({
      transport: (request) => {
        seen.push(request);
        return seen.length < 2 ? Promise.reject(new Error("blip")) : Promise.resolve(goodResponse);
      },
      sleep,
    });
    await provider.extract({ ...fakeInput, intentKey: "intent-1" });
    expect(seen.map((r) => r.intentKey)).toEqual(["intent-1", "intent-1"]);
  });

  it("stops retrying once the total time budget is spent", async () => {
    let clock = 0;
    let attempts = 0;
    const provider = new OpenAIExtractionProvider({
      transport: () => {
        attempts += 1;
        clock += 200_000; // each attempt burns far more than the budget
        return Promise.reject(new Error("slow failure"));
      },
      sleep,
      now: () => clock,
    });
    await expect(provider.extract(fakeInput)).rejects.toThrow(/after 1 attempt/);
    expect(attempts).toBe(1);
  });
});

describe("provider registry", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env.EXTRACTION_PROVIDER = saved.EXTRACTION_PROVIDER;
    process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
  });

  it("defaults to the fake provider", () => {
    delete process.env.EXTRACTION_PROVIDER;
    expect(getExtractionProvider().name).toBe("fake");
  });

  it("selects openai only with a key present", () => {
    process.env.EXTRACTION_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    expect(() => getExtractionProvider()).toThrow(/OPENAI_API_KEY/);
    process.env.OPENAI_API_KEY = "test-key-not-real";
    expect(getExtractionProvider().name).toBe("openai");
  });

  it("rejects unknown modes", () => {
    process.env.EXTRACTION_PROVIDER = "banana";
    expect(() => getExtractionProvider()).toThrow(/Unknown EXTRACTION_PROVIDER/);
  });
});

/**
 * OpenAI ExtractionProvider (spec §12.7, decisions.md 2026-08-30): pinned
 * snapshot, Responses API with strict JSON-schema structured outputs, and
 * exactly one retry layer (finding 9): the SDK's own retries are disabled,
 * this adapter makes at most three attempts within a total time budget, and
 * the caller's intent key travels with every request as metadata. The
 * privacy guard runs on the complete assembled payload immediately before
 * every transmission (spec §13.2) — belt and braces over the upstream guard.
 */
import OpenAI from "openai";
import { runGuard } from "@/ai/redaction/guard";
import { snapEvidence } from "./evidence";
import { extractionResultSchema, type ExtractionResult } from "./extraction-contract";
import {
  buildUserContent,
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_MODEL,
  SYSTEM_PROMPT,
} from "./extraction-prompt";
import { ExtractionProviderError, type ExtractionInput, type ExtractionProvider } from "./types";

export interface TransportRequest {
  model: string;
  systemPrompt: string;
  userContent: string;
  /** Stable identifier of the user's intent; forwarded as request metadata. */
  intentKey?: string;
}

/** Sends one request and returns the raw output text. Injectable for tests. */
export type ExtractionTransport = (request: TransportRequest) => Promise<string>;

/** One call is the target; two bounded retries (spec §14). */
export const MAX_ATTEMPTS = 3;
/** Wall-clock cap across all attempts, including backoff. */
export const TOTAL_TIME_BUDGET_MS = 120_000;
/** SDK options: no SDK-level retries (this adapter owns retrying), per-attempt timeout. */
export const PROVIDER_CLIENT_OPTIONS = { maxRetries: 0, timeout: 60_000 } as const;

export function createOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, ...PROVIDER_CLIENT_OPTIONS });
}

/** The real Responses API transport; exported so evaluations can wrap and observe it. */
export function createOpenAITransport(apiKey: string): ExtractionTransport {
  const client = createOpenAIClient(apiKey);
  return async ({ model, systemPrompt, userContent, intentKey }) => {
    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "afhey_extraction",
          strict: true,
          schema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      metadata: intentKey ? { intent_key: intentKey } : undefined,
    });
    return response.output_text;
  };
}

export class OpenAIExtractionProvider implements ExtractionProvider {
  readonly name = "openai";
  private readonly transport: ExtractionTransport;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: {
    apiKey?: string;
    transport?: ExtractionTransport;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  }) {
    if (!options.transport && !options.apiKey) {
      throw new ExtractionProviderError("OpenAI extraction needs an API key");
    }
    this.transport = options.transport ?? createOpenAITransport(options.apiKey!);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    // Final-payload guard immediately before transmission (spec §13.2). The
    // upstream pipeline already guarded the capture; this catches anything
    // the assembled prompt would otherwise leak.
    const userContent = runGuard(buildUserContent(input)).redactedText;
    const startedAt = this.now();

    let lastError: unknown;
    let attempts = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const backoff = 500 * 2 ** (attempt - 1);
        if (this.now() - startedAt + backoff > TOTAL_TIME_BUDGET_MS) break;
        await this.sleep(backoff);
      }
      attempts += 1;
      try {
        const raw = await this.transport({
          model: EXTRACTION_MODEL,
          systemPrompt: SYSTEM_PROMPT,
          userContent,
          intentKey: input.intentKey,
        });
        return snapEvidence(extractionResultSchema.parse(JSON.parse(raw)), input);
      } catch (error) {
        lastError = error;
      }
    }
    throw new ExtractionProviderError(
      `extraction failed after ${attempts} attempt(s) within the time budget: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      lastError,
    );
  }
}

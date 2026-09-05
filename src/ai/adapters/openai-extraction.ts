/**
 * OpenAI ExtractionProvider (spec §12.7, decisions.md 2026-08-30): pinned
 * snapshot, Responses API with strict JSON-schema structured outputs, at
 * most two bounded retries with backoff, server-side key only. The privacy
 * guard runs on the complete assembled payload immediately before every
 * transmission (spec §13.2) — belt and braces over the upstream guard.
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
}

/** Sends one request and returns the raw output text. Injectable for tests. */
export type ExtractionTransport = (request: TransportRequest) => Promise<string>;

const MAX_RETRIES = 2; // one call is the target; two bounded retries (§14)

function defaultTransport(apiKey: string): ExtractionTransport {
  const client = new OpenAI({ apiKey });
  return async ({ model, systemPrompt, userContent }) => {
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
    });
    return response.output_text;
  };
}

export class OpenAIExtractionProvider implements ExtractionProvider {
  readonly name = "openai";
  private readonly transport: ExtractionTransport;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: {
    apiKey?: string;
    transport?: ExtractionTransport;
    sleep?: (ms: number) => Promise<void>;
  }) {
    if (!options.transport && !options.apiKey) {
      throw new ExtractionProviderError("OpenAI extraction needs an API key");
    }
    this.transport = options.transport ?? defaultTransport(options.apiKey!);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    // Final-payload guard immediately before transmission (spec §13.2). The
    // upstream pipeline already guarded the capture; this catches anything
    // the assembled prompt would otherwise leak.
    const userContent = runGuard(buildUserContent(input)).redactedText;

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await this.sleep(500 * 2 ** (attempt - 1));
      try {
        const raw = await this.transport({
          model: EXTRACTION_MODEL,
          systemPrompt: SYSTEM_PROMPT,
          userContent,
        });
        return snapEvidence(extractionResultSchema.parse(JSON.parse(raw)), input);
      } catch (error) {
        lastError = error;
      }
    }
    throw new ExtractionProviderError(
      `extraction failed after ${MAX_RETRIES + 1} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      lastError,
    );
  }
}

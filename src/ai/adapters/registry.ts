import { requiredEnv } from "@/lib/env";
import { FakeExtractionProvider } from "./fake-extraction";
import { OpenAIExtractionProvider } from "./openai-extraction";
import { ExtractionProviderError, type ExtractionProvider } from "./types";

/**
 * Provider selection. Default is the deterministic fake: live OpenAI
 * extraction is opt-in via EXTRACTION_PROVIDER=openai and gated on the
 * versioned evaluation passing (decisions.md 2026-08-30). Long-lived keys
 * stay server-side only.
 */
export function getExtractionProvider(): ExtractionProvider {
  const mode = process.env.EXTRACTION_PROVIDER ?? "fake";
  switch (mode) {
    case "fake":
      return new FakeExtractionProvider();
    case "openai":
      return new OpenAIExtractionProvider({ apiKey: requiredEnv("OPENAI_API_KEY") });
    default:
      throw new ExtractionProviderError(`Unknown EXTRACTION_PROVIDER: ${mode}`);
  }
}

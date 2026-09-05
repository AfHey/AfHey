/**
 * Deterministic provider for eval-v2: returns the case's scripted "correct"
 * extraction for the guarded payload it actually receives, so the run
 * measures everything downstream of the model (guard, resolution, temporal
 * arithmetic, evidence, persistence, undo). The case is identified by the
 * intent key the orchestrator forwards. Like the real adapter, it records the
 * exact payload that would leave the process, guarded once more.
 */
import { extractionResultSchema, type ExtractionResult } from "@/ai/adapters/extraction-contract";
import { buildUserContent } from "@/ai/adapters/extraction-prompt";
import type { ExtractionInput, ExtractionProvider } from "@/ai/adapters/types";
import { runGuard } from "@/ai/redaction/guard";

export const SCRIPTED_PROMPT_VERSION = "scripted-v2";

export type ScriptedExtraction = (input: ExtractionInput) => ExtractionResult;

export function intentKeyFor(caseId: string, runId: string, attempt: number): string {
  return `eval-v2:${caseId}:${runId}:${attempt}`;
}

export function caseIdFromIntentKey(intentKey: string | undefined): string | null {
  if (!intentKey) return null;
  const parts = intentKey.split(":");
  return parts[0] === "eval-v2" && parts.length >= 3 ? parts[1] : null;
}

export class ScriptedExtractionProvider implements ExtractionProvider {
  readonly name = "scripted";

  constructor(
    private readonly scripts: Record<string, ScriptedExtraction>,
    private readonly onOutbound: (payload: string) => void = () => {},
  ) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    this.onOutbound(runGuard(buildUserContent(input)).redactedText);
    const caseId = caseIdFromIntentKey(input.intentKey);
    const script = caseId ? this.scripts[caseId] : undefined;
    if (!script) {
      throw new Error(`no scripted extraction for intent key ${input.intentKey ?? "(none)"}`);
    }
    return extractionResultSchema.parse(script(input));
  }
}

/**
 * Runs eval-v2 (review finding 22) end to end against the disposable test
 * database and writes a report to docs/evals/:
 *   npm run eval:pipeline            # pinned OpenAI model (needs OPENAI_API_KEY)
 *   npm run eval:pipeline -- --fake  # scripted correct extractions: pipeline-only check
 * Outbound payloads are intercepted at the transport for the real provider,
 * so privacy checks see exactly what left the process.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXTRACTION_MODEL, PROMPT_VERSION } from "../src/ai/adapters/extraction-prompt";
import { createOpenAITransport, OpenAIExtractionProvider } from "../src/ai/adapters/openai-extraction";
import type { ExtractionProvider } from "../src/ai/adapters/types";
import { EVAL_V2_CASES, scriptsFor } from "../src/ai/eval/v2/cases";
import { renderReport, runEvalV2 } from "../src/ai/eval/v2/run";
import { SCRIPTED_PROMPT_VERSION, ScriptedExtractionProvider } from "../src/ai/eval/v2/scripted-provider";
import { loadLocalEnv } from "../src/lib/env";
import { resetTestDatabase } from "../tests/helpers/test-db";

loadLocalEnv();
const useFake = process.argv.includes("--fake");
// --case <id-prefix>: run one case for diagnosis; prints the report, writes no files.
const caseArg = process.argv.indexOf("--case");
const onlyCase = caseArg >= 0 ? process.argv[caseArg + 1] : undefined;

async function main() {
  const outbound: string[] = [];
  let provider: ExtractionProvider;
  if (useFake) {
    provider = new ScriptedExtractionProvider(scriptsFor(EVAL_V2_CASES), (p) => outbound.push(p));
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set; add it to .env or use --fake");
    const real = createOpenAITransport(apiKey);
    provider = new OpenAIExtractionProvider({
      transport: (request) => {
        outbound.push(request.userContent);
        return real(request);
      },
    });
  }

  const db = await resetTestDatabase();
  try {
    const result = await runEvalV2(db, {
      provider,
      outbound,
      cases: onlyCase ? EVAL_V2_CASES.filter((c) => c.id.startsWith(onlyCase)) : undefined,
      model: useFake ? "scripted" : EXTRACTION_MODEL,
      promptVersion: useFake ? SCRIPTED_PROMPT_VERSION : PROMPT_VERSION,
      onCase: (r) => process.stdout.write(`${r.passed ? "." : r.errored ? "E" : "F"}`),
    });
    process.stdout.write("\n");
    const slug = `${result.datasetVersion}-${result.promptVersion}-${result.provider}`;
    const dir = join(process.cwd(), "docs", "evals");
    mkdirSync(dir, { recursive: true });
    const md = renderReport(result);
    console.log(md);
    if (onlyCase) {
      console.log(JSON.stringify(result.results.map((r) => ({ id: r.id, outcomes: r.outcomes, raw: r.raw })), null, 2));
    } else {
      writeFileSync(join(dir, `${slug}.md`), md);
      writeFileSync(join(dir, `${slug}.json`), JSON.stringify(result, null, 2));
      console.log(`Report written to docs/evals/${slug}.md`);
    }
    if (!result.acceptance.accepted) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Runs the versioned extraction evaluation (product-spec §14.3) and writes a
 * report to docs/evals/. Live runs cost API calls and need OPENAI_API_KEY:
 *   npm run eval:extraction            # pinned OpenAI model
 *   npm run eval:extraction -- --fake  # deterministic provider, pipeline check
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXTRACTION_MODEL, PROMPT_VERSION } from "../src/ai/adapters/extraction-prompt";
import { FakeExtractionProvider, FAKE_PROMPT_VERSION } from "../src/ai/adapters/fake-extraction";
import { OpenAIExtractionProvider } from "../src/ai/adapters/openai-extraction";
import type { ExtractionProvider } from "../src/ai/adapters/types";
import { EVAL_CASES, EVAL_DATASET_VERSION } from "../src/ai/eval/dataset";
import { aggregate, evaluateAcceptance, scoreCase, type CaseScore } from "../src/ai/eval/score";
import { loadLocalEnv } from "../src/lib/env";

loadLocalEnv();
const useFake = process.argv.includes("--fake");
const CONCURRENCY = 3;

async function main() {
  let provider: ExtractionProvider;
  if (useFake) {
    provider = new FakeExtractionProvider();
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set; add it to .env or use --fake");
    provider = new OpenAIExtractionProvider({ apiKey });
  }

  const queue = [...EVAL_CASES];
  const scores: CaseScore[] = [];
  const raw: Record<string, unknown> = {};
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const evalCase = queue.shift()!;
        try {
          const result = await provider.extract(evalCase.input);
          raw[evalCase.id] = result;
          scores.push(scoreCase(evalCase, result));
        } catch (error) {
          scores.push(scoreCase(evalCase, error instanceof Error ? error : new Error(String(error))));
        }
        process.stdout.write(".");
      }
    }),
  );
  process.stdout.write("\n");
  scores.sort((a, b) => a.caseId.localeCompare(b.caseId));

  const metrics = aggregate(scores);
  const acceptance = evaluateAcceptance(metrics);
  const ranAt = new Date().toISOString();
  const promptVersion = useFake ? FAKE_PROMPT_VERSION : PROMPT_VERSION;
  const model = useFake ? "fake" : EXTRACTION_MODEL;
  const slug = `${EVAL_DATASET_VERSION}-${promptVersion}-${useFake ? "fake" : "openai"}`;
  const dir = join(process.cwd(), "docs", "evals");
  mkdirSync(dir, { recursive: true });

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const md = [
    `# Extraction evaluation — ${slug}`,
    "",
    `- Run at: ${ranAt}`,
    `- Provider / model: ${provider.name} / ${model}`,
    `- Prompt version: ${promptVersion}`,
    `- Dataset version: ${EVAL_DATASET_VERSION} (${EVAL_CASES.length} fictional cases)`,
    `- Acceptance: **${acceptance.accepted ? "PASS" : "FAIL"}**`,
    "",
    "## Metrics",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Item precision | ${pct(metrics.itemPrecision)} |`,
    `| Item recall | ${pct(metrics.itemRecall)} |`,
    `| Item F1 | ${pct(metrics.itemF1)} |`,
    `| task_kind accuracy | ${pct(metrics.taskKindAccuracy)} |`,
    `| event_kind accuracy | ${pct(metrics.eventKindAccuracy)} |`,
    `| Duration accuracy | ${pct(metrics.durationAccuracy)} |`,
    `| Temporal literal recall | ${pct(metrics.temporalRecall)} |`,
    `| Reference recall | ${pct(metrics.referenceRecall)} |`,
    `| Evidence validity | ${pct(metrics.evidenceValidity)} |`,
    `| Literal ↔ evidence alignment | ${pct(metrics.literalAlignment)} |`,
    `| Hallucinated ids | ${metrics.hallucinatedIds} |`,
    `| Provider errors | ${metrics.erroredCases} |`,
    "",
    "## Acceptance checks",
    "",
    "| Check | Threshold | Actual | Result |",
    "|---|---|---|---|",
    ...acceptance.checks.map((c) => `| ${c.name} | ${c.threshold} | ${c.actual} | ${c.pass ? "pass" : "FAIL"} |`),
    "",
    "## Per-case notes",
    "",
    ...scores.map((s) => {
      const status = s.error
        ? `ERROR ${s.error}`
        : `${s.matchedRequired}/${s.expectedRequired} matched, ${s.falsePositives} extra`;
      const notes = s.notes.length ? ` — ${s.notes.join("; ")}` : "";
      return `- \`${s.caseId}\`: ${status}${notes}`;
    }),
    "",
  ].join("\n");

  writeFileSync(join(dir, `${slug}.md`), md);
  writeFileSync(
    join(dir, `${slug}.json`),
    JSON.stringify({ ranAt, provider: provider.name, model, promptVersion, datasetVersion: EVAL_DATASET_VERSION, metrics, acceptance, scores, raw }, null, 2),
  );
  console.log(md);
  console.log(`Report written to docs/evals/${slug}.md`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

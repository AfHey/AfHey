/**
 * eval-v2 deterministic gate (review finding 22): the review's 20 held-out
 * cases run end to end with scripted correct extractions, so every check on
 * persisted Proposal fields, evidence, privacy, authorization, undo, and
 * concurrency is enforced in CI independently of the model. The live model
 * run uses the same cases via `npm run eval:pipeline`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVAL_V2_CASES, scriptsFor } from "@/ai/eval/v2/cases";
import { runEvalV2 } from "@/ai/eval/v2/run";
import { SCRIPTED_PROMPT_VERSION, ScriptedExtractionProvider } from "@/ai/eval/v2/scripted-provider";
import type { PrismaClient } from "@/db/generated/client";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;

beforeAll(async () => {
  db = await resetTestDatabase();
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

describe("eval-v2 through the persisted pipeline (scripted extractions)", () => {
  it("passes every case and the acceptance gate", async () => {
    const outbound: string[] = [];
    const provider = new ScriptedExtractionProvider(scriptsFor(EVAL_V2_CASES), (p) => outbound.push(p));
    const result = await runEvalV2(db, { provider, outbound, model: "scripted", promptVersion: SCRIPTED_PROMPT_VERSION });
    const failures = result.results.flatMap((r) =>
      r.checks.filter((k) => !k.pass).map((k) => `${r.id}: ${k.name}${k.detail ? ` — ${k.detail}` : ""}`),
    );
    expect(failures).toEqual([]);
    expect(result.metrics.cases).toBe(20);
    expect(result.acceptance.accepted).toBe(true);
  }, 120_000);
});

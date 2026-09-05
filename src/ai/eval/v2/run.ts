/**
 * eval-v2 runner: executes each case against a real database through the
 * complete capture pipeline, tallies checks per category with denominators,
 * counts extra operations as false positives, and applies the acceptance
 * gate. Cases run sequentially because they share UserSettings (timezone).
 */
import { DateTime } from "luxon";
import type { ExtractionProvider } from "@/ai/adapters/types";
import { processCaptureWithExtraction, type ExtractionOutcome } from "@/core/captures/extract";
import { createCapture } from "@/core/captures/service";
import type { PrismaClient } from "@/db/generated/client";
import { newUuid } from "@/lib/ids";
import { EVAL_V2_CASES, EVAL_V2_VERSION, nowFor } from "./cases";
import { intentKeyFor } from "./scripted-provider";
import type {
  AcceptanceCheck,
  CaseEnv,
  CaseResult,
  CaseRun,
  CategoryTally,
  Check,
  CheckCategory,
  EvalV2Case,
  EvalV2Metrics,
  EvalV2Result,
} from "./types";

const CATEGORIES: CheckCategory[] = [
  "items", "titles", "dates", "ranges", "participants", "links",
  "ambiguity", "privacy", "authorization", "undo", "evidence", "concurrency",
];

export interface RunOptions {
  provider: ExtractionProvider;
  /** Shared, mutable list the provider/transport interceptor appends to. */
  outbound: string[];
  model: string;
  promptVersion: string;
  cases?: EvalV2Case[];
  runId?: string;
  onCase?: (result: CaseResult) => void;
}

export async function runEvalV2(db: PrismaClient, options: RunOptions): Promise<EvalV2Result> {
  const cases = options.cases ?? EVAL_V2_CASES;
  const runId = options.runId ?? newUuid().slice(0, 8);
  // Raw provider outputs are kept per intent key for the JSON report only;
  // checks never read them — they read persisted rows.
  const rawOutputs: Record<string, unknown> = {};
  const recording: ExtractionProvider = {
    name: options.provider.name,
    extract: async (input) => {
      const result = await options.provider.extract(input);
      rawOutputs[input.intentKey ?? `unkeyed-${Object.keys(rawOutputs).length}`] = result;
      return result;
    },
  };
  const env: CaseEnv = { db, provider: recording, outbound: options.outbound, runId };
  if (!(await db.userSettings.findFirst())) {
    await db.userSettings.create({ data: { user: { create: {} }, currentTimezone: "America/New_York" } });
  }

  const results: CaseResult[] = [];
  for (const c of cases) {
    const started = Date.now();
    await db.userSettings.updateMany({ data: { currentTimezone: c.zone } });
    env.outbound.length = 0;
    const now = nowFor(c);
    let attempt = 0;
    const tools = {
      now,
      runCapture: (text: string, opts: { editedPayloadText?: string } = {}) =>
        runCapture(db, env.provider, c, text, now, intentKeyFor(c.id, runId, ++attempt), opts.editedPayloadText),
    };

    let checks: Check[] = [];
    let runs: CaseRun[] = [];
    let errored = false;
    let fixture: Record<string, string> = {};
    try {
      fixture = c.fixture ? await c.fixture(db) : {};
      runs = c.execute ? await c.execute(env, tools, fixture) : [await tools.runCapture(c.text)];
      checks = await c.checks({ runs, env, tools, fixture });
    } catch (error) {
      errored = true;
      checks.push({
        name: "case executed without error",
        category: "items",
        pass: false,
        critical: true,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    const operations = runs.reduce((n, r) => n + (r.proposal?.operations.length ?? 0), 0);
    const result: CaseResult = {
      id: c.id,
      review: c.review,
      passed: !errored && checks.every((k) => k.pass),
      errored,
      checks,
      operations,
      extraOperations: Math.max(0, operations - c.expectedOperations),
      providerError: runs.some((r) => r.outcome.status === "failed"),
      durationMs: Date.now() - started,
      note: c.note,
      payloads: runs.map((r) => r.capture.redactedText ?? ""),
      persisted: runs.flatMap((r) => (r.proposal?.operations ?? []).map(compactOperation)),
      warnings: runs.flatMap((r) => r.warnings.map((w) => `${w.severity}: ${w.message}`)),
      raw: Object.fromEntries(Object.entries(rawOutputs).filter(([k]) => k.includes(`:${c.id}:`))),
      outcomes: runs.map((r) => ("reason" in r.outcome ? `${r.outcome.status}: ${r.outcome.reason}` : r.outcome.status)),
    };
    results.push(result);
    options.onCase?.(result);
  }

  const metrics = aggregate(results);
  return {
    datasetVersion: EVAL_V2_VERSION,
    provider: options.provider.name,
    model: options.model,
    promptVersion: options.promptVersion,
    ranAt: new Date().toISOString(),
    results,
    metrics,
    acceptance: evaluateAcceptance(metrics),
  };
}

async function runCapture(
  db: PrismaClient,
  provider: ExtractionProvider,
  c: EvalV2Case,
  text: string,
  now: DateTime,
  idempotencyKey: string,
  editedPayloadText?: string,
): Promise<CaseRun> {
  const capture = await createCapture(db, { text, sourceType: "typed" });
  let outcome: ExtractionOutcome;
  try {
    outcome = await processCaptureWithExtraction(db, capture.id, provider, { now, idempotencyKey, editedPayloadText });
  } catch (error) {
    outcome = { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
  const proposal = await db.proposal.findFirst({
    where: { captureId: capture.id },
    orderBy: { createdAt: "desc" },
    include: { operations: { orderBy: { sequence: "asc" }, include: { fieldEvidence: true } } },
  });
  const refreshed = await db.capture.findUniqueOrThrow({ where: { id: capture.id } });
  void c;
  return {
    captureId: capture.id,
    outcome,
    proposal,
    capture: refreshed,
    warnings: "warnings" in outcome ? outcome.warnings : [],
  };
}

const SHOWN_FIELDS = [
  "title", "name", "body", "taskKind", "deadlineDate", "deadlineAt", "deadlineTimezone", "deadlineType", "remindAt", "reminderTimezone",
  "startAt", "endAt", "allDayStartDate", "allDayEndDate", "timezone", "peopleIds", "waitingForPersonId",
  "projectId", "confidence", "kind",
];

function compactOperation(op: { entityType: string; op: string; after: unknown }): Record<string, unknown> {
  const a = (op.after ?? {}) as Record<string, unknown>;
  const shown: Record<string, unknown> = { op: op.op, entityType: op.entityType };
  for (const key of SHOWN_FIELDS) {
    if (a[key] !== undefined && a[key] !== null && !(Array.isArray(a[key]) && (a[key] as unknown[]).length === 0)) shown[key] = a[key];
  }
  return shown;
}

export function aggregate(results: CaseResult[]): EvalV2Metrics {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, { total: 0, passed: 0 }])) as Record<CheckCategory, CategoryTally>;
  let checks = 0;
  let checksPassed = 0;
  let criticalChecks = 0;
  let criticalPassed = 0;
  for (const r of results) {
    for (const k of r.checks) {
      checks += 1;
      byCategory[k.category].total += 1;
      if (k.pass) {
        checksPassed += 1;
        byCategory[k.category].passed += 1;
      }
      if (k.critical) {
        criticalChecks += 1;
        if (k.pass) criticalPassed += 1;
      }
    }
  }
  const operations = results.reduce((n, r) => n + r.operations, 0);
  const extraOperations = results.reduce((n, r) => n + r.extraOperations, 0);
  return {
    cases: results.length,
    casesPassed: results.filter((r) => r.passed).length,
    casesErrored: results.filter((r) => r.errored).length,
    checks,
    checksPassed,
    criticalChecks,
    criticalPassed,
    operations,
    extraOperations,
    falsePositiveRate: operations === 0 ? 0 : extraOperations / operations,
    providerErrors: results.filter((r) => r.providerError).length,
    byCategory,
  };
}

/**
 * Acceptance (finding 22): zero critical failures — every authoritative
 * date, privacy, and authorization check — zero provider errors, at most
 * one extra operation in ten, and at least 90% of all checks passing.
 */
export function evaluateAcceptance(m: EvalV2Metrics): { accepted: boolean; checks: AcceptanceCheck[] } {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const checks: AcceptanceCheck[] = [
    { name: "critical checks (dates, privacy, authorization)", threshold: "all pass", actual: `${m.criticalPassed}/${m.criticalChecks}`, pass: m.criticalPassed === m.criticalChecks },
    { name: "provider errors", threshold: "= 0", actual: String(m.providerErrors), pass: m.providerErrors === 0 },
    { name: "false-positive operations", threshold: "≤ 10%", actual: `${m.extraOperations}/${m.operations} (${pct(m.falsePositiveRate)})`, pass: m.falsePositiveRate <= 0.1 },
    { name: "all checks", threshold: "≥ 90%", actual: `${m.checksPassed}/${m.checks} (${pct(m.checks ? m.checksPassed / m.checks : 0)})`, pass: m.checks > 0 && m.checksPassed / m.checks >= 0.9 },
  ];
  return { accepted: checks.every((c) => c.pass), checks };
}

export function renderReport(result: EvalV2Result): string {
  const m = result.metrics;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const lines = [
    `# Pipeline evaluation — ${result.datasetVersion}-${result.promptVersion}-${result.provider}`,
    "",
    `- Run at: ${result.ranAt}`,
    `- Provider / model: ${result.provider} / ${result.model}`,
    `- Prompt version: ${result.promptVersion}`,
    `- Dataset: ${result.datasetVersion} — the independent review's 20 fictional held-out cases (docs/reviews/2026-09-05-phase1-review.md), run from raw capture through guard, resolution, provider, interpretation, and persisted Proposal; checks read persisted rows and intercepted outbound payloads.`,
    `- Acceptance: **${result.acceptance.accepted ? "PASS" : "FAIL"}**`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Cases passed | ${m.casesPassed}/${m.cases} |`,
    `| Cases errored | ${m.casesErrored} |`,
    `| Checks passed | ${m.checksPassed}/${m.checks} (${pct(m.checks ? m.checksPassed / m.checks : 0)}) |`,
    `| Critical checks passed | ${m.criticalPassed}/${m.criticalChecks} |`,
    `| Operations persisted | ${m.operations} |`,
    `| Extra (false-positive) operations | ${m.extraOperations} (${pct(m.falsePositiveRate)}) |`,
    `| Provider errors | ${m.providerErrors} |`,
    "",
    "## Acceptance checks",
    "",
    "| Check | Threshold | Actual | Result |",
    "|---|---|---|---|",
    ...result.acceptance.checks.map((c) => `| ${c.name} | ${c.threshold} | ${c.actual} | ${c.pass ? "pass" : "FAIL"} |`),
    "",
    "## Checks by category (denominators)",
    "",
    "| Category | Passed | Total | Rate |",
    "|---|---|---|---|",
    ...CATEGORIES.filter((c) => m.byCategory[c].total > 0).map((c) => {
      const t = m.byCategory[c];
      return `| ${c} | ${t.passed} | ${t.total} | ${pct(t.passed / t.total)} |`;
    }),
    "",
    "## Per-case results",
    "",
    "| # | Case | Result | Checks | Failed checks |",
    "|---|---|---|---|---|",
    ...result.results.map((r) => {
      const failed = r.checks.filter((k) => !k.pass).map((k) => `${k.name}${k.detail ? ` (${truncate(k.detail)})` : ""}`).join("; ");
      return `| ${r.review} | \`${r.id}\` | ${r.passed ? "pass" : r.errored ? "ERROR" : "FAIL"} | ${r.checks.filter((k) => k.pass).length}/${r.checks.length} | ${failed || "—"} |`;
    }),
    "",
    "## Case notes and deviations from the review's wording",
    "",
    ...result.results.filter((r) => r.note).map((r) => `- \`${r.id}\`: ${r.note}`),
    "",
    "## Persisted operations per case",
    "",
    ...result.results.flatMap((r) => [
      `### ${r.review}. \`${r.id}\``,
      "",
      ...r.payloads.map((p) => `- Guarded payload: \`${p.replace(/`/g, "'")}\``),
      ...(r.persisted.length ? r.persisted.map((p) => `- ${JSON.stringify(p)}`) : ["- (no operations persisted)"]),
      ...(r.warnings.length ? r.warnings.map((w) => `- warning — ${w}`) : []),
      ...r.outcomes.filter((o) => o !== "proposed").map((o) => `- outcome — ${o}`),
      "",
    ]),
  ];
  return lines.join("\n");
}

function truncate(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * eval-v2 (review finding 22): end-to-end evaluation types. A case is a raw
 * capture plus fixtures; it runs through guard → resolution → provider →
 * interpretation → persisted Proposal, and its checks read the persisted
 * Proposal, its operations and FieldEvidence rows, the Capture, and the
 * intercepted outbound payloads — never the provider output alone.
 */
import type { DateTime } from "luxon";
import type { ExtractionResult } from "@/ai/adapters/extraction-contract";
import type { ExtractionInput, ExtractionProvider } from "@/ai/adapters/types";
import type { ExtractionOutcome } from "@/core/captures/extract";
import type { InterpretationWarning } from "@/core/interpretation/pipeline";
import type {
  Capture,
  FieldEvidence,
  PrismaClient,
  Proposal,
  ProposalOperation,
} from "@/db/generated/client";

export type CheckCategory =
  | "items"
  | "titles"
  | "dates"
  | "ranges"
  | "participants"
  | "links"
  | "ambiguity"
  | "privacy"
  | "authorization"
  | "undo"
  | "evidence"
  | "concurrency";

export interface Check {
  name: string;
  category: CheckCategory;
  pass: boolean;
  /** Critical checks must all pass for acceptance: authoritative dates, privacy, authorization. */
  critical?: boolean;
  detail?: string;
}

export type PersistedOperation = ProposalOperation & { fieldEvidence: FieldEvidence[] };
export type PersistedProposal = Proposal & { operations: PersistedOperation[] };

export interface CaseRun {
  captureId: string;
  outcome: ExtractionOutcome;
  /** Latest persisted proposal for the capture, re-read from the database. */
  proposal: PersistedProposal | null;
  capture: Capture;
  warnings: InterpretationWarning[];
  /** Case-specific observations made during a custom execution. */
  extra?: Record<string, unknown>;
}

export interface CaseEnv {
  db: PrismaClient;
  provider: ExtractionProvider;
  /** Outbound payloads intercepted since the case started (transport-level for the real provider). */
  outbound: string[];
  runId: string;
}

export interface CaseTools {
  /** Runs one raw capture through the complete pipeline for the current case. */
  runCapture: (text: string, options?: { editedPayloadText?: string }) => Promise<CaseRun>;
  now: DateTime;
}

export interface CheckContext {
  runs: CaseRun[];
  env: CaseEnv;
  tools: CaseTools;
  fixture: Record<string, string>;
}

export interface EvalV2Case {
  id: string;
  /** Row number in the review's 20-case table. */
  review: number;
  text: string;
  /** Local wall-clock "now" in `zone`. */
  now: string;
  zone: string;
  /** Deviations from the review's wording or setup, and why. */
  note?: string;
  /** Operations a correct run produces; anything beyond counts as a false positive. */
  expectedOperations: number;
  fixture?: (db: PrismaClient) => Promise<Record<string, string>>;
  /** The correct provider output for the guarded payload; drives the deterministic run. */
  scripted: (input: ExtractionInput) => ExtractionResult;
  /** Custom execution (races, preview edits); default is one capture through the pipeline. */
  execute?: (env: CaseEnv, tools: CaseTools, fixture: Record<string, string>) => Promise<CaseRun[]>;
  checks: (ctx: CheckContext) => Promise<Check[]>;
}

export interface CaseResult {
  id: string;
  review: number;
  passed: boolean;
  errored: boolean;
  checks: Check[];
  operations: number;
  extraOperations: number;
  providerError: boolean;
  durationMs: number;
  note?: string;
  /** Guarded payload(s) the provider saw, and a compact view of persisted operations. */
  payloads: string[];
  persisted: Array<Record<string, unknown>>;
  warnings: string[];
  /** Raw provider outputs for this case, keyed by intent key (diagnostics only). */
  raw: Record<string, unknown>;
  /** Orchestrator outcome per run: status plus failure reason when any. */
  outcomes: string[];
}

export interface CategoryTally {
  total: number;
  passed: number;
}

export interface EvalV2Metrics {
  cases: number;
  casesPassed: number;
  casesErrored: number;
  checks: number;
  checksPassed: number;
  criticalChecks: number;
  criticalPassed: number;
  operations: number;
  extraOperations: number;
  falsePositiveRate: number;
  providerErrors: number;
  byCategory: Record<CheckCategory, CategoryTally>;
}

export interface AcceptanceCheck {
  name: string;
  threshold: string;
  actual: string;
  pass: boolean;
}

export interface EvalV2Result {
  datasetVersion: string;
  provider: string;
  model: string;
  promptVersion: string;
  ranAt: string;
  results: CaseResult[];
  metrics: EvalV2Metrics;
  acceptance: { accepted: boolean; checks: AcceptanceCheck[] };
}

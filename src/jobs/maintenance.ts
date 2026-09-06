import { DateTime } from "luxon";
import { markMissedBlocks } from "@/core/domain/blocks";
import { recoverApplyingProposals, type RecoveryOutcome } from "@/core/proposals/lifecycle";
import { recomputePriorities, type RecomputeSummary } from "@/core/scheduler/priority";
import type { PrismaClient } from "@/db/generated/client";
import { runCaptureExpiry, type ExpirySummary } from "./expire-capture-text";

/**
 * The maintenance job (Phase 2 Step 11): capture-text retention, recovery
 * of interrupted applies, the missed-block transition, and the priority
 * recompute, in that order. Each part is idempotent and reads `now`, so the
 * job is safe to run any time and as often as wanted. Nothing here is a
 * Proposal: retention and recovery are housekeeping, a missed block is a
 * fact about the clock, and computed priority is derived data (spec §7.1).
 */
export interface MaintenanceSummary {
  ranAt: string;
  expiry: ExpirySummary;
  recovered: RecoveryOutcome[];
  missedBlocks: number;
  priorities: RecomputeSummary;
}

export async function runMaintenance(db: PrismaClient, now: Date = new Date()): Promise<MaintenanceSummary> {
  const expiry = await runCaptureExpiry(db, now);
  const recovered = await recoverApplyingProposals(db, now);
  const missedBlocks = await markMissedBlocks(db, now);
  const zone = (await db.userSettings.findFirst())?.currentTimezone ?? "America/New_York";
  const priorities = await recomputePriorities(db, DateTime.fromJSDate(now).setZone(zone));
  return { ranAt: now.toISOString(), expiry, recovered, missedBlocks, priorities };
}

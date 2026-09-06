/**
 * One-line explanation of a scheduler run for the Proposal review header.
 * When the engine places nothing, the headline says why (spec §5.1 item 2:
 * a plan the user can trust must explain an empty result) instead of a bare
 * "nothing to change".
 */
export interface PlanSummaryDto {
  created: number;
  moved: number;
  cancelled: number;
  unplaced: Array<{ title: string; minutes: number; reason: string }>;
  estimateRequired: Array<{ title: string }>;
  feasibility: Array<{ title: string; status: string; shortfallMinutes: number }>;
  /** Eligible free minutes in the planned range from now, after buffers. */
  freeMinutes: number;
  /** Open, active, schedulable tasks with an estimate that were considered. */
  eligibleTasks: number;
  /** Eligible tasks whose remaining work is already covered by kept blocks. */
  alreadyPlanned: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function planHeadline(summary: PlanSummaryDto, operation: string, hasOperations: boolean): string {
  if (hasOperations) {
    return `${summary.created} to add · ${summary.moved} to move · ${summary.cancelled} to remove. Nothing is saved until you accept.`;
  }
  const range = operation.startsWith("plan_week") ? "week" : "day";
  const needEstimate = summary.estimateRequired.length;
  if (summary.eligibleTasks === 0 && needEstimate === 0) {
    return "Nothing to place: no open, active, schedulable tasks.";
  }
  const parts: string[] = [];
  if (summary.eligibleTasks > 0 && summary.freeMinutes === 0) {
    parts.push(`No free time left in this ${range}: availability, protected windows, and fixed events leave nothing to fill.`);
  } else if (summary.unplaced.length > 0) {
    parts.push(`${plural(summary.unplaced.length, "task")} cannot fit in the free time.`);
  }
  if (needEstimate > 0) parts.push(`${plural(needEstimate, "task")} need${needEstimate === 1 ? "s" : ""} an estimate before it can be scheduled.`);
  if (summary.alreadyPlanned > 0) {
    parts.push(
      summary.alreadyPlanned === summary.eligibleTasks && summary.unplaced.length === 0
        ? `All ${plural(summary.alreadyPlanned, "eligible task")} already planned.`
        : `${plural(summary.alreadyPlanned, "task")} already planned.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : "Nothing to change.";
}

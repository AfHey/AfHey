/**
 * Application-level mirrors of the product-spec §9 invariants. The database
 * CHECK constraints (initial migration) are the backstop; these validators
 * produce readable errors before a transaction is attempted, and also run on
 * Proposal payload drafts that have not touched the database yet.
 */
import type {
  ApprovalPolicy,
  DeadlineType,
  EventKind,
  ProjectKind,
  ScheduleType,
  TaskKind,
  TaskStatus,
} from "./enums";
import { isValidTimezone } from "./time";

export class DomainInvariantError extends Error {
  readonly violations: string[];

  constructor(entity: string, violations: string[]) {
    super(`${entity} violates domain invariants: ${violations.join("; ")}`);
    this.name = "DomainInvariantError";
    this.violations = violations;
  }
}

function assertNone(entity: string, violations: string[]): void {
  if (violations.length > 0) throw new DomainInvariantError(entity, violations);
}

export interface TaskShape {
  title: string;
  status: TaskStatus;
  taskKind: TaskKind;
  deadlineDate: Date | null;
  deadlineAt: Date | null;
  deadlineTimezone: string | null;
  deadlineType: DeadlineType | null;
  remindAt: Date | null;
  reminderTimezone: string | null;
  waitingForPersonId: string | null;
  nudgeDate: Date | null;
  estimatedDurationMinutes: number | null;
  remainingEstimateMinutes: number | null;
  computedPriorityScore: number;
  preferredWindowStartTime: Date | null;
  preferredWindowEndTime: Date | null;
  completedAt: Date | null;
}

export function taskViolations(task: TaskShape): string[] {
  const v: string[] = [];
  if (task.title.trim() === "") v.push("title must be non-empty");
  if (task.deadlineDate !== null && task.deadlineAt !== null) {
    v.push("deadline must use exactly one of date-only or instant mode");
  }
  if ((task.deadlineAt === null) !== (task.deadlineTimezone === null)) {
    v.push("deadline_at and deadline_timezone must be set together");
  }
  if (task.deadlineTimezone !== null && !isValidTimezone(task.deadlineTimezone)) {
    v.push(`deadline_timezone is not a valid IANA zone: ${task.deadlineTimezone}`);
  }
  const hasDeadline = task.deadlineDate !== null || task.deadlineAt !== null;
  if ((task.deadlineType !== null) !== hasDeadline) {
    v.push("deadline_type is required exactly when a deadline is present");
  }
  if ((task.taskKind === "reminder") !== (task.remindAt !== null)) {
    v.push("remind_at is required exactly for reminder tasks");
  }
  if ((task.remindAt === null) !== (task.reminderTimezone === null)) {
    v.push("remind_at and reminder_timezone must be set together");
  }
  if (task.reminderTimezone !== null && !isValidTimezone(task.reminderTimezone)) {
    v.push(`reminder_timezone is not a valid IANA zone: ${task.reminderTimezone}`);
  }
  if ((task.taskKind === "waiting_for") !== (task.waitingForPersonId !== null)) {
    v.push("waiting_for_person_id is required exactly for waiting_for tasks");
  }
  if (task.taskKind !== "waiting_for" && task.nudgeDate !== null) {
    v.push("nudge_date is only allowed on waiting_for tasks");
  }
  if ((task.status === "completed") !== (task.completedAt !== null)) {
    v.push("completed_at is required exactly when status is completed");
  }
  if (
    task.computedPriorityScore < 0 ||
    task.computedPriorityScore > 100 ||
    !Number.isInteger(task.computedPriorityScore)
  ) {
    v.push("computed_priority_score must be an integer from 0 through 100");
  }
  for (const [name, value] of [
    ["estimated_duration_minutes", task.estimatedDurationMinutes],
    ["remaining_estimate_minutes", task.remainingEstimateMinutes],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      v.push(`${name} must be a positive integer when present`);
    }
  }
  const start = task.preferredWindowStartTime;
  const end = task.preferredWindowEndTime;
  if ((start === null) !== (end === null)) {
    v.push("preferred window start and end must be set together");
  } else if (start !== null && end !== null && start.getTime() >= end.getTime()) {
    v.push("preferred window start must be before end (no overnight window in V1)");
  }
  return v;
}

export function assertTaskShape(task: TaskShape): void {
  assertNone("Task", taskViolations(task));
}

export interface EventShape {
  title: string;
  kind: EventKind;
  scheduleType: ScheduleType;
  blockState: string | null;
  isLocked: boolean;
  startAt: Date | null;
  endAt: Date | null;
  allDayStartDate: Date | null;
  allDayEndDate: Date | null;
  timezone: string;
  taskId: string | null;
}

export function eventViolations(event: EventShape): string[] {
  const v: string[] = [];
  if (event.title.trim() === "") v.push("title must be non-empty");
  if (!isValidTimezone(event.timezone)) {
    v.push(`timezone is not a valid IANA zone: ${event.timezone}`);
  }
  if ((event.kind === "block") !== (event.blockState !== null)) {
    v.push("block_state is required exactly for block events");
  }
  if ((event.kind === "block") !== (event.taskId !== null)) {
    v.push("task_id is required exactly for block events");
  }
  const timed = event.startAt !== null && event.endAt !== null;
  const allDay = event.allDayStartDate !== null && event.allDayEndDate !== null;
  const partialTimed = (event.startAt !== null) !== (event.endAt !== null);
  const partialAllDay =
    (event.allDayStartDate !== null) !== (event.allDayEndDate !== null);
  if (partialTimed || partialAllDay || timed === allDay) {
    v.push("event must be exactly one of timed (start/end) or all-day (dates)");
  }
  if (timed && event.startAt !== null && event.endAt !== null && event.endAt.getTime() <= event.startAt.getTime()) {
    v.push("end_at must be after start_at");
  }
  if (
    allDay &&
    event.allDayStartDate !== null &&
    event.allDayEndDate !== null &&
    event.allDayEndDate.getTime() <= event.allDayStartDate.getTime()
  ) {
    v.push("all_day_end_date (exclusive) must be after all_day_start_date");
  }
  if (event.scheduleType === "fixed" && event.isLocked) {
    v.push("a fixed event cannot be locked (lock is a pin on flexible events)");
  }
  return v;
}

export function assertEventShape(event: EventShape): void {
  assertNone("Event", eventViolations(event));
}

export interface WorkSessionShape {
  startedAt: Date;
  stoppedAt: Date | null;
  adjustedDurationMinutes: number | null;
  adjustmentReason: string | null;
}

export function workSessionViolations(ws: WorkSessionShape): string[] {
  const v: string[] = [];
  if (ws.stoppedAt !== null && ws.stoppedAt.getTime() <= ws.startedAt.getTime()) {
    v.push("stopped_at must be after started_at");
  }
  if ((ws.adjustedDurationMinutes === null) !== (ws.adjustmentReason === null)) {
    v.push("adjusted duration and adjustment reason must be set together");
  }
  if (
    ws.adjustedDurationMinutes !== null &&
    (!Number.isInteger(ws.adjustedDurationMinutes) || ws.adjustedDurationMinutes <= 0)
  ) {
    v.push("adjusted_duration_minutes must be a positive integer");
  }
  return v;
}

export interface ProposalPolicyShape {
  approvalPolicy: ApprovalPolicy;
  approvalTier: number | null;
}

export function proposalPolicyViolations(p: ProposalPolicyShape): string[] {
  const v: string[] = [];
  if ((p.approvalPolicy === "tiered") !== (p.approvalTier !== null)) {
    v.push("approval_tier is required exactly for tiered policy");
  }
  if (p.approvalTier !== null && (p.approvalTier < 0 || p.approvalTier > 3)) {
    v.push("approval_tier must be between 0 and 3");
  }
  // Phase 1 rule (spec §11.2 rule 7): every Proposal is explicit.
  if (p.approvalPolicy !== "explicit") {
    v.push("Phase 1 permits only approval_policy = explicit");
  }
  return v;
}

/**
 * Project hierarchy rule (spec §6): areas have no parent; a project may have
 * at most one parent, and that parent must be an area. One level only in V1,
 * which also makes cycles impossible once this rule holds.
 */
export function projectParentViolations(
  kind: ProjectKind,
  parent: { id: string; kind: ProjectKind } | null,
  selfId?: string,
): string[] {
  const v: string[] = [];
  if (kind === "area" && parent !== null) v.push("an area cannot have a parent");
  if (kind === "project" && parent !== null && parent.kind !== "area") {
    v.push("a project's parent must be an area (no project-to-project nesting in V1)");
  }
  if (parent !== null && selfId !== undefined && parent.id === selfId) {
    v.push("a project cannot be its own parent");
  }
  return v;
}

export function assertProjectParent(
  kind: ProjectKind,
  parent: { id: string; kind: ProjectKind } | null,
  selfId?: string,
): void {
  assertNone("Project", projectParentViolations(kind, parent, selfId));
}

import type { TaskBucket, TaskKind, UserPriority } from "@/core/domain/enums";

/** Serializable task row passed from server pages to client components. */
export interface TaskDto {
  id: string;
  title: string;
  completed: boolean;
  taskKind: TaskKind;
  bucket: TaskBucket;
  description: string | null;
  notes: string | null;
  projectId: string | null;
  projectName: string | null;
  deadlineDate: string | null;
  deadlineAt: string | null;
  deadlineTimezone: string | null;
  deadlineType: "hard" | "soft" | null;
  remindAt: string | null;
  reminderTimezone: string | null;
  waitingForPersonId: string | null;
  waitingForPersonName: string | null;
  nudgeDate: string | null;
  estimatedDurationMinutes: number | null;
  remainingEstimateMinutes: number | null;
  userPriority: UserPriority | null;
  effectivePriority: UserPriority;
  deadlineLabel: string | null;
  overdue: boolean;
}

export interface SelectOption {
  id: string;
  name: string;
}

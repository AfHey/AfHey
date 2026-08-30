import type { EventKind, ScheduleType } from "@/core/domain/enums";

export interface EventDto {
  id: string;
  title: string;
  kind: EventKind;
  scheduleType: ScheduleType;
  isLocked: boolean;
  startAt: string | null;
  endAt: string | null;
  allDayStartDate: string | null;
  allDayEndDate: string | null;
  timezone: string;
  projectId: string | null;
  projectName: string | null;
  location: string | null;
  description: string | null;
  notes: string | null;
  whenLabel: string;
  past: boolean;
}

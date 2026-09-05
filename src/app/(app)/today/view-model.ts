/**
 * Today view-model (product-spec §4; Phase 2 Step 9). Pure grouping and
 * arithmetic over serializable rows; the page loads, the client renders.
 */
import type { UserPriority } from "@/core/domain/enums";

export interface TodayBlockDto {
  id: string;
  taskId: string;
  title: string;
  start: string;
  end: string;
  state: "planned" | "in_progress" | "completed" | "missed_unconfirmed" | "cancelled";
  isLocked: boolean;
  scheduleType: "fixed" | "flexible";
  label: string;
}

export interface TodayEventDto {
  id: string;
  title: string;
  label: string;
  allDay: boolean;
  kind: string;
}

export interface TodayTaskDto {
  id: string;
  title: string;
  band: UserPriority;
  projectName: string | null;
  deadlineLabel: string | null;
  overdue: boolean;
  remainingEstimateMinutes: number | null;
  feasibility: "fits" | "at_risk" | "estimate_required" | "no_deadline" | "not_schedulable" | null;
  shortfallMinutes: number;
  hasBlockToday: boolean;
}

export interface WaitingDto {
  id: string;
  title: string;
  personName: string | null;
  nudgeLabel: string | null;
  nudgeDue: boolean;
}

export interface RolloverItemDto {
  blockId: string;
  taskId: string;
  title: string;
  label: string;
}

export interface CapacityDto {
  availableMinutes: number;
  scheduledMinutes: number;
  overcommittedMinutes: number;
}

export interface TodayData {
  date: string;
  zone: string;
  dateLabel: string;
  yesterday: string;
  fixed: TodayEventDto[];
  blocks: TodayBlockDto[];
  tasks: TodayTaskDto[];
  waiting: WaitingDto[];
  rollover: RolloverItemDto[];
  capacity: CapacityDto;
  activeSession: { id: string; taskId: string; eventId: string | null; startedAt: string; title: string } | null;
}

export const BANDS: Array<{ key: UserPriority; label: string }> = [
  { key: "must", label: "Must do" },
  { key: "should", label: "Should do" },
  { key: "could", label: "Could do" },
];

export function groupByBand(tasks: TodayTaskDto[]): Array<{ key: UserPriority; label: string; items: TodayTaskDto[] }> {
  return BANDS.map((b) => ({ ...b, items: tasks.filter((t) => t.band === b.key) }));
}

/** Minutes of planned or running work still ahead today. */
export function scheduledMinutesAhead(blocks: Array<{ start: string; end: string; state: TodayBlockDto["state"] }>, nowIso: string): number {
  const now = new Date(nowIso).getTime();
  return blocks
    .filter((b) => b.state === "planned" || b.state === "in_progress")
    .reduce((sum, b) => {
      const start = Math.max(new Date(b.start).getTime(), now);
      const end = new Date(b.end).getTime();
      return sum + Math.max(0, Math.round((end - start) / 60_000));
    }, 0);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

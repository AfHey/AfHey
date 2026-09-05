/**
 * Duplicate detection (product-spec §3.1 item 4): warn when an extracted item
 * closely matches an open item — title similarity plus the same project or
 * the same due window. Warnings inform the review; they never block.
 */
import { normalizeLookupKey } from "@/core/domain/normalize";
import type { PrismaClient } from "@/db/generated/client";

export interface DuplicateCandidate {
  itemRef: string;
  entityType: "task" | "event" | "note";
  title: string;
  projectId: string | null;
  /** ISO date of the deadline / start, when known. */
  dueDate: string | null;
}

export interface DuplicateWarning {
  itemRef: string;
  existingId: string;
  existingTitle: string;
  reason: string;
}

const SIMILARITY_THRESHOLD = 0.6;
const DUE_WINDOW_DAYS = 3;

function tokens(text: string): Set<string> {
  return new Set(normalizeLookupKey(text).split(/[^a-z0-9]+/).filter((t) => t.length > 1));
}

/** Jaccard similarity over normalized word tokens; 1 for identical titles. */
export function titleSimilarity(a: string, b: string): number {
  if (normalizeLookupKey(a) === normalizeLookupKey(b)) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

function daysApart(a: string, b: string): number {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

export async function findDuplicates(
  db: PrismaClient,
  candidates: DuplicateCandidate[],
): Promise<DuplicateWarning[]> {
  if (candidates.length === 0) return [];
  const [tasks, events, notes] = await Promise.all([
    db.task.findMany({
      where: { archivedAt: null, status: "open" },
      select: { id: true, title: true, projectId: true, deadlineDate: true, deadlineAt: true },
    }),
    db.event.findMany({
      where: { archivedAt: null },
      select: { id: true, title: true, projectId: true, startAt: true, allDayStartDate: true },
    }),
    db.note.findMany({
      where: { archivedAt: null },
      select: { id: true, title: true, body: true, projectId: true },
    }),
  ]);

  const warnings: DuplicateWarning[] = [];
  for (const candidate of candidates) {
    if (candidate.entityType === "task") {
      for (const task of tasks) {
        const similarity = titleSimilarity(candidate.title, task.title);
        if (similarity < SIMILARITY_THRESHOLD) continue;
        const existingDue = task.deadlineDate?.toISOString().slice(0, 10) ??
          task.deadlineAt?.toISOString().slice(0, 10) ?? null;
        const sameProject = candidate.projectId !== null && candidate.projectId === task.projectId;
        const sameWindow =
          candidate.dueDate !== null &&
          existingDue !== null &&
          daysApart(candidate.dueDate, existingDue) <= DUE_WINDOW_DAYS;
        const bothUnfiled =
          similarity === 1 && candidate.projectId === null && task.projectId === null;
        if (sameProject || sameWindow || bothUnfiled) {
          warnings.push({
            itemRef: candidate.itemRef,
            existingId: task.id,
            existingTitle: task.title,
            reason: sameProject
              ? "similar title in the same project"
              : sameWindow
                ? "similar title due in the same window"
                : "identical title, both unfiled",
          });
        }
      }
    } else if (candidate.entityType === "event") {
      for (const event of events) {
        if (titleSimilarity(candidate.title, event.title) < SIMILARITY_THRESHOLD) continue;
        const existingStart = event.startAt?.toISOString().slice(0, 10) ??
          event.allDayStartDate?.toISOString().slice(0, 10) ?? null;
        if (
          candidate.dueDate !== null &&
          existingStart !== null &&
          daysApart(candidate.dueDate, existingStart) <= 1
        ) {
          warnings.push({
            itemRef: candidate.itemRef,
            existingId: event.id,
            existingTitle: event.title,
            reason: "similar event around the same time",
          });
        }
      }
    } else {
      for (const note of notes) {
        const existingTitle = note.title ?? note.body.slice(0, 80);
        if (titleSimilarity(candidate.title, existingTitle) === 1) {
          warnings.push({
            itemRef: candidate.itemRef,
            existingId: note.id,
            existingTitle,
            reason: "a note with this title already exists",
          });
        }
      }
    }
  }
  return warnings;
}

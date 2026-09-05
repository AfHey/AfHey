/**
 * Block placement rules (product-spec §11.2 rule 2; Phase 2 Step 6).
 * Scheduler-placed blocks may not overlap fixed Events, other live blocks,
 * or protected windows (without an explicit override recorded on the
 * Proposal). Build time rejects such a Proposal outright; apply time
 * rechecks against the database under the apply transaction, so a fixed
 * Event added after the Proposal was computed makes it conflict rather than
 * double-book.
 */
import { DateTime } from "luxon";
import { loadSchedulerSettings } from "@/core/domain/scheduler-settings";
import { daysCovering, dayStart, localWindowOnDay, type Interval } from "@/core/scheduler/timeline";
import type { Prisma, PrismaClient } from "@/db/generated/client";
import { ProposalConflictError } from "./errors";

type Db = PrismaClient | Prisma.TransactionClient;

export interface PreparedLike {
  op: string;
  entityType: string;
  entityId: string;
  after: unknown;
  before: unknown;
}

interface ResultingBlock {
  entityId: string;
  start: number;
  end: number;
  label: string;
}

const iso = (ms: number, zone: string) => DateTime.fromMillis(ms, { zone }).toFormat("ccc d LLL HH:mm");

/** The blocks a proposal leaves in place after it applies, plus every event it touches. */
export function resultingBlocks(prepared: PreparedLike[]): { blocks: ResultingBlock[]; touched: Set<string> } {
  const blocks: ResultingBlock[] = [];
  const touched = new Set<string>();
  for (const p of prepared) {
    if (p.entityType !== "event") continue;
    touched.add(p.entityId);
    const after = (p.after ?? {}) as Record<string, unknown>;
    const before = (p.before ?? {}) as Record<string, unknown>;
    const kind = (after.kind ?? before.kind) as string | undefined;
    if (kind !== "block") continue;
    const state = (after.blockState ?? before.blockState) as string | undefined;
    if (p.op === "delete" || p.op === "archive" || state === "cancelled" || state === "completed") continue;
    const startRaw = (after.startAt ?? before.startAt) as string | Date | undefined;
    const endRaw = (after.endAt ?? before.endAt) as string | Date | undefined;
    if (!startRaw || !endRaw) continue;
    blocks.push({
      entityId: p.entityId,
      start: new Date(startRaw).getTime(),
      end: new Date(endRaw).getTime(),
      label: String(after.title ?? before.title ?? "block"),
    });
  }
  return { blocks, touched };
}

/** Timed events that consume time: every non-block event, and live blocks. */
async function occupyingEvents(db: Db, span: Interval, exclude: Set<string>) {
  return db.event.findMany({
    where: {
      archivedAt: null,
      id: { notIn: [...exclude] },
      startAt: { lt: new Date(span.end) },
      endAt: { gt: new Date(span.start) },
      OR: [{ kind: { not: "block" } }, { kind: "block", blockState: { in: ["planned", "in_progress"] } }],
    },
    select: { id: true, title: true, kind: true, startAt: true, endAt: true },
  });
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Build-time validation for scheduler-origin proposals. */
export async function schedulerPlacementProblems(
  db: Db,
  prepared: PreparedLike[],
  options: { allowProtectedOverride?: boolean } = {},
): Promise<string[]> {
  const { blocks, touched } = resultingBlocks(prepared);
  if (blocks.length === 0) return [];
  const settings = await loadSchedulerSettings(db);
  const zone = settings.timezone;
  const problems: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (overlaps(blocks[i], blocks[j])) {
        problems.push(`blocks "${blocks[i].label}" (${iso(blocks[i].start, zone)}) and "${blocks[j].label}" (${iso(blocks[j].start, zone)}) overlap`);
      }
    }
  }

  const span = { start: Math.min(...blocks.map((b) => b.start)), end: Math.max(...blocks.map((b) => b.end)) };
  const existing = await occupyingEvents(db, span, touched);
  for (const block of blocks) {
    for (const e of existing) {
      if (e.startAt && e.endAt && overlaps(block, { start: e.startAt.getTime(), end: e.endAt.getTime() })) {
        problems.push(`block "${block.label}" at ${iso(block.start, zone)} overlaps ${e.kind === "block" ? "block" : "fixed event"} "${e.title}"`);
      }
    }
    if (!options.allowProtectedOverride) {
      for (const dateIso of daysCovering(block.start, block.end, zone)) {
        const day = dayStart(dateIso, zone);
        for (const w of settings.protected) {
          const applies = w.recurrence === "weekly" ? w.weekday === day.weekday : w.onDate === dateIso;
          if (!applies) continue;
          const local = localWindowOnDay(day, w.startTime, w.endTime);
          if (local && overlaps(block, local)) {
            problems.push(`block "${block.label}" at ${iso(block.start, zone)} falls in the protected window ${w.label ?? `${w.startTime}–${w.endTime}`}`);
          }
        }
      }
    }
  }
  return problems;
}

/** Apply-time recheck inside the transaction (rule 4): the database may have changed since build. */
export async function assertBlockPlacementFree(
  tx: Db,
  block: { entityId: string; start: Date; end: Date; title: string },
  excludeEventIds: Set<string>,
): Promise<void> {
  const exclude = new Set([...excludeEventIds, block.entityId]);
  const clashes = await occupyingEvents(tx, { start: block.start.getTime(), end: block.end.getTime() }, exclude);
  if (clashes.length > 0) {
    throw new ProposalConflictError(
      clashes.map((e) => ({
        entityType: "event",
        entityId: block.entityId,
        reason: `block "${block.title}" would overlap ${e.kind === "block" ? "block" : "event"} "${e.title}" added or moved since the plan was computed`,
      })),
    );
  }
}

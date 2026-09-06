"use client";

import { DateTime } from "luxon";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend } from "@/lib/api";
import { planHeadline, type PlanSummaryDto } from "./plan-headline";

/**
 * Scheduler Proposal review (spec §5.1 item 2, §11.2 rule 11): the change
 * log as a calendar diff — create / move / cancel with the engine's reason —
 * with per-operation opt-out, explicit approval, and a single revert after
 * apply through conflict-aware undo. Used by the Calendar and Today screens.
 */

export interface PlanOperationDto {
  operationId: string;
  sequence: number;
  op: string;
  entityType: string;
  entityId: string;
  after: Record<string, unknown> | null;
  reason: string | null;
}

export interface PlanRunDto {
  operation: string;
  proposal: { id: string; status: string; operations: PlanOperationDto[] } | null;
  summary: PlanSummaryDto;
  /** Titles for operations whose payload carries none (moves, cancels). */
  labels: Record<string, string>;
}

const fmt = (value: unknown, zone: string) => DateTime.fromISO(String(value)).setZone(zone).toFormat("ccc d LLL HH:mm");
const fmtEnd = (value: unknown, zone: string) => DateTime.fromISO(String(value)).setZone(zone).toFormat("HH:mm");

export function describeOperation(op: PlanOperationDto, labels: Record<string, string>, zone: string): { verb: string; title: string; when: string } {
  const a = op.after ?? {};
  const title = String(a.title ?? labels[op.entityId] ?? "block");
  if (op.op === "create") return { verb: "Add", title, when: `${fmt(a.startAt, zone)} – ${fmtEnd(a.endAt, zone)}` };
  if (a.blockState === "cancelled") return { verb: "Remove", title, when: "" };
  if (a.startAt) return { verb: "Move", title, when: `to ${fmt(a.startAt, zone)} – ${fmtEnd(a.endAt, zone)}` };
  return { verb: "Update", title, when: "" };
}

export function PlanReview({ run, zone, onClose }: { run: PlanRunDto; zone: string; onClose: () => void }) {
  const router = useRouter();
  const [kept, setKept] = useState<Set<string>>(new Set(run.proposal?.operations.map((o) => o.operationId) ?? []));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const ops = run.proposal?.operations ?? [];
  const proposalId = run.proposal?.id;

  async function accept() {
    if (!proposalId) return;
    setBusy(true);
    setMessage(null);
    try {
      let targetId = proposalId;
      if (kept.size !== ops.length) {
        if (kept.size === 0) throw new Error("Keep at least one change, or reject the plan.");
        const revised = await apiSend<{ id: string }>(`/api/proposals/${proposalId}/operations`, "PUT", {
          operations: ops.filter((o) => kept.has(o.operationId)).map((o) => ({ sourceOperationId: o.operationId, entityType: o.entityType, after: o.after, dependsOn: [] })),
        });
        targetId = revised.id;
      }
      const result = await apiSend<{ outcome: string; action?: { id: string }; details?: Array<{ reason: string }>; reason?: string }>(`/api/proposals/${targetId}/approve`, "POST");
      if (result.outcome === "applied") {
        setMessage(`Applied ${kept.size} change${kept.size === 1 ? "" : "s"}.`);
        setActionId(result.action?.id ?? null);
        setFinished(true);
        router.refresh();
      } else if (result.outcome === "conflicted") {
        setMessage(`Not applied — ${result.details?.map((d) => d.reason).join("; ") ?? "the calendar changed meanwhile"}. Plan again.`);
        setFinished(true);
      } else {
        setMessage(`Not applied — ${result.reason ?? result.outcome}`);
        setFinished(true);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!proposalId) return onClose();
    setBusy(true);
    try {
      await apiSend(`/api/proposals/${proposalId}/reject`, "POST", { rejectCapture: false });
      onClose();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!actionId) return;
    setBusy(true);
    setMessage(null);
    try {
      const undoProposal = await apiSend<{ id: string; status: string; conflictDetails?: unknown }>(`/api/actions/${actionId}/undo`, "POST");
      if (undoProposal.status !== "pending") {
        setMessage("Cannot revert: something changed since the plan was applied.");
        return;
      }
      const result = await apiSend<{ outcome: string }>(`/api/proposals/${undoProposal.id}/approve`, "POST");
      setMessage(result.outcome === "applied" ? "Reverted." : `Not reverted — ${result.outcome}`);
      setActionId(null);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const s = run.summary;
  return (
    <section aria-label="Proposed plan" className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="display text-lg font-semibold">Proposed plan</h3>
          <p className="text-sm text-ink-soft" data-testid="plan-headline">{planHeadline(s, run.operation, ops.length > 0)}</p>
        </div>
        <button type="button" className="btn-quiet" onClick={onClose} aria-label="Close plan">×</button>
      </div>
      {ops.length > 0 ? (
        <ul className="divide-y divide-line border-y border-line">
          {ops.map((op) => {
            const d = describeOperation(op, run.labels, zone);
            return (
              <li key={op.operationId} className="flex items-start gap-3 py-2 text-sm">
                {!finished ? (
                  <input
                    type="checkbox"
                    aria-label={`Keep: ${d.verb} ${d.title}`}
                    checked={kept.has(op.operationId)}
                    onChange={(e) => {
                      const next = new Set(kept);
                      if (e.target.checked) next.add(op.operationId);
                      else next.delete(op.operationId);
                      setKept(next);
                    }}
                    className="mt-1 h-4 w-4 accent-[var(--brass)]"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div>
                    <strong>{d.verb}</strong> {d.title} <span className="text-ink-soft">{d.when}</span>
                  </div>
                  {op.reason ? <div className="text-xs text-ink-soft">{op.reason}</div> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {(s.unplaced.length > 0 || s.estimateRequired.length > 0 || s.feasibility.some((f) => f.status === "at_risk")) ? (
        <ul className="mt-3 space-y-1 text-sm text-ink-soft">
          {s.unplaced.map((u) => (
            <li key={`u-${u.title}`}>Could not place {u.minutes} min of “{u.title}”: {u.reason}.</li>
          ))}
          {s.estimateRequired.map((e) => (
            <li key={`e-${e.title}`}>“{e.title}” needs an estimate before it can be scheduled.</li>
          ))}
          {s.feasibility.filter((f) => f.status === "at_risk").map((f) => (
            <li key={`f-${f.title}`} className="text-danger">“{f.title}” will not fit before its deadline at current capacity (short {f.shortfallMinutes} min).</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!finished && ops.length > 0 ? (
          <>
            <button type="button" className="btn-primary" disabled={busy} onClick={accept}>
              Accept {kept.size === ops.length ? "all" : `${kept.size} of ${ops.length}`}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={reject}>Reject</button>
          </>
        ) : null}
        {finished && actionId ? (
          <button type="button" className="btn-ghost" disabled={busy} onClick={undo}>Undo this plan</button>
        ) : null}
        {finished ? <button type="button" className="btn-quiet" onClick={onClose}>Done</button> : null}
        {message ? <span role="status" className="text-sm text-ink-soft">{message}</span> : null}
      </div>
    </section>
  );
}

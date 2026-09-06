"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PlanReview, type PlanRunDto } from "@/components/plan-review";
import { PriorityTick } from "@/components/priority-tick";
import { apiSend } from "@/lib/api";
import { formatMinutes, groupByBand, type TodayData } from "./view-model";

/**
 * Today (product-spec §4): calm and focused — fixed events, planned blocks
 * with the focus timer, Must/Should/Could tasks with feasibility, Waiting
 * For, the capacity check, and the roll-over prompt. Planning and roll-over
 * go through scheduler Proposals; completing and backlogging are direct
 * edits.
 */
export function TodayView({ data }: { data: TodayData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanRunDto | null>(null);
  const [postponeTo, setPostponeTo] = useState("");

  async function run<T>(action: () => Promise<T>, onOk?: (r: T) => void) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await action();
      onOk?.(r);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const schedule = (body: Record<string, unknown>) =>
    run(() => apiSend<PlanRunDto>("/api/scheduler", "POST", body), (r) => setPlan(r));

  const bands = groupByBand(data.tasks);
  const c = data.capacity;

  return (
    <div className="space-y-8">
      {message ? <p role="status" className="text-sm text-ink-soft">{message}</p> : null}

      {data.rollover.length > 0 ? (
        <section aria-label="Roll-over" className="rounded-xl border border-line bg-surface p-4 text-sm">
          <h2 className="display text-lg font-semibold">Yesterday left work unfinished</h2>
          <ul className="mt-2 space-y-1">
            {data.rollover.map((r) => (
              <li key={r.blockId}>{r.title} <span className="text-ink-soft">({r.label})</span></li>
            ))}
          </ul>
          <p className="mt-2 text-ink-soft">Nothing carries over on its own. Reschedule into today, postpone to a day you choose, or move the tasks to the backlog.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => schedule({ operation: "roll_over", from: data.yesterday, date: data.date })}>Reschedule into today</button>
            <input aria-label="Postpone to" type="date" className="field w-auto" value={postponeTo} min={data.date} onChange={(e) => setPostponeTo(e.target.value)} />
            <button type="button" className="btn-ghost" disabled={busy || !postponeTo} onClick={() => schedule({ operation: "roll_over", from: data.yesterday, date: postponeTo })}>Postpone</button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  for (const taskId of new Set(data.rollover.map((r) => r.taskId))) await apiSend(`/api/tasks/${taskId}`, "PATCH", { bucket: "backlog" });
                  for (const r of data.rollover) await apiSend(`/api/blocks/${r.blockId}`, "PATCH", { action: "unschedule" });
                }, () => setMessage("Moved to the backlog."))
              }
            >
              Move to backlog
            </button>
          </div>
        </section>
      ) : null}

      {plan ? <PlanReview run={plan} zone={data.zone} onClose={() => { setPlan(null); router.refresh(); }} /> : null}

      <section aria-label="Capacity" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 text-sm">
        <div>
          <span className="label uppercase">Capacity</span>
          <p className={c.overcommittedMinutes > 0 ? "text-danger" : ""}>
            {formatMinutes(c.scheduledMinutes)} planned · {formatMinutes(c.availableMinutes)} free ahead
            {c.overcommittedMinutes > 0 ? ` · overcommitted by ${formatMinutes(c.overcommittedMinutes)}` : ""}
          </p>
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => schedule({ operation: "plan_day", date: data.date })}>Plan today</button>
      </section>

      <FocusBar data={data} busy={busy} onStop={(id) => run(() => apiSend(`/api/work-sessions/${id}/stop`, "POST", {}), () => setMessage("Focus session stopped."))} />

      <section aria-labelledby="fixed-heading">
        <h2 id="fixed-heading" className="label mb-1 uppercase">Fixed events</h2>
        {data.fixed.length === 0 ? <p className="text-sm text-ink-soft">No commitments today.</p> : (
          <ul className="divide-y divide-line border-y border-line">
            {data.fixed.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <span>{e.title}</span>
                <span className="text-ink-soft">{e.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="blocks-heading">
        <h2 id="blocks-heading" className="label mb-1 uppercase">Planned work</h2>
        {data.blocks.length === 0 ? <p className="text-sm text-ink-soft">No planned blocks today, so there is nothing to start yet. “Plan today” places your tasks into free time.</p> : (
          <ul className="divide-y divide-line border-y border-line">
            {data.blocks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className={b.state === "completed" ? "text-ink-soft line-through" : ""}>
                  {b.isLocked ? "🔒 " : ""}{b.title}
                  <span className="ml-2 text-ink-soft">{b.label}{b.state !== "planned" ? ` · ${b.state.replace("_", " ")}` : ""}</span>
                </span>
                <span className="flex gap-1">
                  {b.state === "planned" || b.state === "missed_unconfirmed" ? (
                    <button type="button" className="btn-ghost" disabled={busy || !!data.activeSession} onClick={() => run(() => apiSend("/api/work-sessions", "POST", { taskId: b.taskId, eventId: b.id }))}>Start</button>
                  ) : null}
                  {b.state !== "completed" && b.state !== "in_progress" ? (
                    <button type="button" className="btn-quiet" disabled={busy} onClick={() => run(() => apiSend(`/api/blocks/${b.id}`, "PATCH", { action: "done" }), () => setMessage(`Marked "${b.title}" as done.`))}>Done</button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className="label mb-1 uppercase">Tasks</h2>
        {data.tasks.length === 0 ? <p className="text-sm text-ink-soft">Nothing active. Enjoy it, or add something.</p> : null}
        {bands.filter((g) => g.items.length > 0).map((g) => (
          <div key={g.key} className="mt-3">
            <h3 className="text-sm font-medium">{g.label}</h3>
            <ul className="divide-y divide-line border-y border-line">
              {g.items.map((t) => (
                <li key={t.id} className="flex items-start gap-3 py-2 text-sm">
                  <span className="mt-1"><PriorityTick priority={t.band} /></span>
                  <input
                    type="checkbox"
                    aria-label={`Complete "${t.title}"`}
                    className="mt-1 h-4 w-4 accent-[var(--brass)]"
                    disabled={busy}
                    onChange={() => run(() => apiSend(`/api/tasks/${t.id}/complete`, "POST", { completed: true }), () => setMessage(`Completed "${t.title}".`))}
                  />
                  <span className="min-w-0 flex-1">
                    <span>{t.title}</span>
                    <span className="ml-2 text-ink-soft">
                      {t.projectName ? `${t.projectName} · ` : ""}
                      {t.deadlineLabel ? <span className={t.overdue ? "text-danger" : ""}>{t.overdue ? "overdue " : "due "}{t.deadlineLabel}</span> : null}
                      {t.remainingEstimateMinutes !== null ? ` · ${formatMinutes(t.remainingEstimateMinutes)} left` : ""}
                      {t.hasBlockToday ? " · planned today" : ""}
                    </span>
                    {t.feasibility === "at_risk" ? <span className="ml-2 text-danger">will not fit before the deadline (short {formatMinutes(t.shortfallMinutes)})</span> : null}
                    {t.feasibility === "estimate_required" ? (
                      <EstimateForm
                        title={t.title}
                        busy={busy}
                        onSubmit={(minutes) =>
                          run(
                            () => apiSend(`/api/tasks/${t.id}`, "PATCH", { remainingEstimateMinutes: minutes, estimatedDurationMinutes: minutes }),
                            () => setMessage(`Estimated “${t.title}” at ${formatMinutes(minutes)}.`),
                          )
                        }
                      />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section aria-labelledby="waiting-heading">
        <h2 id="waiting-heading" className="label mb-1 uppercase">Waiting for</h2>
        {data.waiting.length === 0 ? <p className="text-sm text-ink-soft">Nobody owes you anything right now.</p> : (
          <ul className="divide-y divide-line border-y border-line">
            {data.waiting.map((w) => (
              <li key={w.id} className="flex items-center justify-between py-2 text-sm">
                <span>{w.title}{w.personName ? <span className="text-ink-soft"> · {w.personName}</span> : null}</span>
                {w.nudgeLabel ? <span className={w.nudgeDue ? "text-danger" : "text-ink-soft"}>nudge {w.nudgeLabel}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FocusBar({ data, busy, onStop }: { data: TodayData; busy: boolean; onStop: (id: string) => void }) {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const session = data.activeSession;
  useEffect(() => {
    if (!session) return;
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60_000)));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [session]);
  if (!session) return null;
  return (
    <section aria-label="Focus session" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brass bg-surface p-4 text-sm">
      <span>
        <span className="label uppercase">Focusing</span>
        <p>{session.title}{elapsed !== null ? <span className="text-ink-soft"> · {formatMinutes(elapsed)}</span> : null}</p>
      </span>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => onStop(session.id)}>Stop</button>
    </section>
  );
}

/** Inline estimate for a task the scheduler cannot place yet (spec §7.1 item 4). */
function EstimateForm({ title, busy, onSubmit }: { title: string; busy: boolean; onSubmit: (minutes: number) => void }) {
  const [value, setValue] = useState("");
  const minutes = Number.parseInt(value, 10);
  const valid = Number.isInteger(minutes) && minutes > 0;
  return (
    <form
      className="mt-1 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(minutes);
      }}
    >
      <span className="text-ink-soft">needs an estimate to be scheduled:</span>
      <input
        type="number"
        inputMode="numeric"
        min={5}
        step={5}
        placeholder="min"
        aria-label={`Estimate for “${title}” in minutes`}
        className="field w-20"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn-quiet" disabled={busy || !valid}>Set estimate</button>
    </form>
  );
}

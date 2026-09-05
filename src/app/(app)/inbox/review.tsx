"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateTime } from "luxon";
import { apiSend } from "@/lib/api";
import { TimezoneSelect } from "../tasks/task-form";
import { applyEdit, editorStateFrom, type EditableEntityType, type EditorState } from "./edit-payload";
import { selectDisplayEvidence } from "./evidence-display";
import type { CaptureView, InboxOptions, OperationView, ProposalView } from "./types";

type EntityType = OperationView["entityType"];

const ENTITY_LABEL: Record<EntityType, string> = {
  task: "Task",
  event: "Event",
  note: "Note",
  person: "Person",
  project: "Project",
};

function headline(op: OperationView): string {
  const a = op.after;
  return String(a.title ?? a.name ?? a.body ?? "(untitled)");
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(action: () => Promise<T>, after?: (result: T) => void) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      after?.(result);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

// --- Item display ----------------------------------------------------------

function ItemMeta({ op, options }: { op: OperationView; options: InboxOptions }) {
  const a = op.after;
  const chips: string[] = [];
  const personName = (id: unknown) =>
    typeof id === "string" ? options.people.find((p) => p.id === id)?.name ?? "new person" : null;
  if (op.entityType === "task") {
    if (a.taskKind === "waiting_for") chips.push("Waiting for");
    if (a.taskKind === "reminder") chips.push("Reminder");
    if (typeof a.deadlineDate === "string") chips.push(`Due ${a.deadlineDate}${a.deadlineType === "hard" ? " (hard)" : ""}`);
    if (typeof a.deadlineAt === "string") {
      chips.push(
        `Due ${DateTime.fromISO(a.deadlineAt).setZone(String(a.deadlineTimezone ?? options.timezone)).toFormat("ccc, LLL d, HH:mm")}${a.deadlineType === "hard" ? " (hard)" : ""}`,
      );
    }
    if (typeof a.remindAt === "string") {
      chips.push(`Remind ${DateTime.fromISO(a.remindAt).setZone(String(a.reminderTimezone ?? options.timezone)).toFormat("ccc, LLL d, HH:mm")}`);
    }
    if (typeof a.estimatedDurationMinutes === "number") chips.push(`${a.estimatedDurationMinutes} min`);
    for (const id of Array.isArray(a.peopleIds) ? (a.peopleIds as string[]) : []) chips.push(personName(id)!);
    const waiting = personName(a.waitingForPersonId);
    if (waiting) chips.push(waiting);
  }
  if (op.entityType === "event") {
    const zone = String(a.timezone ?? options.timezone);
    if (typeof a.startAt === "string" && typeof a.endAt === "string") {
      const s = DateTime.fromISO(a.startAt).setZone(zone);
      const e = DateTime.fromISO(a.endAt).setZone(zone);
      chips.push(`${s.toFormat("ccc, LLL d, HH:mm")}–${e.toFormat("HH:mm")}${zone !== options.timezone ? ` ${zone}` : ""}`);
    }
    if (typeof a.allDayStartDate === "string" && typeof a.allDayEndDate === "string") {
      const last = DateTime.fromISO(a.allDayEndDate).minus({ days: 1 }).toISODate();
      chips.push(last === a.allDayStartDate ? `${a.allDayStartDate} · all day` : `${a.allDayStartDate} → ${last} · all day`);
    }
    if (typeof a.kind === "string") chips.push(String(a.kind));
    if (a.isLocked === true) chips.push("Pinned");
    for (const id of Array.isArray(a.peopleIds) ? (a.peopleIds as string[]) : []) chips.push(personName(id)!);
  }
  if (typeof a.projectId === "string") {
    chips.push(options.projects.find((p) => p.id === a.projectId)?.name ?? "new project");
  }
  if (op.entityType === "person" && typeof a.role === "string") chips.push(String(a.role));
  const needsConfirmation =
    a.confidence === "needs_confirmation" || op.evidence.some((e) => e.confidence === "needs_confirmation");
  return (
    <p className="flex flex-wrap gap-x-3 text-xs text-ink-soft">
      {chips.map((c, i) => (
        <span key={i}>{c}</span>
      ))}
      {needsConfirmation ? <span className="font-medium text-brass">Needs confirmation</span> : null}
    </p>
  );
}

function Evidence({ op, sourceExpired }: { op: OperationView; sourceExpired: boolean }) {
  const shown = selectDisplayEvidence(op, sourceExpired);
  if (shown.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-soft">
      {shown.map((e, i) => (
        <span key={i}>
          {e.label}: {e.literal === null ? <em>source expired</em> : <>“{e.literal}”</>}
        </span>
      ))}
    </p>
  );
}

// --- Item editor ---------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function ItemEditor({
  op,
  options,
  onSave,
  onCancel,
  busy,
}: {
  op: OperationView;
  options: InboxOptions;
  onSave: (entityType: EditableEntityType, after: Record<string, unknown>) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [initial] = useState<EditorState>(() => editorStateFrom(op.entityType, op.after, options.timezone));
  const [s, setS] = useState<EditorState>(initial);
  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));
  const convertible = op.entityType === "task" || op.entityType === "event" || op.entityType === "note";
  const named = s.entityType === "person" || s.entityType === "project";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const result = applyEdit(op.after, initial, s);
        onSave(result.entityType, result.after);
      }}
      className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-paper p-3"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {convertible ? (
          <Field label="Save as">
            <select
              value={s.entityType}
              onChange={(e) => {
                const next = e.target.value as EditableEntityType;
                setS((prev) => ({
                  ...prev,
                  entityType: next,
                  title: prev.title || prev.body.slice(0, 80),
                  body: prev.body || prev.title,
                }));
              }}
              className="input"
            >
              <option value="task">Task</option>
              <option value="event">Event</option>
              <option value="note">Note</option>
            </select>
          </Field>
        ) : null}
        <label className="col-span-2 flex flex-col gap-1">
          <span className="label">{named ? "Name" : "Title"}</span>
          <input value={s.title} onChange={(e) => set("title", e.target.value)} required={s.entityType !== "note"} className="input" />
        </label>
      </div>

      {s.entityType === "note" ? (
        <Field label="Note">
          <textarea value={s.body} onChange={(e) => set("body", e.target.value)} rows={3} required className="input" />
        </Field>
      ) : null}

      {s.entityType === "task" ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Kind">
              <select value={s.taskKind} onChange={(e) => set("taskKind", e.target.value as EditorState["taskKind"])} className="input">
                <option value="action">Action</option>
                <option value="waiting_for">Waiting for</option>
                <option value="reminder">Reminder</option>
              </select>
            </Field>
            <Field label="Bucket">
              <select value={s.bucket} onChange={(e) => set("bucket", e.target.value as EditorState["bucket"])} className="input">
                <option value="active">Active</option>
                <option value="backlog">Backlog</option>
                <option value="someday">Someday</option>
              </select>
            </Field>
            {s.taskKind === "waiting_for" ? (
              <Field label="Waiting on">
                <select value={s.waitingForPersonId} onChange={(e) => set("waitingForPersonId", e.target.value)} required className="input">
                  <option value="">Choose…</option>
                  {options.people.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Estimate (min)">
              <input type="number" min={1} value={s.estimated} onChange={(e) => set("estimated", e.target.value)} className="input" />
            </Field>
          </div>
          {s.taskKind === "reminder" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Remind at">
                <input type="datetime-local" value={s.remindLocal} onChange={(e) => set("remindLocal", e.target.value)} required className="input" />
              </Field>
              <TimezoneSelect label="Reminder timezone" value={s.remindTimezone} onChange={(v) => set("remindTimezone", v)} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Deadline">
                <select value={s.deadlineMode} onChange={(e) => set("deadlineMode", e.target.value as EditorState["deadlineMode"])} className="input">
                  <option value="none">None</option>
                  <option value="date">On a date</option>
                  <option value="instant">At a time</option>
                </select>
              </Field>
              {s.deadlineMode === "date" ? (
                <Field label="Date">
                  <input type="date" value={s.deadlineDate} onChange={(e) => set("deadlineDate", e.target.value)} required className="input" />
                </Field>
              ) : null}
              {s.deadlineMode === "instant" ? (
                <>
                  <Field label="When">
                    <input type="datetime-local" value={s.deadlineLocal} onChange={(e) => set("deadlineLocal", e.target.value)} required className="input" />
                  </Field>
                  <TimezoneSelect label="Timezone" value={s.deadlineTimezone} onChange={(v) => set("deadlineTimezone", v)} />
                </>
              ) : null}
              {s.deadlineMode !== "none" ? (
                <Field label="Firmness">
                  <select value={s.deadlineType} onChange={(e) => set("deadlineType", e.target.value as "hard" | "soft")} className="input">
                    <option value="soft">Soft</option>
                    <option value="hard">Hard</option>
                  </select>
                </Field>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {s.entityType === "event" ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Kind">
              <select value={s.eventKind} onChange={(e) => set("eventKind", e.target.value as EditorState["eventKind"])} className="input">
                <option value="meeting">Meeting</option>
                <option value="appointment">Appointment</option>
                <option value="personal">Personal</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Timing">
              <select value={s.scheduleType} onChange={(e) => set("scheduleType", e.target.value as EditorState["scheduleType"])} className="input">
                <option value="fixed">Fixed</option>
                <option value="flexible">Flexible</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 pt-5 text-sm">
              <input type="checkbox" checked={s.allDay} onChange={(e) => set("allDay", e.target.checked)} />
              All-day
            </label>
            {s.scheduleType === "flexible" ? (
              <label className="flex items-center gap-2 pt-5 text-sm">
                <input type="checkbox" checked={s.isLocked} onChange={(e) => set("isLocked", e.target.checked)} />
                Pinned
              </label>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {s.allDay ? (
              <>
                <Field label="First day">
                  <input type="date" value={s.allDayStart} onChange={(e) => set("allDayStart", e.target.value)} required className="input" />
                </Field>
                <Field label="Last day">
                  <input type="date" value={s.allDayLastDay} onChange={(e) => set("allDayLastDay", e.target.value)} required className="input" />
                </Field>
              </>
            ) : (
              <>
                <Field label="Starts">
                  <input type="datetime-local" value={s.startLocal} onChange={(e) => set("startLocal", e.target.value)} required className="input" />
                </Field>
                <Field label="Ends">
                  <input type="datetime-local" value={s.endLocal} onChange={(e) => set("endLocal", e.target.value)} required className="input" />
                </Field>
              </>
            )}
            <TimezoneSelect label="Timezone" value={s.timezone} onChange={(v) => set("timezone", v)} />
          </div>
        </>
      ) : null}

      {s.entityType !== "person" && s.entityType !== "note" ? (
        <Field label="Project">
          <select value={s.projectId} onChange={(e) => set("projectId", e.target.value)} className="input">
            <option value="">None</option>
            {options.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
      ) : null}
      {s.entityType === "note" ? (
        <Field label="Project">
          <select value={s.projectId} onChange={(e) => set("projectId", e.target.value)} className="input">
            <option value="">None</option>
            {options.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
      ) : null}
      {s.entityType === "person" ? (
        <Field label="Role">
          <input value={s.role} onChange={(e) => set("role", e.target.value)} className="input" />
        </Field>
      ) : null}
      {s.entityType === "task" || s.entityType === "event" ? (
        <Field label="Location">
          <input value={s.location} onChange={(e) => set("location", e.target.value)} className="input" />
        </Field>
      ) : null}
      {s.entityType !== "note" ? (
        <Field label={s.entityType === "project" ? "Description" : "Notes"}>
          <textarea
            value={s.entityType === "project" ? s.description : s.notes}
            onChange={(e) => set(s.entityType === "project" ? "description" : "notes", e.target.value)}
            rows={2}
            className="input"
          />
        </Field>
      ) : null}

      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary">Save changes</button>
        <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
      </div>
    </form>
  );
}

// --- Review card ---------------------------------------------------------

function ReviewProposal({ capture, proposal, options }: { capture: CaptureView; proposal: ProposalView; options: InboxOptions }) {
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const putOperations = (ops: Array<{ sourceOperationId?: string; entityType: EntityType; after: Record<string, unknown>; dependsOn: number[] }>) =>
    apiSend(`/api/proposals/${proposal.id}/operations`, "PUT", { operations: ops });

  function remap(remaining: OperationView[]) {
    const indexOf = new Map(remaining.map((o, i) => [o.operationId, i]));
    return remaining.map((o) => ({
      sourceOperationId: o.operationId,
      entityType: o.entityType,
      after: o.after,
      dependsOn: o.dependsOn
        .map((d) => proposal.operations[d]?.operationId)
        .map((id) => (id ? indexOf.get(id) : undefined))
        .filter((i): i is number => i !== undefined),
    }));
  }

  function removeItem(op: OperationView) {
    const remaining = proposal.operations.filter((o) => o.operationId !== op.operationId);
    if (remaining.length === 0) {
      run(() => apiSend(`/api/proposals/${proposal.id}/reject`, "POST", { rejectCapture: true }));
      return;
    }
    run(() => putOperations(remap(remaining)));
  }

  function saveItem(op: OperationView, entityType: EntityType, after: Record<string, unknown>) {
    const ops = remap(proposal.operations).map((o) =>
      o.sourceOperationId === op.operationId ? { ...o, entityType, after } : o,
    );
    run(() => putOperations(ops), () => setEditing(null));
  }

  const acceptAll = () =>
    run(
      () => apiSend<{ outcome: string; details?: Array<{ reason: string }>; reason?: string }>(`/api/proposals/${proposal.id}/approve`, "POST"),
      (r) => {
        if (r.outcome === "conflicted") setResult(`Not applied — ${r.details?.map((d) => d.reason).join("; ")}`);
        if (r.outcome === "failed") setResult(`Not applied — ${r.reason}`);
        if (r.outcome === "in_progress") setResult("Still applying — refresh in a moment.");
      },
    );
  const rejectAll = () => run(() => apiSend(`/api/proposals/${proposal.id}/reject`, "POST", { rejectCapture: true }));

  const blocked = proposal.status === "conflicted" || proposal.status === "failed";

  return (
    <div>
      <ul className="divide-y divide-line border-y border-line">
        {proposal.operations.map((op) => (
          <li key={op.operationId} className="py-2.5">
            <div className="group flex items-start gap-3">
              <span className="mt-1 w-14 shrink-0 text-[10px] font-medium uppercase tracking-wide text-brass">
                {ENTITY_LABEL[op.entityType]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-6">{headline(op)}</p>
                <ItemMeta op={op} options={options} />
                <Evidence op={op} sourceExpired={capture.sourceExpired} />
                {op.reason && op.reason.includes(" · ") ? (
                  <p className="mt-1 text-xs text-ink-soft">{op.reason.split(" · ").slice(1).join(" · ")}</p>
                ) : null}
              </div>
              <div className="flex gap-1">
                <button type="button" disabled={busy} onClick={() => setEditing(editing === op.operationId ? null : op.operationId)} className="btn-quiet">
                  Edit
                </button>
                <button type="button" disabled={busy} onClick={() => removeItem(op)} className="btn-quiet">
                  Remove
                </button>
              </div>
            </div>
            {editing === op.operationId ? (
              <ItemEditor
                op={op}
                options={options}
                busy={busy}
                onSave={(entityType, after) => saveItem(op, entityType, after)}
                onCancel={() => setEditing(null)}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {blocked ? (
        <p className="mt-3 text-sm text-danger">
          {proposal.status === "conflicted"
            ? `This review conflicts with later changes: ${JSON.stringify(proposal.conflictDetails)}`
            : "Applying this review failed; edit an item to rebuild it, or reject."}
        </p>
      ) : null}
      {result ? <p className="mt-3 text-sm text-danger">{result}</p> : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {!blocked ? (
          <button type="button" onClick={acceptAll} disabled={busy} className="btn-primary">
            {busy ? "Working…" : `Accept ${proposal.operations.length === 1 ? "this" : "all " + proposal.operations.length}`}
          </button>
        ) : null}
        <button type="button" onClick={rejectAll} disabled={busy} className="btn-ghost">
          Reject all
        </button>
        <span className="self-center text-xs text-ink-soft">
          {capture.redactedText ? "Source is shown masked exactly as it was sent." : null}
        </span>
      </div>
    </div>
  );
}

function UndoSection({ capture }: { capture: CaptureView }) {
  const { busy, error, run } = useAction();
  const applied = capture.applied!;
  const undo = capture.undo;

  if (applied.reverted) {
    return <p className="text-sm text-ink-soft">Undone — the {applied.itemCount} item(s) were removed again.</p>;
  }
  if (!undo) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-soft">Applied {applied.itemCount} item(s).</p>
        <button type="button" disabled={busy} onClick={() => run(() => apiSend(`/api/actions/${applied.actionId}/undo`, "POST"))} className="btn-quiet">
          Undo this batch
        </button>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </div>
    );
  }
  if (undo.status === "conflicted") {
    const details = Array.isArray(undo.conflictDetails) ? (undo.conflictDetails as Array<{ reason: string }>) : [];
    return (
      <div>
        <p className="text-sm text-danger">Can’t undo safely — {details.map((d) => d.reason).join("; ")}</p>
        <p className="mt-1 text-xs text-ink-soft">Nothing was changed. Adjust the items by hand instead.</p>
        <button type="button" disabled={busy} onClick={() => run(() => apiSend(`/api/proposals/${undo.id}/reject`, "POST", { rejectCapture: false }))} className="btn-quiet mt-2">
          Dismiss
        </button>
      </div>
    );
  }
  return (
    <div>
      <p className="text-sm">Undo would reverse:</p>
      <ul className="mt-1 text-xs text-ink-soft">
        {undo.operations.map((o) => (
          <li key={o.operationId}>
            {o.op} {ENTITY_LABEL[o.entityType].toLowerCase()} {o.op !== "delete" ? "" : `“${String((o.after as { title?: string }).title ?? "")}”`}
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(() => apiSend(`/api/proposals/${undo.id}/approve`, "POST"))} className="btn-primary">
          Confirm undo
        </button>
        <button type="button" disabled={busy} onClick={() => run(() => apiSend(`/api/proposals/${undo.id}/reject`, "POST", { rejectCapture: false }))} className="btn-ghost">
          Keep changes
        </button>
      </div>
    </div>
  );
}

function PendingCapture({ capture }: { capture: CaptureView }) {
  const { busy, error, run } = useAction();
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => run(() => apiSend(`/api/captures/${capture.id}/extract`, "POST", {}))} className="btn-primary">
        Interpret with AI
      </button>
      <button type="button" disabled={busy} onClick={() => run(() => apiSend(`/api/captures/${capture.id}/no-ai`, "POST"))} className="btn-ghost">
        Keep as private note
      </button>
      <button type="button" disabled={busy} onClick={() => run(() => apiSend(`/api/captures/${capture.id}/reject`, "POST"))} className="btn-quiet">
        Discard
      </button>
      {error ? <span className="self-center text-sm text-danger">{error}</span> : null}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  received: "Captured",
  redacted: "Ready to interpret",
  proposed: "Awaiting your review",
  processed: "Applied",
  rejected: "Discarded",
  failed: "Interpretation failed",
  no_ai: "Kept as a private note",
};

export function CaptureCard({ capture, options }: { capture: CaptureView; options: InboxOptions }) {
  const when = DateTime.fromISO(capture.createdAt).setZone(options.timezone).toFormat("ccc, LLL d, HH:mm");
  const source = capture.sourceExpired ? null : capture.rawText;
  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-ink-soft">{STATUS_LABEL[capture.status] ?? capture.status}</span>
        <span className="text-xs text-ink-soft">{when}</span>
      </header>
      {capture.sourceExpired ? (
        <p className="mb-3 text-sm italic text-ink-soft">Source expired (kept 30 days).</p>
      ) : source ? (
        <p className="mb-3 whitespace-pre-wrap text-sm text-ink-soft">{source.length > 400 ? `${source.slice(0, 400)}…` : source}</p>
      ) : null}

      {capture.review ? <ReviewProposal capture={capture} proposal={capture.review} options={options} /> : null}
      {!capture.review && capture.applied ? <UndoSection capture={capture} /> : null}
      {!capture.review && !capture.applied && ["received", "redacted", "failed"].includes(capture.status) ? (
        capture.sourceExpired ? (
          <p className="text-sm text-ink-soft">This capture was never processed and its text has expired.</p>
        ) : (
          <PendingCapture capture={capture} />
        )
      ) : null}
      {capture.status === "no_ai" && capture.noteId ? (
        <Link href="/notes" className="text-sm text-brass">Open in Notes →</Link>
      ) : null}
    </article>
  );
}

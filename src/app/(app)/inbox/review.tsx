"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateTime } from "luxon";
import { apiSend } from "@/lib/api";
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
  if (op.entityType === "task") {
    if (a.taskKind === "waiting_for") chips.push("Waiting for");
    if (a.taskKind === "reminder") chips.push("Reminder");
    if (typeof a.deadlineDate === "string") chips.push(`Due ${a.deadlineDate}`);
    if (typeof a.deadlineAt === "string") {
      chips.push(`Due ${DateTime.fromISO(a.deadlineAt).setZone(options.timezone).toFormat("ccc, LLL d, HH:mm")}`);
    }
    if (typeof a.estimatedDurationMinutes === "number") chips.push(`${a.estimatedDurationMinutes} min`);
    const people = Array.isArray(a.peopleIds) ? (a.peopleIds as string[]) : [];
    for (const id of people) {
      const name = options.people.find((p) => p.id === id)?.name;
      chips.push(name ?? "new person");
    }
    if (typeof a.waitingForPersonId === "string") {
      chips.push(options.people.find((p) => p.id === a.waitingForPersonId)?.name ?? "new person");
    }
  }
  if (op.entityType === "event") {
    if (typeof a.startAt === "string") {
      chips.push(DateTime.fromISO(a.startAt).setZone(String(a.timezone ?? options.timezone)).toFormat("ccc, LLL d, HH:mm"));
    }
    if (typeof a.allDayStartDate === "string") chips.push(`${a.allDayStartDate} · all day`);
    if (typeof a.kind === "string") chips.push(String(a.kind));
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

function Evidence({ op }: { op: OperationView }) {
  if (op.evidence.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-soft">
      {op.evidence.map((e, i) => (
        <span key={i}>
          {e.fieldPath}: {e.literalText === null ? <em>source expired</em> : <>“{e.literalText}”</>}
        </span>
      ))}
    </p>
  );
}

// --- Item editor ---------------------------------------------------------

interface EditorState {
  entityType: EntityType;
  title: string;
  body: string;
  role: string;
  taskKind: "action" | "waiting_for" | "reminder";
  projectId: string;
  waitingForPersonId: string;
  deadlineDate: string;
  remindLocal: string;
  estimated: string;
  notes: string;
  eventKind: "meeting" | "appointment" | "personal" | "other";
  scheduleType: "fixed" | "flexible";
  allDay: boolean;
  startLocal: string;
  endLocal: string;
  allDayStart: string;
}

function toEditor(op: OperationView, zone: string): EditorState {
  const a = op.after;
  const local = (iso: unknown) =>
    typeof iso === "string" ? DateTime.fromISO(iso).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm") : "";
  return {
    entityType: op.entityType,
    title: String(a.title ?? a.name ?? ""),
    body: String(a.body ?? ""),
    role: String(a.role ?? ""),
    taskKind: (a.taskKind as EditorState["taskKind"]) ?? "action",
    projectId: typeof a.projectId === "string" ? a.projectId : "",
    waitingForPersonId: typeof a.waitingForPersonId === "string" ? a.waitingForPersonId : "",
    deadlineDate: typeof a.deadlineDate === "string" ? a.deadlineDate : "",
    remindLocal: local(a.remindAt),
    estimated: typeof a.estimatedDurationMinutes === "number" ? String(a.estimatedDurationMinutes) : "",
    notes: String(a.notes ?? ""),
    eventKind: (a.kind as EditorState["eventKind"]) ?? "other",
    scheduleType: (a.scheduleType as EditorState["scheduleType"]) ?? "fixed",
    allDay: typeof a.allDayStartDate === "string" || typeof a.startAt !== "string",
    startLocal: local(a.startAt),
    endLocal: local(a.endAt),
    allDayStart: typeof a.allDayStartDate === "string" ? a.allDayStartDate : DateTime.now().setZone(zone).toISODate()!,
  };
}

function fromEditor(s: EditorState, original: Record<string, unknown>, zone: string): Record<string, unknown> {
  const keep = (key: string) => (original[key] === undefined ? {} : { [key]: original[key] });
  const instant = (localValue: string) => {
    const dt = DateTime.fromISO(localValue, { zone });
    return dt.isValid ? dt.toUTC().toISO() : null;
  };
  switch (s.entityType) {
    case "task":
      return {
        ...keep("captureId"),
        ...keep("peopleIds"),
        ...keep("description"),
        ...keep("location"),
        title: s.title,
        notes: s.notes.trim() || null,
        taskKind: s.taskKind,
        projectId: s.projectId || null,
        waitingForPersonId: s.taskKind === "waiting_for" ? s.waitingForPersonId || null : null,
        deadlineDate: s.taskKind !== "reminder" && s.deadlineDate ? s.deadlineDate : null,
        deadlineType: s.taskKind !== "reminder" && s.deadlineDate ? (original.deadlineType ?? "soft") : null,
        deadlineAt: null,
        deadlineTimezone: null,
        remindAt: s.taskKind === "reminder" ? instant(s.remindLocal) : null,
        reminderTimezone: s.taskKind === "reminder" && s.remindLocal ? zone : null,
        estimatedDurationMinutes: s.estimated ? Number(s.estimated) : null,
      };
    case "event": {
      const start = s.allDay ? null : instant(s.startLocal);
      const end = s.allDay ? null : instant(s.endLocal);
      return {
        ...keep("captureId"),
        ...keep("description"),
        ...keep("location"),
        title: s.title,
        kind: s.eventKind,
        scheduleType: s.scheduleType,
        isLocked: false,
        timezone: zone,
        projectId: s.projectId || null,
        notes: s.notes.trim() || null,
        startAt: start,
        endAt: end,
        allDayStartDate: s.allDay ? s.allDayStart : null,
        allDayEndDate: s.allDay
          ? DateTime.fromISO(s.allDayStart, { zone }).plus({ days: 1 }).toISODate()
          : null,
      };
    }
    case "note":
      return {
        ...keep("captureId"),
        body: s.body || s.title,
        title: s.body ? s.title.trim() || null : null,
        projectId: s.projectId || null,
      };
    case "person":
      return { name: s.title, role: s.role.trim() || null, notes: s.notes.trim() || null, aliases: [] };
    case "project":
      return { kind: "project", name: s.title, parentId: null, description: s.notes.trim() || null, importance: null };
  }
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
  onSave: (entityType: EntityType, after: Record<string, unknown>) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [s, setS] = useState<EditorState>(() => toEditor(op, options.timezone));
  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));
  const convertible = op.entityType === "task" || op.entityType === "event" || op.entityType === "note";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(s.entityType, fromEditor(s, op.after, options.timezone));
      }}
      className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-paper p-3"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {convertible ? (
          <label className="flex flex-col gap-1">
            <span className="label">Save as</span>
            <select
              value={s.entityType}
              onChange={(e) => {
                const next = e.target.value as EntityType;
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
          </label>
        ) : null}
        <label className="col-span-2 flex flex-col gap-1">
          <span className="label">{s.entityType === "person" || s.entityType === "project" ? "Name" : "Title"}</span>
          <input value={s.title} onChange={(e) => set("title", e.target.value)} required={s.entityType !== "note"} className="input" />
        </label>
      </div>

      {s.entityType === "note" ? (
        <label className="flex flex-col gap-1">
          <span className="label">Note</span>
          <textarea value={s.body} onChange={(e) => set("body", e.target.value)} rows={3} required className="input" />
        </label>
      ) : null}

      {s.entityType === "task" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="label">Kind</span>
            <select value={s.taskKind} onChange={(e) => set("taskKind", e.target.value as EditorState["taskKind"])} className="input">
              <option value="action">Action</option>
              <option value="waiting_for">Waiting for</option>
              <option value="reminder">Reminder</option>
            </select>
          </label>
          {s.taskKind === "waiting_for" ? (
            <label className="flex flex-col gap-1">
              <span className="label">Waiting on</span>
              <select value={s.waitingForPersonId} onChange={(e) => set("waitingForPersonId", e.target.value)} required className="input">
                <option value="">Choose…</option>
                {options.people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          {s.taskKind === "reminder" ? (
            <label className="flex flex-col gap-1">
              <span className="label">Remind at</span>
              <input type="datetime-local" value={s.remindLocal} onChange={(e) => set("remindLocal", e.target.value)} required className="input" />
            </label>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="label">Deadline</span>
              <input type="date" value={s.deadlineDate} onChange={(e) => set("deadlineDate", e.target.value)} className="input" />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="label">Estimate (min)</span>
            <input type="number" min={1} value={s.estimated} onChange={(e) => set("estimated", e.target.value)} className="input" />
          </label>
        </div>
      ) : null}

      {s.entityType === "event" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="label">Kind</span>
            <select value={s.eventKind} onChange={(e) => set("eventKind", e.target.value as EditorState["eventKind"])} className="input">
              <option value="meeting">Meeting</option>
              <option value="appointment">Appointment</option>
              <option value="personal">Personal</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Timing</span>
            <select value={s.scheduleType} onChange={(e) => set("scheduleType", e.target.value as EditorState["scheduleType"])} className="input">
              <option value="fixed">Fixed</option>
              <option value="flexible">Flexible</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pt-5 text-sm">
            <input type="checkbox" checked={s.allDay} onChange={(e) => set("allDay", e.target.checked)} />
            All-day
          </label>
          {s.allDay ? (
            <label className="flex flex-col gap-1">
              <span className="label">Day</span>
              <input type="date" value={s.allDayStart} onChange={(e) => set("allDayStart", e.target.value)} required className="input" />
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="label">Starts</span>
                <input type="datetime-local" value={s.startLocal} onChange={(e) => set("startLocal", e.target.value)} required className="input" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">Ends</span>
                <input type="datetime-local" value={s.endLocal} onChange={(e) => set("endLocal", e.target.value)} required className="input" />
              </label>
            </>
          )}
        </div>
      ) : null}

      {s.entityType !== "person" && s.entityType !== "note" ? (
        <label className="flex flex-col gap-1">
          <span className="label">Project</span>
          <select value={s.projectId} onChange={(e) => set("projectId", e.target.value)} className="input">
            <option value="">None</option>
            {options.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      ) : null}
      {s.entityType === "person" ? (
        <label className="flex flex-col gap-1">
          <span className="label">Role</span>
          <input value={s.role} onChange={(e) => set("role", e.target.value)} className="input" />
        </label>
      ) : null}
      {s.entityType !== "note" ? (
        <label className="flex flex-col gap-1">
          <span className="label">{s.entityType === "project" ? "Description" : "Notes"}</span>
          <textarea value={s.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="input" />
        </label>
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
                <Evidence op={op} />
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

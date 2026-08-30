"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { apiSend } from "@/lib/api";
import type { SelectOption, TaskDto } from "./types";

interface FormState {
  title: string;
  description: string;
  notes: string;
  projectId: string;
  taskKind: "action" | "waiting_for" | "reminder";
  bucket: "active" | "backlog" | "someday";
  deadlineMode: "none" | "date" | "instant";
  deadlineDate: string;
  deadlineLocal: string;
  deadlineTimezone: string;
  deadlineType: "hard" | "soft";
  remindLocal: string;
  reminderTimezone: string;
  waitingForPersonId: string;
  nudgeDate: string;
  estimatedDurationMinutes: string;
  remainingEstimateMinutes: string;
  userPriority: "" | "must" | "should" | "could";
  isSchedulable: boolean;
  isSplittable: boolean;
}

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
}

function localFromIso(iso: string | null, zone: string | null): string {
  if (!iso) return "";
  return DateTime.fromISO(iso).setZone(zone ?? browserZone()).toFormat("yyyy-MM-dd'T'HH:mm");
}

function initialState(task?: TaskDto): FormState {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    notes: task?.notes ?? "",
    projectId: task?.projectId ?? "",
    taskKind: task?.taskKind ?? "action",
    bucket: task?.bucket ?? "active",
    deadlineMode: task?.deadlineDate ? "date" : task?.deadlineAt ? "instant" : "none",
    deadlineDate: task?.deadlineDate ?? "",
    deadlineLocal: localFromIso(task?.deadlineAt ?? null, task?.deadlineTimezone ?? null),
    deadlineTimezone: task?.deadlineTimezone ?? browserZone(),
    deadlineType: task?.deadlineType ?? "soft",
    remindLocal: localFromIso(task?.remindAt ?? null, task?.reminderTimezone ?? null),
    reminderTimezone: task?.reminderTimezone ?? browserZone(),
    waitingForPersonId: task?.waitingForPersonId ?? "",
    nudgeDate: task?.nudgeDate ?? "",
    estimatedDurationMinutes: task?.estimatedDurationMinutes?.toString() ?? "",
    remainingEstimateMinutes: task?.remainingEstimateMinutes?.toString() ?? "",
    userPriority: task?.userPriority ?? "",
    isSchedulable: true,
    isSplittable: false,
  };
}

function instantWithOffset(local: string, zone: string): string | null {
  if (!local) return null;
  const dt = DateTime.fromISO(local, { zone });
  return dt.isValid ? dt.toISO() : null;
}

function buildPayload(s: FormState) {
  return {
    title: s.title,
    description: s.description.trim() || null,
    notes: s.notes.trim() || null,
    projectId: s.projectId || null,
    taskKind: s.taskKind,
    bucket: s.bucket,
    deadlineDate: s.deadlineMode === "date" && s.deadlineDate ? s.deadlineDate : null,
    deadlineAt:
      s.deadlineMode === "instant" ? instantWithOffset(s.deadlineLocal, s.deadlineTimezone) : null,
    deadlineTimezone:
      s.deadlineMode === "instant" && s.deadlineLocal ? s.deadlineTimezone : null,
    deadlineType:
      (s.deadlineMode === "date" && s.deadlineDate) ||
      (s.deadlineMode === "instant" && s.deadlineLocal)
        ? s.deadlineType
        : null,
    remindAt:
      s.taskKind === "reminder" ? instantWithOffset(s.remindLocal, s.reminderTimezone) : null,
    reminderTimezone: s.taskKind === "reminder" && s.remindLocal ? s.reminderTimezone : null,
    waitingForPersonId: s.taskKind === "waiting_for" ? s.waitingForPersonId || null : null,
    nudgeDate: s.taskKind === "waiting_for" && s.nudgeDate ? s.nudgeDate : null,
    estimatedDurationMinutes: s.estimatedDurationMinutes
      ? Number(s.estimatedDurationMinutes)
      : null,
    remainingEstimateMinutes: s.remainingEstimateMinutes
      ? Number(s.remainingEstimateMinutes)
      : null,
    userPriority: s.userPriority || null,
    isSchedulable: s.isSchedulable,
    isSplittable: s.isSplittable,
  };
}

export function TimezoneSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(value) ? all : [value, ...all];
  }, [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
        {zones.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TaskForm({
  task,
  projects,
  people,
  onDone,
  onCancel,
}: {
  task?: TaskDto;
  projects: SelectOption[];
  people: SelectOption[];
  onDone: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [s, setS] = useState<FormState>(() => initialState(task));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = buildPayload(s);
      if (task) await apiSend(`/api/tasks/${task.id}`, "PATCH", payload);
      else await apiSend("/api/tasks", "POST", payload);
      router.refresh();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <label className="flex flex-col gap-1">
        <span className="label">Title</span>
        <input
          value={s.title}
          onChange={(e) => set("title", e.target.value)}
          required
          className="input"
          placeholder="What needs doing?"
        />
      </label>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="label">Kind</span>
          <select
            value={s.taskKind}
            onChange={(e) => set("taskKind", e.target.value as FormState["taskKind"])}
            className="input"
          >
            <option value="action">Action</option>
            <option value="waiting_for">Waiting for</option>
            <option value="reminder">Reminder</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Project</span>
          <select
            value={s.projectId}
            onChange={(e) => set("projectId", e.target.value)}
            className="input"
          >
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Bucket</span>
          <select
            value={s.bucket}
            onChange={(e) => set("bucket", e.target.value as FormState["bucket"])}
            className="input"
          >
            <option value="active">Active</option>
            <option value="backlog">Backlog</option>
            <option value="someday">Someday</option>
          </select>
        </label>
      </div>

      {s.taskKind === "waiting_for" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="label">Waiting on</span>
            <select
              value={s.waitingForPersonId}
              onChange={(e) => set("waitingForPersonId", e.target.value)}
              required
              className="input"
            >
              <option value="">Choose a person…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Nudge on</span>
            <input
              type="date"
              value={s.nudgeDate}
              onChange={(e) => set("nudgeDate", e.target.value)}
              className="input"
            />
          </label>
        </div>
      ) : null}

      {s.taskKind === "reminder" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="label">Remind at</span>
            <input
              type="datetime-local"
              value={s.remindLocal}
              onChange={(e) => set("remindLocal", e.target.value)}
              required
              className="input"
            />
          </label>
          <TimezoneSelect
            label="Reminder timezone"
            value={s.reminderTimezone}
            onChange={(v) => set("reminderTimezone", v)}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="label">Deadline</span>
          <select
            value={s.deadlineMode}
            onChange={(e) => set("deadlineMode", e.target.value as FormState["deadlineMode"])}
            className="input"
          >
            <option value="none">None</option>
            <option value="date">On a date</option>
            <option value="instant">At a time</option>
          </select>
        </label>
        {s.deadlineMode === "date" ? (
          <label className="flex flex-col gap-1">
            <span className="label">Date</span>
            <input
              type="date"
              value={s.deadlineDate}
              onChange={(e) => set("deadlineDate", e.target.value)}
              required
              className="input"
            />
          </label>
        ) : null}
        {s.deadlineMode === "instant" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="label">When</span>
              <input
                type="datetime-local"
                value={s.deadlineLocal}
                onChange={(e) => set("deadlineLocal", e.target.value)}
                required
                className="input"
              />
            </label>
            <TimezoneSelect
              label="Timezone"
              value={s.deadlineTimezone}
              onChange={(v) => set("deadlineTimezone", v)}
            />
          </>
        ) : null}
        {s.deadlineMode !== "none" ? (
          <label className="flex flex-col gap-1">
            <span className="label">Firmness</span>
            <select
              value={s.deadlineType}
              onChange={(e) => set("deadlineType", e.target.value as "hard" | "soft")}
              className="input"
            >
              <option value="soft">Soft</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="label">Estimate (min)</span>
          <input
            type="number"
            min={1}
            value={s.estimatedDurationMinutes}
            onChange={(e) => set("estimatedDurationMinutes", e.target.value)}
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Remaining (min)</span>
          <input
            type="number"
            min={1}
            value={s.remainingEstimateMinutes}
            onChange={(e) => set("remainingEstimateMinutes", e.target.value)}
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Priority</span>
          <select
            value={s.userPriority}
            onChange={(e) => set("userPriority", e.target.value as FormState["userPriority"])}
            className="input"
          >
            <option value="">Suggested</option>
            <option value="must">Must</option>
            <option value="should">Should</option>
            <option value="could">Could</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="label">Description</span>
        <textarea
          value={s.description}
          onChange={(e) => set("description", e.target.value)}
          rows={2}
          className="input resize-y"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">Notes</span>
        <textarea
          value={s.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={2}
          className="input resize-y"
        />
      </label>

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={s.isSchedulable}
            onChange={(e) => set("isSchedulable", e.target.checked)}
          />
          Schedulable
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={s.isSplittable}
            onChange={(e) => set("isSplittable", e.target.checked)}
          />
          Splittable
        </label>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary">
          {task ? "Save changes" : "Add task"}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

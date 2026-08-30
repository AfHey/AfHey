"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateTime } from "luxon";
import { apiSend } from "@/lib/api";
import { TimezoneSelect } from "../tasks/task-form";
import type { SelectOption } from "../tasks/types";
import type { EventDto } from "./types";

interface FormState {
  title: string;
  kind: "meeting" | "appointment" | "personal" | "other";
  scheduleType: "fixed" | "flexible";
  isLocked: boolean;
  mode: "timed" | "allday";
  startLocal: string;
  endLocal: string;
  allDayStartDate: string;
  allDayEndDate: string;
  timezone: string;
  projectId: string;
  location: string;
  description: string;
  notes: string;
}

const browserZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

const localFromIso = (iso: string | null, zone: string) =>
  iso ? DateTime.fromISO(iso).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm") : "";

function initialState(event?: EventDto): FormState {
  const zone = event?.timezone ?? browserZone();
  return {
    title: event?.title ?? "",
    kind: (event?.kind as FormState["kind"]) ?? "meeting",
    scheduleType: event?.scheduleType ?? "fixed",
    isLocked: event?.isLocked ?? false,
    mode: event?.allDayStartDate ? "allday" : "timed",
    startLocal: localFromIso(event?.startAt ?? null, zone),
    endLocal: localFromIso(event?.endAt ?? null, zone),
    allDayStartDate: event?.allDayStartDate ?? "",
    allDayEndDate: event?.allDayEndDate ?? "",
    timezone: zone,
    projectId: event?.projectId ?? "",
    location: event?.location ?? "",
    description: event?.description ?? "",
    notes: event?.notes ?? "",
  };
}

function buildPayload(s: FormState) {
  const instant = (local: string) => {
    if (!local) return null;
    const dt = DateTime.fromISO(local, { zone: s.timezone });
    return dt.isValid ? dt.toISO() : null;
  };
  return {
    title: s.title,
    kind: s.kind,
    scheduleType: s.scheduleType,
    isLocked: s.scheduleType === "flexible" ? s.isLocked : false,
    startAt: s.mode === "timed" ? instant(s.startLocal) : null,
    endAt: s.mode === "timed" ? instant(s.endLocal) : null,
    allDayStartDate: s.mode === "allday" && s.allDayStartDate ? s.allDayStartDate : null,
    allDayEndDate: s.mode === "allday" && s.allDayEndDate ? s.allDayEndDate : null,
    timezone: s.timezone,
    projectId: s.projectId || null,
    location: s.location.trim() || null,
    description: s.description.trim() || null,
    notes: s.notes.trim() || null,
  };
}

function EventForm({
  event,
  projects,
  onDone,
  onCancel,
}: {
  event?: EventDto;
  projects: SelectOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [s, setS] = useState<FormState>(() => initialState(event));
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
      if (event) await apiSend(`/api/events/${event.id}`, "PATCH", payload);
      else await apiSend("/api/events", "POST", payload);
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
        />
      </label>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="label">Kind</span>
          <select
            value={s.kind}
            onChange={(e) => set("kind", e.target.value as FormState["kind"])}
            className="input"
          >
            <option value="meeting">Meeting</option>
            <option value="appointment">Appointment</option>
            <option value="personal">Personal</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Timing</span>
          <select
            value={s.scheduleType}
            onChange={(e) => set("scheduleType", e.target.value as "fixed" | "flexible")}
            className="input"
          >
            <option value="fixed">Fixed</option>
            <option value="flexible">Flexible</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Day span</span>
          <select
            value={s.mode}
            onChange={(e) => set("mode", e.target.value as "timed" | "allday")}
            className="input"
          >
            <option value="timed">Timed</option>
            <option value="allday">All-day</option>
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
      </div>

      {s.mode === "timed" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="label">Starts</span>
            <input
              type="datetime-local"
              value={s.startLocal}
              onChange={(e) => set("startLocal", e.target.value)}
              required
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Ends</span>
            <input
              type="datetime-local"
              value={s.endLocal}
              onChange={(e) => set("endLocal", e.target.value)}
              required
              className="input"
            />
          </label>
          <TimezoneSelect
            label="Timezone"
            value={s.timezone}
            onChange={(v) => set("timezone", v)}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="label">First day</span>
            <input
              type="date"
              value={s.allDayStartDate}
              onChange={(e) => set("allDayStartDate", e.target.value)}
              required
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Ends before</span>
            <input
              type="date"
              value={s.allDayEndDate}
              onChange={(e) => set("allDayEndDate", e.target.value)}
              required
              className="input"
            />
          </label>
          <TimezoneSelect
            label="Timezone"
            value={s.timezone}
            onChange={(v) => set("timezone", v)}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">Location</span>
          <input
            value={s.location}
            onChange={(e) => set("location", e.target.value)}
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Description</span>
          <input
            value={s.description}
            onChange={(e) => set("description", e.target.value)}
            className="input"
          />
        </label>
      </div>

      {s.scheduleType === "flexible" ? (
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={s.isLocked}
            onChange={(e) => set("isLocked", e.target.checked)}
          />
          Pin this block (the scheduler never moves it)
        </label>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary">
          {event ? "Save changes" : "Add event"}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function EventComposer({ projects }: { projects: SelectOption[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost w-full justify-start text-ink-soft">
        + Add an event
      </button>
    );
  }
  return <EventForm projects={projects} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />;
}

export function EventItem({ event, projects }: { event: EventDto; projects: SelectOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setError(null);
    try {
      await apiSend(`/api/events/${event.id}`, "DELETE");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <li className="py-2.5">
      <div className="group flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
            event.scheduleType === "fixed" ? "bg-ink" : "border border-ink-soft"
          }`}
          title={event.scheduleType === "fixed" ? "Fixed" : "Flexible"}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-6">{event.title}</p>
          <p className="flex flex-wrap gap-x-3 text-xs text-ink-soft">
            <span>{event.whenLabel}</span>
            <span className="capitalize">{event.kind}</span>
            {event.isLocked ? <span className="text-brass">Pinned</span> : null}
            {event.projectName ? <span>{event.projectName}</span> : null}
            {event.location ? <span>{event.location}</span> : null}
          </p>
        </div>
        <div className="flex gap-1 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-within:opacity-100">
          <button type="button" onClick={() => setEditing((v) => !v)} className="btn-quiet">
            Edit
          </button>
          <button type="button" onClick={archive} className="btn-quiet">
            Archive
          </button>
        </div>
      </div>
      {error ? <p className="mt-1 pl-5 text-xs text-danger">{error}</p> : null}
      {editing ? (
        <div className="mt-3 pl-5">
          <EventForm
            event={event}
            projects={projects}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : null}
    </li>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SchedulerSettings } from "@/core/domain/scheduler-settings";
import { apiSend } from "@/lib/api";

/**
 * Scheduler constraints (spec §7.1): availability by weekday, protected
 * windows, soft preferences, and the scalar knobs. Every edit is a direct
 * settings mutation; the scheduler reads these as versioned inputs.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WORK_TYPES = ["deep", "shallow", "study", "communication", "errand", "other"] as const;
const weekdayName = (weekday: number | null) => (weekday === null ? "Any day" : WEEKDAYS[weekday - 1]);

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy };
}

function DeleteButton({ kind, id }: { kind: string; id: string }) {
  const { run, busy } = useSubmit();
  return (
    <button
      type="button"
      className="btn-quiet text-danger"
      disabled={busy}
      onClick={() => run(() => apiSend(`/api/settings/windows/${kind}/${id}`, "DELETE"))}
    >
      Remove
    </button>
  );
}

function WeekdaySelect({
  label,
  value,
  onChange,
  allowAny,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  allowAny?: boolean;
}) {
  return (
    <select
      aria-label={label}
      className="field w-auto"
      value={value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      {allowAny ? <option value="">Any day</option> : null}
      {WEEKDAYS.map((name, i) => (
        <option key={name} value={i + 1}>{name}</option>
      ))}
    </select>
  );
}

function TimePair({
  label,
  start,
  end,
  onStart,
  onEnd,
}: {
  label: string;
  start: string;
  end: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
}) {
  return (
    <>
      <input aria-label={`${label} start`} type="time" className="field w-auto" value={start} onChange={(e) => onStart(e.target.value)} required />
      <span className="text-ink-soft">–</span>
      <input aria-label={`${label} end`} type="time" className="field w-auto" value={end} onChange={(e) => onEnd(e.target.value)} required />
    </>
  );
}

export function SchedulerSettings({ settings }: { settings: SchedulerSettings }) {
  return (
    <div className="space-y-8">
      <PreferencesForm settings={settings} />
      <AvailabilitySection settings={settings} />
      <ProtectedSection settings={settings} />
      <PreferredSection settings={settings} />
    </div>
  );
}

function PreferencesForm({ settings }: { settings: SchedulerSettings }) {
  const p = settings.preferences;
  const [form, setForm] = useState({ ...p });
  const { run, error, busy } = useSubmit();
  const [saved, setSaved] = useState(false);
  const number = (key: keyof typeof form, label: string, min: number, max: number) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="label">{label}</span>
      <input
        type="number"
        className="field w-28"
        min={min}
        max={max}
        value={form[key] as number}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const { revision: _revision, ...patch } = form;
        void _revision;
        if (await run(() => apiSend("/api/settings/scheduler", "PATCH", patch))) setSaved(true);
      }}
    >
      <h3 className="label uppercase">Scheduling knobs</h3>
      <div className="flex flex-wrap gap-4">
        {number("minBlockMinutes", "Min block (min)", 5, 480)}
        {number("maxBlockMinutes", "Max block (min)", 5, 720)}
        {number("bufferMinutes", "Buffer (min)", 0, 120)}
        {number("dailyDeepWorkCapMinutes", "Deep-work cap / day (min)", 0, 1440)}
        {number("planningHorizonDays", "Planning horizon (days)", 1, 31)}
        <label className="flex flex-col gap-1 text-sm">
          <span className="label">Job time</span>
          <select
            className="field w-auto"
            value={form.jobTimePolicy}
            onChange={(e) => setForm({ ...form, jobTimePolicy: e.target.value as typeof form.jobTimePolicy })}
          >
            <option value="unavailable">Not available for tasks</option>
            <option value="work_related_only">Work-area tasks only</option>
            <option value="any">Any task</option>
          </select>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={busy}>Save knobs</button>
        {saved ? <span className="text-sm text-ink-soft">Saved</span> : null}
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </div>
    </form>
  );
}

function AvailabilitySection({ settings }: { settings: SchedulerSettings }) {
  const [weekday, setWeekday] = useState<number | null>(1);
  const [start, setStart] = useState("17:30");
  const [end, setEnd] = useState("21:30");
  const [kind, setKind] = useState<"general" | "job">("general");
  const [label, setLabel] = useState("");
  const { run, error, busy } = useSubmit();
  return (
    <section>
      <h3 className="label mb-2 uppercase">Availability</h3>
      <p className="mb-2 text-sm text-ink-soft">When flexible work may be placed. Job windows follow the job-time policy above.</p>
      <ul aria-label="Availability windows" className="divide-y divide-line border-y border-line">
        {settings.availability.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              <strong>{weekdayName(w.weekday)}</strong> {w.startTime}–{w.endTime}
              <span className="ml-2 text-ink-soft">{w.kind === "job" ? "job" : "general"}{w.label ? ` · ${w.label}` : ""}</span>
            </span>
            <DeleteButton kind="availability" id={w.id} />
          </li>
        ))}
        {settings.availability.length === 0 ? <li className="py-2 text-sm text-ink-soft">No availability yet: the scheduler has nowhere to place work.</li> : null}
      </ul>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(() =>
            apiSend("/api/settings/windows/availability", "POST", {
              weekday,
              startTime: start,
              endTime: end,
              kind,
              label: label.trim() || null,
            }),
          );
        }}
      >
        <WeekdaySelect label="Availability weekday" value={weekday} onChange={setWeekday} />
        <TimePair label="Availability" start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <select aria-label="Availability kind" className="field w-auto" value={kind} onChange={(e) => setKind(e.target.value as "general" | "job")}>
          <option value="general">General</option>
          <option value="job">Job</option>
        </select>
        <input aria-label="Availability label" className="field w-36" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="submit" className="btn-ghost" disabled={busy}>Add availability window</button>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </form>
    </section>
  );
}

function ProtectedSection({ settings }: { settings: SchedulerSettings }) {
  const [recurrence, setRecurrence] = useState<"weekly" | "once">("weekly");
  const [weekday, setWeekday] = useState<number | null>(7);
  const [onDate, setOnDate] = useState("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("20:00");
  const [label, setLabel] = useState("");
  const { run, error, busy } = useSubmit();
  return (
    <section>
      <h3 className="label mb-2 uppercase">Protected time</h3>
      <p className="mb-2 text-sm text-ink-soft">Hard-unavailable windows; the scheduler cannot use them without an explicit override.</p>
      <ul aria-label="Protected windows" className="divide-y divide-line border-y border-line">
        {settings.protected.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              <strong>{w.recurrence === "weekly" ? weekdayName(w.weekday) : w.onDate}</strong> {w.startTime}–{w.endTime}
              {w.label ? <span className="ml-2 text-ink-soft">{w.label}</span> : null}
            </span>
            <DeleteButton kind="protected" id={w.id} />
          </li>
        ))}
        {settings.protected.length === 0 ? <li className="py-2 text-sm text-ink-soft">None.</li> : null}
      </ul>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(() =>
            apiSend("/api/settings/windows/protected", "POST", {
              recurrence,
              weekday: recurrence === "weekly" ? weekday : null,
              onDate: recurrence === "once" ? onDate || null : null,
              startTime: start,
              endTime: end,
              label: label.trim() || null,
            }),
          );
        }}
      >
        <select aria-label="Protected recurrence" className="field w-auto" value={recurrence} onChange={(e) => setRecurrence(e.target.value as "weekly" | "once")}>
          <option value="weekly">Every week</option>
          <option value="once">One date</option>
        </select>
        {recurrence === "weekly" ? (
          <WeekdaySelect label="Protected weekday" value={weekday} onChange={setWeekday} />
        ) : (
          <input aria-label="Protected date" type="date" className="field w-auto" value={onDate} onChange={(e) => setOnDate(e.target.value)} required />
        )}
        <TimePair label="Protected" start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <input aria-label="Protected label" className="field w-36" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="submit" className="btn-ghost" disabled={busy}>Add protected window</button>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </form>
    </section>
  );
}

function PreferredSection({ settings }: { settings: SchedulerSettings }) {
  const [weekday, setWeekday] = useState<number | null>(null);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");
  const [workType, setWorkType] = useState<string>("");
  const [label, setLabel] = useState("");
  const { run, error, busy } = useSubmit();
  return (
    <section>
      <h3 className="label mb-2 uppercase">Preferred windows</h3>
      <p className="mb-2 text-sm text-ink-soft">Soft preferences by work type; the scheduler may go outside them with a stated reason.</p>
      <ul aria-label="Preferred windows" className="divide-y divide-line border-y border-line">
        {settings.preferred.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              <strong>{weekdayName(w.weekday)}</strong> {w.startTime}–{w.endTime}
              <span className="ml-2 text-ink-soft">{w.workType ?? "any work"}{w.label ? ` · ${w.label}` : ""}</span>
            </span>
            <DeleteButton kind="preferred" id={w.id} />
          </li>
        ))}
        {settings.preferred.length === 0 ? <li className="py-2 text-sm text-ink-soft">None.</li> : null}
      </ul>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(() =>
            apiSend("/api/settings/windows/preferred", "POST", {
              weekday,
              startTime: start,
              endTime: end,
              workType: workType || null,
              label: label.trim() || null,
            }),
          );
        }}
      >
        <WeekdaySelect label="Preferred weekday" value={weekday} onChange={setWeekday} allowAny />
        <TimePair label="Preferred" start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <select aria-label="Preferred work type" className="field w-auto" value={workType} onChange={(e) => setWorkType(e.target.value)}>
          <option value="">Any work</option>
          {WORK_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input aria-label="Preferred label" className="field w-36" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="submit" className="btn-ghost" disabled={busy}>Add preferred window</button>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </form>
    </section>
  );
}

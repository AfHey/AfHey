"use client";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/breezy/theme.css";
import "@fullcalendar/react/themes/breezy/palettes/indigo.css";
import FullCalendar, {
  type CalendarRef,
  type DateSelectInfo,
  type EventClickInfo,
  type EventDropInfo,
  type EventInput,
  type EventResizeDoneInfo,
} from "@fullcalendar/react";
import interactionPlugin from "@fullcalendar/react/interaction";
import breezyTheme from "@fullcalendar/react/themes/breezy";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import { DateTime } from "luxon";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PlanReview, type PlanRunDto } from "@/components/plan-review";
import { apiSend } from "@/lib/api";
import { eventColor, formatInZone, type CalendarEventDto, type CalendarViewName, type DeadlineMarkerDto } from "./view-model";

/**
 * FullCalendar v7 in a client component (decisions.md 2026-09-05). The
 * library draws the grid and reports gestures; every gesture becomes an API
 * call — direct edits for the user's own moves (spec §11.2 rule 13), a
 * scheduler Proposal for plans. Dates it hands back are formatted with Luxon
 * in the user's zone. The grid renders client-only (Intl hydration mismatch,
 * see the Step 1 spike).
 */
const subscribeNoop = () => () => {};
const useIsClient = () => useSyncExternalStore(subscribeNoop, () => true, () => false);

type Panel =
  | { kind: "block"; event: CalendarEventDto }
  | { kind: "event"; event: CalendarEventDto }
  | { kind: "select"; start: string; end: string }
  | { kind: "plan"; run: PlanRunDto };

interface BlockActionResult {
  event: unknown;
  warnings: Array<{ code: string; message: string }>;
}

type ActiveSession = { id: string; eventId: string | null; taskId: string } | null;

export function CalendarView({
  zone,
  initialDate,
  initialView,
  events,
  deadlines,
  activeSession,
  missedCount,
  today,
}: {
  zone: string;
  initialDate: string;
  initialView: CalendarViewName;
  events: CalendarEventDto[];
  deadlines: DeadlineMarkerDto[];
  activeSession: ActiveSession;
  missedCount: number;
  today: string;
}) {
  const ref = useRef<CalendarRef>(null);
  const router = useRouter();
  const isClient = useIsClient();
  const [title, setTitle] = useState("");
  const [view, setView] = useState<CalendarViewName>(initialView);
  const [status, setStatus] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [busy, setBusy] = useState(false);
  const [anchor, setAnchor] = useState(initialDate);

  useEffect(() => {
    if (!isClient) return;
    if (initialView === "timeGridWeek" && window.matchMedia("(max-width: 640px)").matches) {
      ref.current?.getApi().changeView("timeGridDay");
    }
  }, [initialView, isClient]);

  const byId = new Map(events.map((e) => [e.id, e]));
  const inputs: EventInput[] = [
    ...events.map((e) => ({
      id: e.id,
      title: `${e.isLocked ? "🔒 " : ""}${e.title}`,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      className: e.className.join(" "),
      color: eventColor(e),
      editable: !(e.kind === "block" && (e.blockState === "completed" || e.blockState === "cancelled")),
    })),
    ...deadlines.map((d) => ({
      id: d.id,
      title: d.title,
      start: d.date,
      allDay: true,
      editable: false,
      className: `afhey-deadline${d.hard ? " afhey-deadline-hard" : ""}`,
      color: d.hard ? "#b45309" : "#78716c",
    })),
  ];

  const api = () => ref.current?.getApi();
  const navigate = (direction: "prev" | "next" | "today") => {
    const calendar = api();
    if (!calendar) return;
    calendar[direction]();
    const date = DateTime.fromJSDate(calendar.getDate()).setZone(zone).toISODate()!;
    setAnchor(date);
    router.replace(`/calendar?date=${date}&view=${view === "timeGridDay" ? "day" : "week"}`, { scroll: false });
  };
  const switchView = (next: CalendarViewName) => api()?.changeView(next);

  async function run<T>(action: () => Promise<T>, onOk?: (result: T) => void): Promise<T | null> {
    setBusy(true);
    try {
      const result = await action();
      onOk?.(result);
      router.refresh();
      return result;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const describeWarnings = (warnings: Array<{ message: string }>) => (warnings.length ? ` — note: ${warnings.map((w) => w.message).join("; ")}` : "");
  const endLabel = (iso: string | Date) => (typeof iso === "string" ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso)).setZone(zone).toFormat("HH:mm");

  const onMoveOrResize = async (info: EventDropInfo | EventResizeDoneInfo, verb: "Moved" | "Resized") => {
    const dto = byId.get(info.event.id);
    const start = info.event.start;
    const end = info.event.end;
    if (!dto || !start || !end || dto.allDay) {
      info.revert();
      return;
    }
    const when = `${formatInZone(start, zone)} – ${endLabel(end)}`;
    if (dto.kind === "block") {
      const result = await run(() =>
        apiSend<BlockActionResult>(`/api/blocks/${dto.id}`, "PATCH", { action: "move", startAt: start.toISOString(), endAt: end.toISOString() }),
      );
      if (!result) return info.revert();
      setStatus(`${verb} "${dto.title}" to ${when}${describeWarnings(result.warnings)}`);
    } else {
      const result = await run(() => apiSend(`/api/events/${dto.id}`, "PATCH", { startAt: start.toISOString(), endAt: end.toISOString() }));
      if (!result) return info.revert();
      setStatus(`${verb} "${dto.title}" to ${when}`);
    }
  };

  const onSelect = (info: DateSelectInfo) => {
    setPanel({ kind: "select", start: info.start.toISOString(), end: info.end.toISOString() });
    api()?.unselect();
  };

  const onClick = (info: EventClickInfo) => {
    const dto = byId.get(info.event.id);
    if (!dto) return;
    setPanel({ kind: dto.kind === "block" ? "block" : "event", event: dto });
  };

  const blockAction = async (id: string, body: Record<string, unknown>, done: string) => {
    const result = await run(() => apiSend<BlockActionResult>(`/api/blocks/${id}`, "PATCH", body));
    if (result) {
      setStatus(`${done}${describeWarnings(result.warnings)}`);
      setPanel(null);
    }
  };

  const schedule = async (operation: "plan_day" | "plan_week" | "reschedule_day", date: string) => {
    const result = await run(() => apiSend<PlanRunDto>("/api/scheduler", "POST", { operation, date }));
    if (result) {
      setPanel({ kind: "plan", run: result });
      if (!result.proposal) setStatus("Nothing to change: the day is already planned or has no eligible work.");
    }
  };

  const weekStart = DateTime.fromISO(anchor, { zone }).startOf("week").toISODate()!;

  return (
    <section aria-label="Calendar" className="afhey-calendar">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost" aria-label="Previous" onClick={() => navigate("prev")}>‹</button>
          <button type="button" className="btn-ghost" onClick={() => navigate("today")}>Today</button>
          <button type="button" className="btn-ghost" aria-label="Next" onClick={() => navigate("next")}>›</button>
          <h2 className="display ml-2 text-lg font-semibold" aria-live="polite">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <div role="group" aria-label="View" className="flex gap-1">
            <button type="button" className={view === "timeGridDay" ? "btn-primary" : "btn-ghost"} aria-pressed={view === "timeGridDay"} onClick={() => switchView("timeGridDay")}>Day</button>
            <button type="button" className={view === "timeGridWeek" ? "btn-primary" : "btn-ghost"} aria-pressed={view === "timeGridWeek"} onClick={() => switchView("timeGridWeek")}>Week</button>
          </div>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => schedule("plan_day", anchor)}>Plan day</button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => schedule("plan_week", weekStart)}>Plan week</button>
        </div>
      </div>

      {missedCount > 0 ? (
        <p role="status" className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          {missedCount} block{missedCount === 1 ? "" : "s"} ended without a recorded outcome. Tap one to mark the work done or reschedule the day.
        </p>
      ) : null}

      {panel ? (
        <div className="mb-3">
          {panel.kind === "plan" ? (
            <PlanReview run={panel.run} zone={zone} onClose={() => { setPanel(null); router.refresh(); }} />
          ) : panel.kind === "select" ? (
            <NewEventForm
              zone={zone}
              start={panel.start}
              end={panel.end}
              busy={busy}
              onCancel={() => setPanel(null)}
              onSave={(body) =>
                run(() => apiSend("/api/events", "POST", body), () => {
                  setStatus(`Added "${String(body.title)}".`);
                  setPanel(null);
                })
              }
            />
          ) : panel.kind === "block" ? (
            <BlockPanel
              event={panel.event}
              zone={zone}
              busy={busy}
              active={activeSession}
              onClose={() => setPanel(null)}
              onAction={blockAction}
              onStart={() =>
                run(() => apiSend("/api/work-sessions", "POST", { taskId: panel.event.taskId, eventId: panel.event.id }), () => {
                  setStatus(`Focus started on "${panel.event.title}".`);
                  setPanel(null);
                })
              }
              onStop={() => {
                if (!activeSession) return;
                void run(() => apiSend(`/api/work-sessions/${activeSession.id}/stop`, "POST", {}), () => {
                  setStatus("Focus session stopped.");
                  setPanel(null);
                });
              }}
              onReschedule={() => schedule("reschedule_day", DateTime.fromISO(panel.event.start).setZone(zone).toISODate()!)}
            />
          ) : (
            <section aria-label="Event" className="rounded-xl border border-line bg-surface p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="display text-lg font-semibold">{panel.event.title}</h3>
                  <p className="text-ink-soft">
                    {panel.event.allDay ? `${panel.event.start} · all day` : `${formatInZone(panel.event.start, zone)} – ${endLabel(panel.event.end)}`} · {panel.event.kind} · {panel.event.scheduleType}
                  </p>
                </div>
                <button type="button" className="btn-quiet" aria-label="Close" onClick={() => setPanel(null)}>×</button>
              </div>
              <p className="mt-2 text-ink-soft">Drag to move or resize on the grid; edit details on the <a className="underline" href="/events">Events</a> page.</p>
            </section>
          )}
        </div>
      ) : null}

      {!isClient ? (
        <div aria-busy="true" className="rounded-lg border border-line" style={{ height: "calc(100dvh - 15rem)" }} />
      ) : (
        <FullCalendar
          ref={ref}
          plugins={[breezyTheme, timeGridPlugin, interactionPlugin]}
          initialView={initialView}
          initialDate={initialDate}
          timeZone={zone}
          firstDay={1}
          headerToolbar={false}
          events={inputs}
          editable
          eventDurationEditable
          eventResizableFromStart
          selectable
          nowIndicator
          scrollTime="08:00:00"
          slotDuration="00:30:00"
          height="calc(100dvh - 15rem)"
          longPressDelay={400}
          eventLongPressDelay={400}
          selectLongPressDelay={500}
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          datesSet={(info) => {
            setTitle(info.view.title);
            setView(info.view.type as CalendarViewName);
          }}
          eventDrop={(info) => void onMoveOrResize(info, "Moved")}
          eventResize={(info) => void onMoveOrResize(info, "Resized")}
          select={onSelect}
          eventClick={onClick}
        />
      )}
      <p role="status" aria-live="polite" data-testid="calendar-status" className="mt-3 min-h-5 text-sm text-ink-soft">
        {status}
      </p>
      <p className="mt-1 text-xs text-ink-soft">Today is {today}. Fixed events and locked blocks are never moved by the scheduler; flexible blocks may be.</p>
    </section>
  );
}

function BlockPanel({
  event,
  zone,
  busy,
  active,
  onClose,
  onAction,
  onStart,
  onStop,
  onReschedule,
}: {
  event: CalendarEventDto;
  zone: string;
  busy: boolean;
  active: ActiveSession;
  onClose: () => void;
  onAction: (id: string, body: Record<string, unknown>, done: string) => Promise<void>;
  onStart: () => void;
  onStop: () => void;
  onReschedule: () => void;
}) {
  const state = event.blockState ?? "planned";
  const running = active?.eventId === event.id;
  const label = `${formatInZone(event.start, zone)} – ${DateTime.fromISO(event.end).setZone(zone).toFormat("HH:mm")}`;
  return (
    <section aria-label="Block actions" className="rounded-xl border border-line bg-surface p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="display text-lg font-semibold">{event.title}</h3>
          <p className="text-ink-soft">
            {label} · {state.replace("_", " ")} · {event.scheduleType}{event.isLocked ? " · locked" : ""}
          </p>
        </div>
        <button type="button" className="btn-quiet" aria-label="Close" onClick={onClose}>×</button>
      </div>
      {state === "missed_unconfirmed" ? (
        <p className="mt-2">This block ended without a recorded outcome. Mark the work done, or reschedule the day.</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {state === "in_progress" || running ? (
          <button type="button" className="btn-primary" disabled={busy || !active} onClick={onStop}>Stop focus</button>
        ) : state === "planned" || state === "missed_unconfirmed" ? (
          <button type="button" className="btn-primary" disabled={busy || !!active} title={active ? "Another focus session is running" : undefined} onClick={onStart}>Start focus</button>
        ) : null}
        {state !== "completed" && state !== "in_progress" ? (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => onAction(event.id, { action: "done" }, `Marked "${event.title}" as done.`)}>Mark done</button>
        ) : null}
        {state === "missed_unconfirmed" ? (
          <button type="button" className="btn-ghost" disabled={busy} onClick={onReschedule}>Reschedule day</button>
        ) : null}
        {event.scheduleType === "flexible" ? (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => onAction(event.id, { action: "lock", locked: !event.isLocked }, event.isLocked ? "Unlocked." : "Locked: the scheduler will leave this block where it is.")}>
            {event.isLocked ? "Unlock" : "Lock"}
          </button>
        ) : null}
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => onAction(event.id, { action: "fixed", fixed: event.scheduleType !== "fixed" }, event.scheduleType === "fixed" ? "Now flexible." : "Now fixed: a real commitment the scheduler never moves.")}>
          {event.scheduleType === "fixed" ? "Make flexible" : "Make fixed"}
        </button>
        {state !== "completed" ? (
          <button type="button" className="btn-ghost text-danger" disabled={busy} onClick={() => onAction(event.id, { action: "unschedule" }, `Unscheduled "${event.title}"; the task stays in your list.`)}>Unschedule</button>
        ) : null}
      </div>
    </section>
  );
}

function NewEventForm({
  zone,
  start,
  end,
  busy,
  onCancel,
  onSave,
}: {
  zone: string;
  start: string;
  end: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => unknown;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"meeting" | "appointment" | "personal" | "other">("meeting");
  return (
    <form
      aria-label="New event"
      className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onSave({ title: title.trim(), kind, scheduleType: "fixed", isLocked: false, timezone: zone, startAt: start, endAt: end, peopleIds: [] });
      }}
    >
      <div className="w-full text-ink-soft">
        New fixed event {formatInZone(start, zone)} – {DateTime.fromISO(end).setZone(zone).toFormat("HH:mm")}
      </div>
      <input aria-label="Event title" className="field w-56" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
      <select aria-label="Event kind" className="field w-auto" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        <option value="meeting">Meeting</option>
        <option value="appointment">Appointment</option>
        <option value="personal">Personal</option>
        <option value="other">Other</option>
      </select>
      <button type="submit" className="btn-primary" disabled={busy}>Save event</button>
      <button type="button" className="btn-quiet" onClick={onCancel}>Cancel</button>
    </form>
  );
}

"use client";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/breezy/theme.css";
import "@fullcalendar/react/themes/breezy/palettes/indigo.css";
import FullCalendar, {
  type CalendarRef,
  type DateSelectInfo,
  type EventDropInfo,
  type EventInput,
  type EventResizeDoneInfo,
} from "@fullcalendar/react";
import interactionPlugin from "@fullcalendar/react/interaction";
import breezyTheme from "@fullcalendar/react/themes/breezy";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatInZone, type CalendarEventDto, type CalendarViewName } from "./view-model";

/**
 * FullCalendar v7 in a client component (decisions.md 2026-09-05). The
 * library draws the grid and reports gestures; every date it hands back is
 * formatted with Luxon in the user's zone and, in this spike, reverted rather
 * than saved. `longPressDelay` makes touch drag deliberate (spec §5 mobile).
 *
 * The grid renders client-only: FullCalendar formats ranges with Intl, and
 * Node's ICU and the browser's ICU disagree on the invisible spacing around
 * "10:00 – 10:30", which made React's hydration reject the server HTML
 * (Step 1 spike, 2026-09-05). The page shell is still server-rendered.
 */
const subscribeNoop = () => () => {};
const useIsClient = () => useSyncExternalStore(subscribeNoop, () => true, () => false);

export function CalendarView({
  zone,
  initialDate,
  initialView,
  events,
}: {
  zone: string;
  initialDate: string;
  initialView: CalendarViewName;
  events: CalendarEventDto[];
}) {
  const ref = useRef<CalendarRef>(null);
  const router = useRouter();
  const isClient = useIsClient();
  const [title, setTitle] = useState("");
  const [view, setView] = useState<CalendarViewName>(initialView);
  const [gesture, setGesture] = useState<string | null>(null);
  const inputs: EventInput[] = events.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    className: e.className.join(" "), // v7 takes one class string per event
    editable: e.kind !== "block" || !e.isLocked,
    extendedProps: { kind: e.kind, scheduleType: e.scheduleType, isLocked: e.isLocked, blockState: e.blockState },
  }));

  // Phones start in the day view; the server cannot know the viewport. The
  // resulting datesSet callback updates the view state.
  useEffect(() => {
    if (!isClient) return;
    if (initialView === "timeGridWeek" && window.matchMedia("(max-width: 640px)").matches) {
      ref.current?.getApi().changeView("timeGridDay");
    }
  }, [initialView, isClient]);

  const api = () => ref.current?.getApi();
  const navigate = (direction: "prev" | "next" | "today") => {
    const calendar = api();
    if (!calendar) return;
    calendar[direction]();
    const date = calendar.getDate();
    router.replace(`/calendar?date=${date.toISOString().slice(0, 10)}&view=${view === "timeGridDay" ? "day" : "week"}`, { scroll: false });
  };
  const switchView = (next: CalendarViewName) => {
    api()?.changeView(next);
    setView(next);
  };

  const onDrop = (info: EventDropInfo) => {
    const start = info.event.start;
    const end = info.event.end;
    setGesture(
      start && end
        ? `Would move "${info.event.title}" to ${formatInZone(start, zone)} – ${formatInZone(end, zone)} (${zone}). Not saved in the spike.`
        : `Would move "${info.event.title}". Not saved in the spike.`,
    );
    info.revert();
  };
  const onResize = (info: EventResizeDoneInfo) => {
    const start = info.event.start;
    const end = info.event.end;
    setGesture(
      start && end
        ? `Would resize "${info.event.title}" to ${formatInZone(start, zone)} – ${formatInZone(end, zone)} (${zone}). Not saved in the spike.`
        : `Would resize "${info.event.title}". Not saved in the spike.`,
    );
    info.revert();
  };
  const onSelect = (info: DateSelectInfo) => {
    setGesture(`Would create an event ${formatInZone(info.start, zone)} – ${formatInZone(info.end, zone)} (${zone}). Not saved in the spike.`);
    api()?.unselect();
  };

  return (
    <section aria-label="Calendar" className="afhey-calendar">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost" aria-label="Previous" onClick={() => navigate("prev")}>‹</button>
          <button type="button" className="btn-ghost" onClick={() => navigate("today")}>Today</button>
          <button type="button" className="btn-ghost" aria-label="Next" onClick={() => navigate("next")}>›</button>
          <h2 className="display ml-2 text-lg font-semibold" aria-live="polite">{title}</h2>
        </div>
        <div role="group" aria-label="View" className="flex gap-1">
          <button type="button" className={view === "timeGridDay" ? "btn-primary" : "btn-ghost"} aria-pressed={view === "timeGridDay"} onClick={() => switchView("timeGridDay")}>Day</button>
          <button type="button" className={view === "timeGridWeek" ? "btn-primary" : "btn-ghost"} aria-pressed={view === "timeGridWeek"} onClick={() => switchView("timeGridWeek")}>Week</button>
        </div>
      </div>
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
        eventDrop={onDrop}
        eventResize={onResize}
        select={onSelect}
      />
      )}
      <p role="status" aria-live="polite" data-testid="calendar-gesture" className="mt-3 min-h-5 text-sm text-ink-soft">
        {gesture}
      </p>
    </section>
  );
}

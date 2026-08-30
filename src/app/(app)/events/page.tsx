import { EmptyState, PageHeader } from "@/components/page-header";
import { dbToIsoDate } from "@/core/domain/time";
import { getPrisma } from "@/db/client";
import type { Prisma } from "@/db/generated/client";
import { formatDateOnly, formatTimeRange } from "@/lib/format";
import type { SelectOption } from "../tasks/types";
import { EventComposer, EventItem } from "./event-ui";
import type { EventDto } from "./types";

type EventRow = Prisma.EventGetPayload<{ include: { project: true } }>;

function toDto(event: EventRow): EventDto {
  const whenLabel =
    event.startAt && event.endAt
      ? formatTimeRange(event.startAt, event.endAt, event.timezone)
      : event.allDayStartDate
        ? `${formatDateOnly(event.allDayStartDate)} · all day`
        : "";
  const reference = event.endAt ?? event.allDayEndDate ?? new Date(0);
  return {
    id: event.id,
    title: event.title,
    kind: event.kind,
    scheduleType: event.scheduleType,
    isLocked: event.isLocked,
    startAt: event.startAt?.toISOString() ?? null,
    endAt: event.endAt?.toISOString() ?? null,
    allDayStartDate: event.allDayStartDate ? dbToIsoDate(event.allDayStartDate) : null,
    allDayEndDate: event.allDayEndDate ? dbToIsoDate(event.allDayEndDate) : null,
    timezone: event.timezone,
    projectId: event.projectId,
    projectName: event.project?.name ?? null,
    location: event.location,
    description: event.description,
    notes: event.notes,
    whenLabel,
    past: reference.getTime() < Date.now(),
  };
}

export default async function EventsPage() {
  const db = getPrisma();
  const [events, projects] = await Promise.all([
    db.event.findMany({
      where: { archivedAt: null },
      include: { project: true },
      orderBy: [{ startAt: "asc" }, { allDayStartDate: "asc" }],
    }),
    db.project.findMany({
      where: { kind: "project", status: "active", archivedAt: null },
      orderBy: { name: "asc" },
    }),
  ]);
  const projectOptions: SelectOption[] = projects.map((p) => ({ id: p.id, name: p.name }));
  const dtos = events.map(toDto);
  const upcoming = dtos.filter((e) => !e.past);
  const past = dtos.filter((e) => e.past).reverse().slice(0, 20);

  return (
    <>
      <PageHeader
        title="Events"
        note="Fixed commitments and appointments; the calendar view arrives in Phase 2."
      />
      <EventComposer projects={projectOptions} />
      {dtos.length === 0 ? (
        <EmptyState line="An open calendar." hint="Add a commitment above." />
      ) : (
        <>
          {upcoming.length > 0 ? (
            <section className="mt-8">
              <h2 className="label mb-1 uppercase">Upcoming</h2>
              <ul className="divide-y divide-line border-y border-line">
                {upcoming.map((e) => (
                  <EventItem key={e.id} event={e} projects={projectOptions} />
                ))}
              </ul>
            </section>
          ) : null}
          {past.length > 0 ? (
            <section className="mt-8">
              <h2 className="label mb-1 uppercase">Past</h2>
              <ul className="divide-y divide-line border-y border-line">
                {past.map((e) => (
                  <EventItem key={e.id} event={e} projects={projectOptions} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

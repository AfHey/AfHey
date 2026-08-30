import { notFound } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/page-header";
import { getPrisma } from "@/db/client";
import { TaskItem } from "../../tasks/task-item";
import type { SelectOption } from "../../tasks/types";
import { ProjectEditor } from "../project-ui";

// Reuse the tasks page DTO mapping.
import { effectivePriority } from "@/core/domain/priority";
import { dbToIsoDate } from "@/core/domain/time";
import type { Prisma } from "@/db/generated/client";
import { formatDateOnly, formatInstant, isDateOnlyOverdue } from "@/lib/format";

type TaskRow = Prisma.TaskGetPayload<{ include: { project: true; waitingForPerson: true } }>;

function toDto(task: TaskRow) {
  const deadlineLabel = task.deadlineDate
    ? formatDateOnly(task.deadlineDate)
    : task.deadlineAt && task.deadlineTimezone
      ? formatInstant(task.deadlineAt, task.deadlineTimezone)
      : null;
  return {
    id: task.id,
    title: task.title,
    completed: task.status === "completed",
    taskKind: task.taskKind,
    bucket: task.bucket,
    description: task.description,
    notes: task.notes,
    projectId: task.projectId,
    projectName: task.project?.name ?? null,
    deadlineDate: task.deadlineDate ? dbToIsoDate(task.deadlineDate) : null,
    deadlineAt: task.deadlineAt?.toISOString() ?? null,
    deadlineTimezone: task.deadlineTimezone,
    deadlineType: task.deadlineType,
    remindAt: task.remindAt?.toISOString() ?? null,
    reminderTimezone: task.reminderTimezone,
    waitingForPersonId: task.waitingForPersonId,
    waitingForPersonName: task.waitingForPerson?.name ?? null,
    nudgeDate: task.nudgeDate ? dbToIsoDate(task.nudgeDate) : null,
    estimatedDurationMinutes: task.estimatedDurationMinutes,
    remainingEstimateMinutes: task.remainingEstimateMinutes,
    userPriority: task.userPriority,
    effectivePriority: effectivePriority(task.userPriority, task.computedPriorityScore),
    deadlineLabel,
    overdue:
      task.status === "open" &&
      ((task.deadlineDate !== null && isDateOnlyOverdue(task.deadlineDate)) ||
        (task.deadlineAt !== null && task.deadlineAt.getTime() < Date.now())),
  };
}

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const db = getPrisma();
  const project = await db.project.findUnique({
    where: { id },
    include: {
      parent: true,
      tasks: {
        where: { archivedAt: null },
        include: { project: true, waitingForPerson: true, people: { include: { person: true } } },
        orderBy: { createdAt: "desc" },
      },
      notes: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!project || project.kind !== "project") notFound();

  const [areas, allProjects, people] = await Promise.all([
    db.project.findMany({ where: { kind: "area", archivedAt: null }, orderBy: { name: "asc" } }),
    db.project.findMany({
      where: { kind: "project", status: "active", archivedAt: null },
      orderBy: { name: "asc" },
    }),
    db.person.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
  ]);

  const projectOptions: SelectOption[] = allProjects.map((p) => ({ id: p.id, name: p.name }));
  const peopleOptions: SelectOption[] = people.map((p) => ({ id: p.id, name: p.name }));
  const areaOptions: SelectOption[] = areas.map((a) => ({ id: a.id, name: a.name }));

  const related = new Map<string, string>();
  for (const task of project.tasks) {
    if (task.waitingForPerson) related.set(task.waitingForPerson.id, task.waitingForPerson.name);
    for (const link of task.people) related.set(link.person.id, link.person.name);
  }

  const open = project.tasks.filter((t) => t.status === "open").map(toDto);
  const done = project.tasks.filter((t) => t.status === "completed").map(toDto);

  return (
    <>
      <PageHeader
        title={project.name}
        note={[project.parent?.name, project.importance ? `${project.importance} importance` : null]
          .filter(Boolean)
          .join(" · ") || undefined}
      >
        <ProjectEditor
          project={{
            id: project.id,
            name: project.name,
            parentId: project.parentId,
            description: project.description,
            importance: project.importance,
            status: project.status,
          }}
          areas={areaOptions}
        />
      </PageHeader>

      {project.description ? (
        <p className="mb-6 text-sm text-ink-soft">{project.description}</p>
      ) : null}
      {related.size > 0 ? (
        <p className="mb-6 text-xs text-ink-soft">
          People: {Array.from(related.values()).join(", ")}
        </p>
      ) : null}

      <section>
        <h2 className="label mb-1 uppercase">Open tasks</h2>
        {open.length === 0 ? (
          <EmptyState line="Nothing open here." />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {open.map((t) => (
              <TaskItem key={t.id} task={t} projects={projectOptions} people={peopleOptions} />
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 ? (
        <section className="mt-8">
          <h2 className="label mb-1 uppercase">Completed</h2>
          <ul className="divide-y divide-line border-y border-line">
            {done.slice(0, 15).map((t) => (
              <TaskItem key={t.id} task={t} projects={projectOptions} people={peopleOptions} />
            ))}
          </ul>
        </section>
      ) : null}

      {project.notes.length > 0 ? (
        <section className="mt-8">
          <h2 className="label mb-1 uppercase">Notes</h2>
          <ul className="divide-y divide-line border-y border-line">
            {project.notes.map((n) => (
              <li key={n.id} className="py-2.5">
                {n.title ? <p className="text-sm font-medium">{n.title}</p> : null}
                <p className="text-sm whitespace-pre-wrap text-ink-soft">{n.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

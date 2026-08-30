import { EmptyState, PageHeader } from "@/components/page-header";
import { effectivePriority } from "@/core/domain/priority";
import { dbToIsoDate } from "@/core/domain/time";
import { getPrisma } from "@/db/client";
import type { Prisma } from "@/db/generated/client";
import { formatDateOnly, formatInstant, isDateOnlyOverdue } from "@/lib/format";
import { TaskComposer } from "./task-composer";
import { TaskItem } from "./task-item";
import type { SelectOption, TaskDto } from "./types";

type TaskRow = Prisma.TaskGetPayload<{
  include: { project: true; waitingForPerson: true };
}>;

function toDto(task: TaskRow): TaskDto {
  const deadlineLabel = task.deadlineDate
    ? formatDateOnly(task.deadlineDate)
    : task.deadlineAt && task.deadlineTimezone
      ? formatInstant(task.deadlineAt, task.deadlineTimezone)
      : null;
  const overdue =
    task.status === "open" &&
    ((task.deadlineDate !== null && isDateOnlyOverdue(task.deadlineDate)) ||
      (task.deadlineAt !== null && task.deadlineAt.getTime() < Date.now()));
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
    overdue,
  };
}

export default async function TasksPage() {
  const db = getPrisma();
  const [tasks, projects, people] = await Promise.all([
    db.task.findMany({
      where: { archivedAt: null },
      include: { project: true, waitingForPerson: true },
      orderBy: [{ createdAt: "desc" }],
    }),
    db.project.findMany({
      where: { kind: "project", status: "active", archivedAt: null },
      orderBy: { name: "asc" },
    }),
    db.person.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
  ]);

  const projectOptions: SelectOption[] = projects.map((p) => ({ id: p.id, name: p.name }));
  const peopleOptions: SelectOption[] = people.map((p) => ({ id: p.id, name: p.name }));

  const dtos = tasks.map(toDto);
  const open = dtos.filter((t) => !t.completed);
  const groups: Array<{ key: string; label: string; items: TaskDto[] }> = [
    { key: "active", label: "Active", items: open.filter((t) => t.bucket === "active") },
    { key: "backlog", label: "Backlog", items: open.filter((t) => t.bucket === "backlog") },
    { key: "someday", label: "Someday", items: open.filter((t) => t.bucket === "someday") },
    { key: "done", label: "Completed", items: dtos.filter((t) => t.completed).slice(0, 20) },
  ];

  return (
    <>
      <PageHeader title="Tasks" note={`${open.length} open`} />
      <TaskComposer projects={projectOptions} people={peopleOptions} />
      {open.length === 0 && groups[3].items.length === 0 ? (
        <EmptyState line="A clear ledger." hint="Add a task above, or capture from the Inbox once it opens." />
      ) : (
        groups
          .filter((g) => g.items.length > 0)
          .map((group) => (
            <section key={group.key} className="mt-8">
              <h2 className="label mb-1 uppercase">{group.label}</h2>
              <ul className="divide-y divide-line border-y border-line">
                {group.items.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    projects={projectOptions}
                    people={peopleOptions}
                  />
                ))}
              </ul>
            </section>
          ))
      )}
    </>
  );
}

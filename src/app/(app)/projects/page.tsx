import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { getPrisma } from "@/db/client";
import { formatDateOnly, isDateOnlyOverdue } from "@/lib/format";
import { ProjectComposer } from "./project-ui";

export default async function ProjectsPage() {
  const db = getPrisma();
  const all = await db.project.findMany({
    where: { archivedAt: null },
    include: {
      tasks: { where: { archivedAt: null, status: "open" }, select: { deadlineDate: true, deadlineAt: true } },
    },
    orderBy: { name: "asc" },
  });
  const areas = all.filter((p) => p.kind === "area");
  const projects = all.filter((p) => p.kind === "project");
  const byArea = (areaId: string | null) => projects.filter((p) => p.parentId === areaId);

  function health(p: (typeof projects)[number]) {
    const open = p.tasks.length;
    const overdue = p.tasks.filter(
      (t) =>
        (t.deadlineDate && isDateOnlyOverdue(t.deadlineDate)) ||
        (t.deadlineAt && t.deadlineAt.getTime() < Date.now()),
    ).length;
    const nextDate = p.tasks
      .map((t) => t.deadlineDate ?? t.deadlineAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return { open, overdue, nextDate };
  }

  const sections: Array<{ id: string | null; name: string }> = [
    ...areas.map((a) => ({ id: a.id as string | null, name: a.name })),
    ...(byArea(null).length > 0 ? [{ id: null, name: "No area" }] : []),
  ];

  return (
    <>
      <PageHeader title="Projects" note="Area → project → task; one calm hierarchy." />
      <ProjectComposer areas={areas.map((a) => ({ id: a.id, name: a.name }))} />
      {projects.length === 0 && areas.length === 0 ? (
        <EmptyState line="Nothing underway." hint="Create an area, then a project inside it." />
      ) : (
        sections.map((section) => (
          <section key={section.id ?? "none"} className="mt-8">
            <h2 className="label mb-1 uppercase">{section.name}</h2>
            <ul className="divide-y divide-line border-y border-line">
              {byArea(section.id).map((p) => {
                const h = health(p);
                return (
                  <li key={p.id}>
                    <Link
                      href={`/projects/${p.id}`}
                      className="flex items-baseline justify-between gap-3 py-2.5 hover:text-brass"
                    >
                      <span className="text-sm">{p.name}</span>
                      <span className="flex shrink-0 gap-3 text-xs text-ink-soft">
                        {h.overdue > 0 ? (
                          <span className="font-medium text-danger">{h.overdue} overdue</span>
                        ) : null}
                        <span>{h.open} open</span>
                        {h.nextDate ? <span>next {formatDateOnly(h.nextDate)}</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {byArea(section.id).length === 0 ? (
                <li className="py-2.5 text-sm text-ink-soft">No projects yet.</li>
              ) : null}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

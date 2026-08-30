import { EmptyState, PageHeader } from "@/components/page-header";
import { getPrisma } from "@/db/client";
import type { SelectOption } from "../tasks/types";
import { NoteComposer, NoteItem } from "./note-ui";

export default async function NotesPage() {
  const db = getPrisma();
  const [notes, projects] = await Promise.all([
    db.note.findMany({
      where: { archivedAt: null },
      include: { project: true },
      orderBy: { createdAt: "desc" },
    }),
    db.project.findMany({
      where: { kind: "project", status: "active", archivedAt: null },
      orderBy: { name: "asc" },
    }),
  ]);
  const projectOptions: SelectOption[] = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <PageHeader title="Notes" note={`${notes.length} kept`} />
      <NoteComposer projects={projectOptions} />
      {notes.length === 0 ? (
        <EmptyState line="A blank page." hint="Keep reference material here; captures can become notes too." />
      ) : (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {notes.map((n) => (
            <NoteItem
              key={n.id}
              note={{
                id: n.id,
                title: n.title,
                body: n.body,
                projectId: n.projectId,
                projectName: n.project?.name ?? null,
              }}
              projects={projectOptions}
            />
          ))}
        </ul>
      )}
    </>
  );
}

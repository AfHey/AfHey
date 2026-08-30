import { EmptyState, PageHeader } from "@/components/page-header";
import { getPrisma } from "@/db/client";
import { PersonComposer, PersonItem } from "./person-ui";

export default async function PeoplePage() {
  const db = getPrisma();
  const people = await db.person.findMany({
    where: { archivedAt: null },
    include: {
      aliases: { where: { archivedAt: null } },
      _count: { select: { waitingForTasks: { where: { status: "open", archivedAt: null } } } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader title="People" note="Lightweight — names, aliases, and what they owe you. Not a CRM." />
      <PersonComposer />
      {people.length === 0 ? (
        <EmptyState line="No one on file." hint="People make waiting-for tasks and entity resolution work." />
      ) : (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {people.map((p) => (
            <PersonItem
              key={p.id}
              person={{
                id: p.id,
                name: p.name,
                role: p.role,
                notes: p.notes,
                aliases: p.aliases.map((a) => ({ id: a.id, alias: a.alias })),
                waitingCount: p._count.waitingForTasks,
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}

import { PageHeader } from "@/components/page-header";
import { loadSchedulerSettings } from "@/core/domain/scheduler-settings";
import { getPrisma } from "@/db/client";
import { SchedulerSettings } from "./scheduler-ui";
import { GlossarySection, SettingsForm, SignOutButton } from "./settings-ui";

export default async function SettingsPage() {
  const db = getPrisma();
  const [settings, glossary, projects, people, scheduler] = await Promise.all([
    db.userSettings.findFirst(),
    db.glossaryEntry.findMany({ where: { archivedAt: null }, orderBy: { term: "asc" } }),
    db.project.findMany({
      where: { kind: "project", status: "active", archivedAt: null },
      orderBy: { name: "asc" },
    }),
    db.person.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
    loadSchedulerSettings(db),
  ]);

  const entityOptions = [
    ...projects.map((p) => ({ value: `project:${p.id}`, label: `Project: ${p.name}` })),
    ...people.map((p) => ({ value: `person:${p.id}`, label: `Person: ${p.name}` })),
  ];

  return (
    <>
      <PageHeader title="Settings" note="Timezone, scheduling constraints, and the glossary AfHey resolves your shorthand against." />
      <section className="rounded-xl border border-line bg-surface p-4">
        <SettingsForm currentTimezone={settings?.currentTimezone ?? "America/New_York"} />
      </section>

      <section className="mt-8" aria-labelledby="scheduling-heading">
        <h2 id="scheduling-heading" className="label mb-2 uppercase">Scheduling</h2>
        <SchedulerSettings settings={scheduler} />
      </section>

      <section className="mt-8">
        <h2 className="label mb-2 uppercase">Glossary</h2>
        <GlossarySection
          entries={glossary.map((g) => ({
            id: g.id,
            term: g.term,
            expandsTo: g.expandsTo,
            entityType: g.entityType,
            entityId: g.entityId,
          }))}
          entityOptions={entityOptions}
        />
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <SignOutButton />
      </section>
    </>
  );
}

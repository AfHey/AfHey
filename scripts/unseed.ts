/**
 * Removes the fictional development seed from the database at DATABASE_URL
 * by its fixed ids (prisma/seed-ids.ts) — projects, people and aliases,
 * glossary entries, tasks, events, notes, plus any blocks and work sessions
 * that hang off the seeded tasks. Rows the user created are untouched: they
 * carry random ids. The Work and Personal areas, availability, protected and
 * preferred windows, and scheduler preferences stay, because they are the
 * user's own settings structure rather than fictional content.
 *
 *   npm run db:unseed
 *
 * Idempotent; safe to run again. Seeding test databases is unchanged.
 */
import { ID } from "../prisma/seed-ids";
import { createPrismaClient } from "../src/db/client";
import { loadLocalEnv } from "../src/lib/env";

loadLocalEnv();
const db = createPrismaClient();

const pick = (prefix: string) => Object.entries(ID).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
const projectIds = pick("project");
const personIds = pick("person");
const aliasIds = pick("alias");
const glossaryIds = pick("glossary");
const taskIds = pick("task");
const eventIds = pick("event");
const noteIds = pick("note");

async function main() {
  const summary = await db.$transaction(async (tx) => {
    const blocks = await tx.event.findMany({ where: { kind: "block", taskId: { in: taskIds } }, select: { id: true } });
    const blockIds = blocks.map((b) => b.id);
    const workSessions = await tx.workSession.deleteMany({ where: { OR: [{ taskId: { in: taskIds } }, { eventId: { in: [...eventIds, ...blockIds] } }] } });
    await tx.eventPerson.deleteMany({ where: { OR: [{ eventId: { in: [...eventIds, ...blockIds] } }, { personId: { in: personIds } }] } });
    const events = await tx.event.deleteMany({ where: { id: { in: [...eventIds, ...blockIds] } } });
    await tx.taskPerson.deleteMany({ where: { OR: [{ taskId: { in: taskIds } }, { personId: { in: personIds } }] } });
    await tx.task.updateMany({ where: { waitingForPersonId: { in: personIds }, id: { notIn: taskIds } }, data: { waitingForPersonId: null } });
    const tasks = await tx.task.deleteMany({ where: { id: { in: taskIds } } });
    const notes = await tx.note.deleteMany({ where: { id: { in: noteIds } } });
    await tx.personAlias.deleteMany({ where: { OR: [{ id: { in: aliasIds } }, { personId: { in: personIds } }] } });
    const people = await tx.person.deleteMany({ where: { id: { in: personIds } } });
    const glossary = await tx.glossaryEntry.deleteMany({ where: { id: { in: glossaryIds } } });
    // User-created items filed under a seeded project keep their data and lose only the link.
    await tx.task.updateMany({ where: { projectId: { in: projectIds } }, data: { projectId: null } });
    await tx.event.updateMany({ where: { projectId: { in: projectIds } }, data: { projectId: null } });
    await tx.note.updateMany({ where: { projectId: { in: projectIds } }, data: { projectId: null } });
    const projects = await tx.project.deleteMany({ where: { id: { in: projectIds } } });
    return { projects: projects.count, people: people.count, glossary: glossary.count, tasks: tasks.count, events: events.count, blocks: blockIds.length, notes: notes.count, workSessions: workSessions.count };
  });
  console.log("Seed removed:", summary);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

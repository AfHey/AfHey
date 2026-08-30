/**
 * Development seed — wholly fictional people, projects, and items
 * (product-spec §14.4 / CLAUDE.md rule 8: nothing here may come from
 * specification examples or any real person, organization, or study).
 *
 * Idempotent: every row is upserted under a fixed UUID.
 * Captures, Proposals, WorkSessions, and block Events are runtime artifacts
 * and are deliberately not seeded (Phase 1 stores no blocks at all).
 */
import { createPrismaClient } from "../src/db/client";
import { loadLocalEnv } from "../src/lib/env";

loadLocalEnv();
const db = createPrismaClient();

const ID = {
  areaWork: "a0000000-0000-4000-8000-000000000001",
  areaPersonal: "a0000000-0000-4000-8000-000000000002",
  projectPipeline: "b0000000-0000-4000-8000-000000000001",
  projectRenovation: "b0000000-0000-4000-8000-000000000002",
  personPriya: "c0000000-0000-4000-8000-000000000001",
  personJonas: "c0000000-0000-4000-8000-000000000002",
  personMarta: "c0000000-0000-4000-8000-000000000003",
  aliasPriya: "c1000000-0000-4000-8000-000000000001",
  aliasJonas: "c1000000-0000-4000-8000-000000000002",
  aliasJW: "c1000000-0000-4000-8000-000000000003",
  aliasMarta: "c1000000-0000-4000-8000-000000000004",
  glossaryAdp: "d0000000-0000-4000-8000-000000000001",
  glossaryReno: "d0000000-0000-4000-8000-000000000002",
  taskRetryDesign: "e0000000-0000-4000-8000-000000000001",
  taskTile: "e0000000-0000-4000-8000-000000000002",
  taskCabinetQuote: "e0000000-0000-4000-8000-000000000003",
  taskLibraryCard: "e0000000-0000-4000-8000-000000000004",
  taskVenue: "e0000000-0000-4000-8000-000000000005",
  eventPipelineSync: "f0000000-0000-4000-8000-000000000001",
  eventDentist: "f0000000-0000-4000-8000-000000000002",
  eventTileDelivery: "f0000000-0000-4000-8000-000000000003",
  noteBacksplash: "90000000-0000-4000-8000-000000000001",
  noteRetryConstraints: "90000000-0000-4000-8000-000000000002",
} as const;

async function main() {
  // Areas and projects (one area level, spec §6).
  await db.project.upsert({
    where: { id: ID.areaWork },
    update: {},
    create: { id: ID.areaWork, kind: "area", name: "Work" },
  });
  await db.project.upsert({
    where: { id: ID.areaPersonal },
    update: {},
    create: { id: ID.areaPersonal, kind: "area", name: "Personal" },
  });
  await db.project.upsert({
    where: { id: ID.projectPipeline },
    update: {},
    create: {
      id: ID.projectPipeline,
      kind: "project",
      name: "Aurora Data Pipeline",
      parentId: ID.areaWork,
      description: "Fictional internal data-processing project.",
      importance: "high",
    },
  });
  await db.project.upsert({
    where: { id: ID.projectRenovation },
    update: {},
    create: {
      id: ID.projectRenovation,
      kind: "project",
      name: "Kitchen Renovation",
      parentId: ID.areaPersonal,
      importance: "medium",
    },
  });

  // People and aliases.
  await db.person.upsert({
    where: { id: ID.personPriya },
    update: {},
    create: { id: ID.personPriya, name: "Priya Raman", role: "colleague" },
  });
  await db.person.upsert({
    where: { id: ID.personJonas },
    update: {},
    create: { id: ID.personJonas, name: "Jonas Weber", role: "colleague" },
  });
  await db.person.upsert({
    where: { id: ID.personMarta },
    update: {},
    create: { id: ID.personMarta, name: "Marta Kovacs", role: "contractor" },
  });
  const aliases: Array<{ id: string; personId: string; alias: string }> = [
    { id: ID.aliasPriya, personId: ID.personPriya, alias: "Priya" },
    { id: ID.aliasJonas, personId: ID.personJonas, alias: "Jonas" },
    { id: ID.aliasJW, personId: ID.personJonas, alias: "JW" },
    { id: ID.aliasMarta, personId: ID.personMarta, alias: "Marta" },
  ];
  for (const a of aliases) {
    await db.personAlias.upsert({
      where: { id: a.id },
      update: {},
      create: { ...a, normalizedAlias: a.alias.toLowerCase() },
    });
  }

  // Glossary.
  await db.glossaryEntry.upsert({
    where: { id: ID.glossaryAdp },
    update: {},
    create: {
      id: ID.glossaryAdp,
      term: "ADP",
      normalizedTerm: "adp",
      expandsTo: "Aurora Data Pipeline",
      entityType: "project",
      entityId: ID.projectPipeline,
    },
  });
  await db.glossaryEntry.upsert({
    where: { id: ID.glossaryReno },
    update: {},
    create: {
      id: ID.glossaryReno,
      term: "reno",
      normalizedTerm: "reno",
      expandsTo: "Kitchen Renovation",
      entityType: "project",
      entityId: ID.projectRenovation,
    },
  });

  // Tasks — one of each kind plus a completed one.
  await db.task.upsert({
    where: { id: ID.taskRetryDesign },
    update: {},
    create: {
      id: ID.taskRetryDesign,
      title: "Draft ingestion retry design",
      projectId: ID.projectPipeline,
      deadlineDate: new Date("2026-09-08"),
      deadlineType: "soft",
      estimatedDurationMinutes: 90,
      remainingEstimateMinutes: 90,
      isSplittable: true,
      workType: "deep",
      energyLevel: "high",
      people: { create: [{ personId: ID.personPriya, role: "reviewer" }] },
    },
  });
  await db.task.upsert({
    where: { id: ID.taskTile },
    update: {},
    create: {
      id: ID.taskTile,
      title: "Order backsplash tile",
      projectId: ID.projectRenovation,
      estimatedDurationMinutes: 30,
      remainingEstimateMinutes: 30,
      workType: "errand",
    },
  });
  await db.task.upsert({
    where: { id: ID.taskCabinetQuote },
    update: {},
    create: {
      id: ID.taskCabinetQuote,
      title: "Cabinet quote from Marta",
      taskKind: "waiting_for",
      waitingForPersonId: ID.personMarta,
      nudgeDate: new Date("2026-09-04"),
      projectId: ID.projectRenovation,
      isSchedulable: false,
    },
  });
  await db.task.upsert({
    where: { id: ID.taskLibraryCard },
    update: {},
    create: {
      id: ID.taskLibraryCard,
      title: "Renew library card",
      taskKind: "reminder",
      remindAt: new Date("2026-09-15T16:00:00Z"),
      reminderTimezone: "America/New_York",
      isSchedulable: false,
    },
  });
  await db.task.upsert({
    where: { id: ID.taskVenue },
    update: {},
    create: {
      id: ID.taskVenue,
      title: "Book room for planning day",
      projectId: ID.projectPipeline,
      status: "completed",
      completedAt: new Date("2026-08-28T19:30:00Z"),
    },
  });

  // Events — timed fixed, timed flexible-free slotting comes in Phase 2;
  // no `block` kind rows exist in Phase 1.
  await db.event.upsert({
    where: { id: ID.eventPipelineSync },
    update: {},
    create: {
      id: ID.eventPipelineSync,
      title: "Pipeline sync",
      kind: "meeting",
      scheduleType: "fixed",
      startAt: new Date("2026-09-02T14:00:00Z"),
      endAt: new Date("2026-09-02T14:30:00Z"),
      timezone: "America/New_York",
      projectId: ID.projectPipeline,
      people: { create: [{ personId: ID.personPriya }] },
    },
  });
  await db.event.upsert({
    where: { id: ID.eventDentist },
    update: {},
    create: {
      id: ID.eventDentist,
      title: "Dentist",
      kind: "appointment",
      scheduleType: "fixed",
      startAt: new Date("2026-09-03T13:30:00Z"),
      endAt: new Date("2026-09-03T14:15:00Z"),
      timezone: "America/New_York",
    },
  });
  await db.event.upsert({
    where: { id: ID.eventTileDelivery },
    update: {},
    create: {
      id: ID.eventTileDelivery,
      title: "Tile delivery window",
      kind: "personal",
      scheduleType: "fixed",
      allDayStartDate: new Date("2026-09-05"),
      allDayEndDate: new Date("2026-09-06"),
      timezone: "America/New_York",
      projectId: ID.projectRenovation,
    },
  });

  // Notes.
  await db.note.upsert({
    where: { id: ID.noteBacksplash },
    update: {},
    create: {
      id: ID.noteBacksplash,
      title: "Backsplash options",
      body: "Two candidates: matte sage subway vs. glossy white herringbone. Sample both before ordering.",
      projectId: ID.projectRenovation,
    },
  });
  await db.note.upsert({
    where: { id: ID.noteRetryConstraints },
    update: {},
    create: {
      id: ID.noteRetryConstraints,
      title: "Retry design constraints",
      body: "Retries must be idempotent, capped with backoff, and observable per batch.",
      projectId: ID.projectPipeline,
    },
  });

  const counts = {
    projects: await db.project.count(),
    people: await db.person.count(),
    tasks: await db.task.count(),
    events: await db.event.count(),
    notes: await db.note.count(),
    glossary: await db.glossaryEntry.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

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
import { ID } from "./seed-ids";

loadLocalEnv();
const db = createPrismaClient();


async function main() {
  // Areas and projects (one area level, spec §6).
  await db.project.upsert({
    where: { id: ID.areaWork },
    update: { domain: "work" },
    create: { id: ID.areaWork, kind: "area", name: "Work", domain: "work" },
  });
  await db.project.upsert({
    where: { id: ID.areaPersonal },
    update: { domain: "personal" },
    create: { id: ID.areaPersonal, kind: "area", name: "Personal", domain: "personal" },
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
  // Phase 2: two more schedulable tasks so plan_day has something to place.
  await db.task.upsert({
    where: { id: ID.taskMonitoringNotes },
    update: {},
    create: {
      id: ID.taskMonitoringNotes,
      title: "Review ingestion monitoring notes",
      projectId: ID.projectPipeline,
      deadlineDate: new Date("2026-09-10"),
      deadlineType: "soft",
      estimatedDurationMinutes: 60,
      remainingEstimateMinutes: 60,
      workType: "study",
    },
  });
  await db.task.upsert({
    where: { id: ID.taskBudgetUpdate },
    update: {},
    create: {
      id: ID.taskBudgetUpdate,
      title: "Write renovation budget update",
      projectId: ID.projectRenovation,
      deadlineDate: new Date("2026-09-11"),
      deadlineType: "hard",
      estimatedDurationMinutes: 150,
      remainingEstimateMinutes: 150,
      isSplittable: true,
      workType: "deep",
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

  // Phase 2 scheduler constraints — only when the single user is provisioned
  // (UserSettings exists); wholly fictional evening/weekend availability.
  const settings = await db.userSettings.findFirst();
  if (settings) {
    await db.schedulerPreferences.upsert({
      where: { userSettingsId: settings.id },
      update: {},
      create: { userSettingsId: settings.id },
    });
    const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
    for (let weekday = 1; weekday <= 5; weekday++) {
      await db.availabilityWindow.upsert({
        where: { id: `${ID.availabilityWeekday}${weekday}` },
        update: {},
        create: { id: `${ID.availabilityWeekday}${weekday}`, userSettingsId: settings.id, weekday, startTime: time("17:30"), endTime: time("21:30"), kind: "general", label: "Evenings" },
      });
      await db.availabilityWindow.upsert({
        where: { id: `${ID.jobWeekday}${weekday}` },
        update: {},
        create: { id: `${ID.jobWeekday}${weekday}`, userSettingsId: settings.id, weekday, startTime: time("08:00"), endTime: time("16:00"), kind: "job", label: "Job hours" },
      });
    }
    await db.availabilityWindow.upsert({
      where: { id: ID.availabilitySaturday },
      update: {},
      create: { id: ID.availabilitySaturday, userSettingsId: settings.id, weekday: 6, startTime: time("09:00"), endTime: time("13:00"), kind: "general", label: "Saturday morning" },
    });
    await db.protectedWindow.upsert({
      where: { id: ID.protectedSunday },
      update: {},
      create: { id: ID.protectedSunday, userSettingsId: settings.id, recurrence: "weekly", weekday: 7, startTime: time("08:00"), endTime: time("20:00"), label: "Family day" },
    });
    await db.preferredWindow.upsert({
      where: { id: ID.preferredDeep },
      update: {},
      create: { id: ID.preferredDeep, userSettingsId: settings.id, weekday: null, startTime: time("18:00"), endTime: time("20:00"), workType: "deep", label: "Deep work early evening" },
    });
    await db.preferredWindow.upsert({
      where: { id: ID.preferredStudy },
      update: {},
      create: { id: ID.preferredStudy, userSettingsId: settings.id, weekday: null, startTime: time("20:00"), endTime: time("22:00"), workType: "study", label: "Study late evening" },
    });
  } else {
    console.log("No UserSettings row yet: scheduler constraints not seeded (run `npm run provision` first).");
  }

  const counts = {
    projects: await db.project.count(),
    people: await db.person.count(),
    tasks: await db.task.count(),
    events: await db.event.count(),
    notes: await db.note.count(),
    glossary: await db.glossaryEntry.count(),
    availabilityWindows: await db.availabilityWindow.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

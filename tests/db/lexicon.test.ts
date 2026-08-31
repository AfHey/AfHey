/**
 * Lexicon loading: which records may enter provider-bound resolution
 * context, and which never can (archived, ai_excluded).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLexicon } from "@/core/resolution/lexicon";
import type { PrismaClient } from "@/db/generated/client";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;

beforeAll(async () => {
  db = await resetTestDatabase();
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

describe("loadLexicon", () => {
  it("builds tiers from people, aliases, projects, and linked glossary terms", async () => {
    const person = await db.person.create({
      data: {
        name: "Lex Person",
        aliases: { create: [{ alias: "LP", normalizedAlias: "lp" }] },
      },
    });
    const area = await db.project.create({ data: { kind: "area", name: "Lex Area" } });
    const project = await db.project.create({
      data: { kind: "project", name: "Lexicon Project", parentId: area.id },
    });
    await db.glossaryEntry.create({
      data: {
        term: "LXP",
        normalizedTerm: "lxp",
        expandsTo: "Lexicon Project",
        entityType: "project",
        entityId: project.id,
      },
    });

    const lexicon = await loadLexicon(db);
    const find = (tier: string, entityId: string) =>
      lexicon.find((e) => e.tier === tier && e.entityId === entityId);

    expect(find("person_name", person.id)?.phrase).toBe("Lex Person");
    expect(find("person_first_name", person.id)?.phrase).toBe("Lex");
    expect(find("alias", person.id)?.phrase).toBe("LP");
    expect(find("project_name", project.id)?.phrase).toBe("Lexicon Project");
    expect(find("glossary", project.id)?.phrase).toBe("LXP");
    // Areas are not resolution targets.
    expect(lexicon.some((e) => e.entityId === area.id)).toBe(false);
  });

  it("keeps archived and ai_excluded records out of provider context", async () => {
    const excluded = await db.person.create({
      data: { name: "Excluded Person", aiExcluded: true },
    });
    const archived = await db.person.create({
      data: { name: "Archived Person", archivedAt: new Date() },
    });
    const archivedProject = await db.project.create({
      data: { kind: "project", name: "Archived Project", archivedAt: new Date() },
    });

    const lexicon = await loadLexicon(db);
    const ids = new Set(lexicon.map((e) => e.entityId));
    expect(ids.has(excluded.id)).toBe(false);
    expect(ids.has(archived.id)).toBe(false);
    expect(ids.has(archivedProject.id)).toBe(false);
  });

  it("skips short first names and keeps only the best tier per phrase/entity", async () => {
    const person = await db.person.create({
      data: {
        name: "Al Verne",
        // Alias identical to the derived first name of another entry style.
        aliases: { create: [{ alias: "Verne", normalizedAlias: "verne" }] },
      },
    });
    const lexicon = await loadLexicon(db);
    const forPerson = lexicon.filter((e) => e.entityId === person.id);
    // "Al" is too short for the first-name tier.
    expect(forPerson.some((e) => e.tier === "person_first_name")).toBe(false);
    expect(forPerson.some((e) => e.tier === "person_name")).toBe(true);
  });
});

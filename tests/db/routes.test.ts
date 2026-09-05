/**
 * Step 6 route-level suite: auth requirement, validation mapping (400 Zod /
 * 422 invariant / 409 duplicate), and the CRUD + complete + archive flows
 * through the real route handlers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionUser } from "@/core/auth/provision";
import { createSession } from "@/core/auth/sessions";
import type { PrismaClient, User } from "@/db/generated/client";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let db: PrismaClient;
let user: User;
let cookie: string;

type Route = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const routes: Record<string, Route> = {};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function req(method: string, body?: unknown, withAuth = true) {
  return new Request("http://localhost/api/x", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(withAuth ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  db = await resetTestDatabase();
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as { __afheyPrisma?: unknown }).__afheyPrisma;

  routes.taskCreate = (await import("@/app/api/tasks/route")).POST as Route;
  const taskId = await import("@/app/api/tasks/[id]/route");
  routes.taskPatch = taskId.PATCH as Route;
  routes.taskDelete = taskId.DELETE as Route;
  routes.taskComplete = (await import("@/app/api/tasks/[id]/complete/route")).POST as Route;
  routes.eventCreate = (await import("@/app/api/events/route")).POST as Route;
  routes.projectCreate = (await import("@/app/api/projects/route")).POST as Route;
  routes.personCreate = (await import("@/app/api/people/route")).POST as Route;
  routes.aliasAdd = (await import("@/app/api/people/[id]/aliases/route")).POST as Route;
  routes.glossaryCreate = (await import("@/app/api/glossary/route")).POST as Route;
  routes.settingsPatch = (await import("@/app/api/settings/route")).PATCH as Route;

  user = await provisionUser(db, "routes-password-1");
  const issued = await createSession(db, user);
  cookie = `afhey_session=${issued.token}`;
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

describe("authentication requirement", () => {
  it("rejects mutations without a session", async () => {
    const res = await routes.taskCreate(req("POST", { title: "nope" }, false), ctx(""));
    expect(res.status).toBe(401);
  });
});

describe("task routes", () => {
  it("creates, completes, uncompletes, and archives a task", async () => {
    const created = await routes.taskCreate(
      req("POST", { title: "Route task", deadlineDate: "2026-09-12", deadlineType: "soft" }),
      ctx(""),
    );
    expect(created.status).toBe(201);
    const task = (await created.json()) as { id: string; revision: number };

    const done = await routes.taskComplete(req("POST", { completed: true }), ctx(task.id));
    expect(done.status).toBe(200);
    expect(((await done.json()) as { status: string }).status).toBe("completed");

    const reopened = await routes.taskComplete(req("POST", { completed: false }), ctx(task.id));
    expect(((await reopened.json()) as { status: string }).status).toBe("open");

    const archived = await routes.taskDelete(req("DELETE"), ctx(task.id));
    expect(archived.status).toBe(200);
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.archivedAt).not.toBeNull();
  });

  it("maps schema violations to 400 and merged-invariant violations to 422", async () => {
    const bad = await routes.taskCreate(
      req("POST", { title: "waiting", taskKind: "waiting_for" }),
      ctx(""),
    );
    expect(bad.status).toBe(400);

    const created = await routes.taskCreate(
      req("POST", { title: "date task", deadlineDate: "2026-09-12", deadlineType: "hard" }),
      ctx(""),
    );
    const task = (await created.json()) as { id: string };
    const conflict = await routes.taskPatch(
      req("PATCH", { deadlineAt: "2026-09-12T15:00:00Z", deadlineTimezone: "America/New_York" }),
      ctx(task.id),
    );
    expect(conflict.status).toBe(422);
  });

  it("404s on an unknown task", async () => {
    const res = await routes.taskPatch(
      req("PATCH", { title: "ghost" }),
      ctx("e9999999-0000-4000-8000-00000000dead"),
    );
    expect(res.status).toBe(404);
  });
});

describe("project and event routes", () => {
  it("enforces the hierarchy through the API", async () => {
    const areaRes = await routes.projectCreate(req("POST", { kind: "area", name: "Route Area" }), ctx(""));
    expect(areaRes.status).toBe(201);
    const area = (await areaRes.json()) as { id: string };

    const projRes = await routes.projectCreate(
      req("POST", { kind: "project", name: "Route Project", parentId: area.id }),
      ctx(""),
    );
    expect(projRes.status).toBe(201);
    const project = (await projRes.json()) as { id: string };

    const nested = await routes.projectCreate(
      req("POST", { kind: "project", name: "Nested", parentId: project.id }),
      ctx(""),
    );
    expect(nested.status).toBe(422);

    const taskOnArea = await routes.taskCreate(
      req("POST", { title: "misfiled", projectId: area.id }),
      ctx(""),
    );
    expect(taskOnArea.status).toBe(422);
  });

  it("rejects a locked fixed event at the schema layer", async () => {
    const res = await routes.eventCreate(
      req("POST", {
        title: "Locked fixed",
        kind: "meeting",
        scheduleType: "fixed",
        isLocked: true,
        startAt: "2026-09-12T14:00:00Z",
        endAt: "2026-09-12T15:00:00Z",
        timezone: "America/New_York",
      }),
      ctx(""),
    );
    expect(res.status).toBe(400);
  });

  it("creates a valid timed event", async () => {
    const res = await routes.eventCreate(
      req("POST", {
        title: "Route sync",
        kind: "meeting",
        scheduleType: "fixed",
        startAt: "2026-09-12T14:00:00Z",
        endAt: "2026-09-12T14:30:00Z",
        timezone: "America/New_York",
      }),
      ctx(""),
    );
    expect(res.status).toBe(201);
  });
});

describe("people, glossary, settings routes", () => {
  it("creates a person with aliases and 409s on a duplicate alias", async () => {
    const res = await routes.personCreate(
      req("POST", { name: "Route Person", aliases: ["RP"] }),
      ctx(""),
    );
    expect(res.status).toBe(201);
    const person = (await res.json()) as { id: string };
    const dup = await routes.aliasAdd(req("POST", { alias: " rp " }), ctx(person.id));
    expect(dup.status).toBe(409);
  });

  it("creates a glossary term and validates the entity pair", async () => {
    const ok = await routes.glossaryCreate(
      req("POST", { term: "RT", expandsTo: "Route Term", entityType: null, entityId: null }),
      ctx(""),
    );
    expect(ok.status).toBe(201);
    const bad = await routes.glossaryCreate(
      req("POST", { term: "RT2", expandsTo: "x", entityType: "project", entityId: null }),
      ctx(""),
    );
    expect(bad.status).toBe(400);
  });

  it("rejects glossary targets that do not exist or live in another table (finding 18)", async () => {
    const area = await db.project.create({ data: { kind: "area", name: "Glossary Target Area" } });
    const body = (term: string, entityType: string, entityId: string) => ({
      term,
      expandsTo: "Glossary target",
      entityType,
      entityId,
    });
    const missing = await routes.glossaryCreate(
      req("POST", body("GT1", "project", "00000000-0000-4000-8000-000000000123")),
      ctx(""),
    );
    expect(missing.status).toBe(422);
    const mismatch = await routes.glossaryCreate(req("POST", body("GT2", "person", area.id)), ctx(""));
    expect(mismatch.status).toBe(422);
    const ok = await routes.glossaryCreate(req("POST", body("GT3", "project", area.id)), ctx(""));
    expect(ok.status).toBe(201);
    expect(await db.glossaryEntry.count({ where: { entityId: area.id } })).toBe(1);
  });

  it("updates the timezone and rejects invalid zones", async () => {
    const ok = await routes.settingsPatch(
      req("PATCH", { currentTimezone: "Europe/Berlin" }),
      ctx(""),
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { currentTimezone: string }).currentTimezone).toBe("Europe/Berlin");
    const bad = await routes.settingsPatch(req("PATCH", { currentTimezone: "Mars/Olympus" }), ctx(""));
    expect(bad.status).toBe(400);
  });
});

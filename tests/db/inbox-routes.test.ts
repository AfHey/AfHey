/**
 * Step 12 Inbox route suite: capture submission (preview / no-AI), extraction
 * through the fake provider, accept-all apply with TaskPerson + capture_id,
 * reject-all resolving the capture, review edits superseding, batch undo,
 * and the AI-endpoint rate limit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionUser } from "@/core/auth/provision";
import { resetRateLimits } from "@/core/auth/rate-limit";
import { createSession } from "@/core/auth/sessions";
import type { PrismaClient } from "@/db/generated/client";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let db: PrismaClient;
let cookie: string;
type Route = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const routes: Record<string, Route> = {};
const ctx = (id = "") => ({ params: Promise.resolve({ id }) });

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

beforeAll(async () => {
  db = await resetTestDatabase();
  process.env.DATABASE_URL = testDatabaseUrl();
  delete process.env.EXTRACTION_PROVIDER;
  delete (globalThis as { __afheyPrisma?: unknown }).__afheyPrisma;
  routes.captureCreate = (await import("@/app/api/captures/route")).POST as Route;
  routes.extract = (await import("@/app/api/captures/[id]/extract/route")).POST as Route;
  routes.captureReject = (await import("@/app/api/captures/[id]/reject/route")).POST as Route;
  routes.approve = (await import("@/app/api/proposals/[id]/approve/route")).POST as Route;
  routes.reject = (await import("@/app/api/proposals/[id]/reject/route")).POST as Route;
  routes.operations = (await import("@/app/api/proposals/[id]/operations/route")).PUT as Route;
  routes.undo = (await import("@/app/api/actions/[id]/undo/route")).POST as Route;

  const user = await provisionUser(db, "inbox-password-1");
  cookie = `afhey_session=${(await createSession(db, user)).token}`;
  await db.person.create({
    data: { name: "Priya Raman", aliases: { create: [{ alias: "Priya", normalizedAlias: "priya" }] } },
  });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

beforeEach(() => resetRateLimits());

async function captureAndExtract(text: string) {
  const created = await json<{ mode: string; capture: { id: string }; preview: { payloadText: string } }>(
    await routes.captureCreate(req("POST", { text, sourceType: "pasted" }), ctx()),
  );
  expect(created.mode).toBe("preview");
  const extracted = await json<{ status: string; proposal: { id: string; operations: Array<{ operationId: string; entityId: string; entityType: string; after: Record<string, unknown> }> } }>(
    await routes.extract(req("POST", {}), ctx(created.capture.id)),
  );
  expect(extracted.status).toBe("proposed");
  return { captureId: created.capture.id, preview: created.preview, proposal: extracted.proposal };
}

describe("capture submission", () => {
  it("returns a redaction preview with placeholders and masked identifiers", async () => {
    const res = await routes.captureCreate(
      req("POST", { text: "email Priya at 555-123-4567 about the tile order", sourceType: "typed" }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const body = await json<{ mode: string; preview: { payloadText: string; mentions: Array<{ candidates: Array<{ name: string }> }> } }>(res);
    expect(body.mode).toBe("preview");
    expect(body.preview.payloadText).toBe("email [PERSON_1] at [REDACTED_PHONE_1] about the tile order");
    expect(body.preview.mentions[0].candidates[0].name).toBe("Priya Raman");
  });

  it("no-AI keeps a private note and never proposes", async () => {
    const body = await json<{ mode: string; note: { id: string; aiExcluded: boolean } }>(
      await routes.captureCreate(req("POST", { text: "private thought", noAi: true }), ctx()),
    );
    expect(body.mode).toBe("no_ai");
    expect(body.note.aiExcluded).toBe(true);
    expect(await db.proposal.count({ where: { captureId: (await db.note.findUniqueOrThrow({ where: { id: body.note.id } })).captureId! } })).toBe(0);
  });
});

describe("review flow", () => {
  it("accept-all applies items with capture and people links, and resolves the capture", async () => {
    const { captureId, proposal } = await captureAndExtract("email Priya about the grout tomorrow\nnote: keep the receipts");
    const outcome = await json<{ outcome: string }>(await routes.approve(req("POST"), ctx(proposal.id)));
    expect(outcome.outcome).toBe("applied");

    const taskOp = proposal.operations.find((o) => o.entityType === "task")!;
    const task = await db.task.findUniqueOrThrow({ where: { id: taskOp.entityId }, include: { people: true } });
    expect(task.captureId).toBe(captureId);
    expect(task.people).toHaveLength(1);
    expect(task.deadlineDate).not.toBeNull();
    const capture = await db.capture.findUniqueOrThrow({ where: { id: captureId } });
    expect(capture.processingStatus).toBe("processed");
  });

  it("reject-all rejects the proposal and marks the capture rejected", async () => {
    const { captureId, proposal } = await captureAndExtract("throwaway idea");
    const res = await routes.reject(req("POST", { rejectCapture: true }), ctx(proposal.id));
    expect(res.status).toBe(200);
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("rejected");
    const capture = await db.capture.findUniqueOrThrow({ where: { id: captureId } });
    expect(capture.processingStatus).toBe("rejected");
    expect(capture.rawDeleteAfter).not.toBeNull();
  });

  it("editing supersedes with a new validated proposal that keeps evidence", async () => {
    const { proposal } = await captureAndExtract("call the tile shop\nbook the plumber");
    const [first, second] = proposal.operations;
    const res = await routes.operations(
      req("PUT", {
        operations: [
          { sourceOperationId: first.operationId, entityType: "note", after: { body: "call the tile shop", captureId: first.after.captureId }, dependsOn: [] },
          // Title unchanged, bucket changed: title evidence must carry over,
          // and nothing else about the item is source-supported anymore.
          { sourceOperationId: second.operationId, entityType: "task", after: { ...second.after, bucket: "backlog" }, dependsOn: [] },
        ],
      }),
      ctx(proposal.id),
    );
    expect(res.status).toBe(200);
    const next = await json<{ id: string; supersedesProposalId: string; operations: Array<{ entityType: string; after: { title?: string; bucket?: string } }> }>(res);
    expect(next.supersedesProposalId).toBe(proposal.id);
    expect(next.operations.map((o) => o.entityType)).toEqual(["note", "task"]);
    expect(next.operations[1].after.bucket).toBe("backlog");
    expect(next.operations[1].after.title).toBe("book the plumber");
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("superseded");
    const carried = await db.fieldEvidence.count({ where: { proposalOperationId: (await db.proposalOperation.findFirstOrThrow({ where: { proposalId: next.id, sequence: 1 } })).operationId } });
    expect(carried).toBeGreaterThan(0);

    const invalid = await routes.operations(
      req("PUT", { operations: [{ entityType: "task", after: { title: "x", taskKind: "waiting_for" }, dependsOn: [] }] }),
      ctx(next.id),
    );
    expect(invalid.status).toBe(422);
  });

  it("undo builds a reviewable proposal that removes the applied batch", async () => {
    const { proposal } = await captureAndExtract("water the plants tomorrow");
    await routes.approve(req("POST"), ctx(proposal.id));
    const action = await db.actionLog.findUniqueOrThrow({ where: { proposalId: proposal.id } });
    const undo = await json<{ id: string; status: string }>(await routes.undo(req("POST"), ctx(action.id)));
    expect(undo.status).toBe("pending");
    const applied = await json<{ outcome: string }>(await routes.approve(req("POST"), ctx(undo.id)));
    expect(applied.outcome).toBe("applied");
    expect(await db.task.findUnique({ where: { id: proposal.operations[0].entityId } })).toBeNull();
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("reverted");
  });

  it("discarding an un-interpreted capture rejects it", async () => {
    const created = await json<{ capture: { id: string } }>(
      await routes.captureCreate(req("POST", { text: "never mind this" }), ctx()),
    );
    await routes.captureReject(req("POST"), ctx(created.capture.id));
    expect((await db.capture.findUniqueOrThrow({ where: { id: created.capture.id } })).processingStatus).toBe("rejected");
  });

  it("rate-limits the extraction endpoint", async () => {
    const created = await json<{ capture: { id: string } }>(
      await routes.captureCreate(req("POST", { text: "limit me" }), ctx()),
    );
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await routes.extract(req("POST", {}), ctx(created.capture.id))).status;
    }
    expect(last).toBe(429);
  });
});

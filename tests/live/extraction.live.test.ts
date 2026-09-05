/**
 * Live-provider regression for finding A (2026-09-05): the pinned model must
 * carry every temporal cue as a temporal expression so multi-item captures
 * end up with due dates. Runs only via `npm run test:live` with a real key;
 * uses the deterministic pipeline end to end on the test database.
 */
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAIExtractionProvider } from "@/ai/adapters/openai-extraction";
import { processCaptureWithExtraction } from "@/core/captures/extract";
import { createCapture } from "@/core/captures/service";
import type { PrismaClient } from "@/db/generated/client";
import { loadLocalEnv } from "@/lib/env";
import { resetTestDatabase } from "../helpers/test-db";

loadLocalEnv();
const apiKey = process.env.OPENAI_API_KEY;
let db: PrismaClient;

beforeAll(async () => {
  db = await resetTestDatabase();
  await db.userSettings.create({ data: { user: { create: {} }, currentTimezone: "America/New_York" } });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

describe.skipIf(!apiKey)("live extraction (pinned model)", () => {
  it("a leading 'Tomorrow' and a trailing 'by Friday' both become deadlines", async () => {
    const provider = new OpenAIExtractionProvider({ apiKey: apiKey! });
    const now = DateTime.fromISO("2026-09-01T09:00:00", { zone: "America/New_York" });
    const capture = await createCapture(db, {
      text: "Tomorrow call the plumber, order printer ink, and finish the slide deck by Friday",
      sourceType: "typed",
    });
    const outcome = await processCaptureWithExtraction(db, capture.id, provider, { now });
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;

    const tasks = outcome.proposal!.operations.filter((o) => o.entityType === "task");
    expect(tasks).toHaveLength(3);
    const payloads = tasks.map((o) => o.after as Record<string, unknown>);
    const deadlines = payloads.map((p) => p.deadlineDate).sort();
    expect(deadlines).toEqual(["2026-09-02", "2026-09-02", "2026-09-04"]);
    for (const p of payloads) {
      expect(String(p.context ?? "")).not.toMatch(/tomorrow|friday/i);
      expect(p.workType === null || p.workType === undefined || typeof p.workType === "string").toBe(true);
      expect(String(p.title)).not.toMatch(/^tomorrow/i);
    }
  });
});

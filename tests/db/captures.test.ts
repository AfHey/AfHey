/**
 * Step 7 capture-service suite: creation, the no-AI path, and the rejected
 * terminal state with its 30-day retention clock.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCapture, processCaptureNoAi, rejectCapture } from "@/core/captures/service";
import type { PrismaClient } from "@/db/generated/client";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;

beforeAll(async () => {
  db = await resetTestDatabase();
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe("capture lifecycle", () => {
  it("creates a capture in received state before interpretation", async () => {
    const capture = await createCapture(db, { text: "buy stamps", sourceType: "typed" });
    expect(capture.processingStatus).toBe("received");
    expect(capture.rawText).toBe("buy stamps");
    expect(capture.rawDeleteAfter).toBeNull();
    await expect(createCapture(db, { text: "   ", sourceType: "typed" })).rejects.toThrow(
      /non-empty/,
    );
  });

  it("no-AI processing stores an excluded note and starts retention", async () => {
    const capture = await createCapture(db, {
      text: "private thought, keep the model out of this",
      sourceType: "pasted",
    });
    const { capture: updated, note } = await processCaptureNoAi(db, capture.id);
    expect(updated.processingStatus).toBe("no_ai");
    expect(updated.aiExcluded).toBe(true);
    expect(note.aiExcluded).toBe(true);
    expect(note.captureId).toBe(capture.id);
    expect(note.body).toBe("private thought, keep the model out of this");
    const daysOut = (updated.rawDeleteAfter!.getTime() - Date.now()) / DAY_MS;
    expect(daysOut).toBeGreaterThan(29.9);
    expect(daysOut).toBeLessThan(30.1);

    await expect(processCaptureNoAi(db, capture.id)).rejects.toThrow(/not awaiting/);
  });

  it("rejection is terminal and starts the same retention clock", async () => {
    const capture = await createCapture(db, { text: "never mind", sourceType: "typed" });
    const rejected = await rejectCapture(db, capture.id);
    expect(rejected.processingStatus).toBe("rejected");
    const daysOut = (rejected.rawDeleteAfter!.getTime() - Date.now()) / DAY_MS;
    expect(daysOut).toBeGreaterThan(29.9);
    expect(daysOut).toBeLessThan(30.1);

    await expect(rejectCapture(db, capture.id)).rejects.toThrow(/already resolved/);
  });
});

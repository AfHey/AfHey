/**
 * Retention scrub migration (finding 8; verification item 8): legacy rows
 * shaped like pre-fix data — source phrases copied into
 * FieldEvidence.resolver_meta, warning segments appended to
 * ProposalOperation.reason, and ActionLog snapshots carrying those reasons —
 * are seeded, the committed migration SQL is replayed, and the copies must
 * be gone while everything else stays.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/db/generated/client";
import { newUuid } from "@/lib/ids";
import { resetTestDatabase } from "../helpers/test-db";

let db: PrismaClient;
const MIGRATION = join(process.cwd(), "prisma", "migrations", "20260905030636_retention_scrub", "migration.sql");

beforeAll(async () => {
  db = await resetTestDatabase();
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

function migrationStatements(): string[] {
  return readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe("retention scrub migration", () => {
  it("removes legacy source-phrase copies from metadata, reasons, and action snapshots, keeping the rest", async () => {
    const sentinel = "zqxlegacy";
    const legacyReason = `task without a date · the phrase '${sentinel}' could not be resolved`;
    const capture = await db.capture.create({
      data: { rawText: "legacy capture", redactedText: "legacy capture", sourceType: "typed", processingStatus: "processed" },
    });
    const entityId = newUuid();
    const proposal = await db.proposal.create({
      data: {
        origin: "inbox",
        idempotencyKey: "legacy-scrub-1",
        status: "applied",
        captureId: capture.id,
        operations: {
          create: [
            {
              sequence: 0,
              op: "create",
              entityType: "task",
              entityId,
              reason: legacyReason,
              fieldEvidence: {
                create: [
                  {
                    fieldPath: "deadline",
                    startOffset: 0,
                    endOffset: sentinel.length,
                    literalText: sentinel,
                    confidence: "medium",
                    resolverMeta: {
                      relation: "on",
                      literal: sentinel,
                      unresolvedLiteral: sentinel,
                      resolution: { kind: "unresolved" },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      include: { operations: true },
    });
    const operation = proposal.operations[0];
    const action = await db.actionLog.create({
      data: {
        id: newUuid(),
        proposalId: proposal.id,
        origin: "inbox",
        appliedAt: new Date(),
        idempotencyKey: "legacy-scrub-1",
        operations: [
          {
            operationId: operation.operationId,
            sequence: 0,
            op: "create",
            entityType: "task",
            entityId,
            before: null,
            after: { title: "renew the permit" },
            preRevision: null,
            postRevision: 1,
            reason: legacyReason,
          },
        ],
      },
    });
    // A row that never carried copies must come through untouched.
    const clean = await db.fieldEvidence.create({
      data: {
        proposalOperationId: operation.operationId,
        fieldPath: "title",
        startOffset: 0,
        endOffset: 5,
        literalText: "renew",
        confidence: "high",
        resolverMeta: { relation: "on", resolution: { kind: "date", date: "2026-09-02", confidence: "high" } },
      },
    });

    const statements = migrationStatements();
    expect(statements).toHaveLength(3);
    for (const statement of statements) await db.$executeRawUnsafe(statement);

    const evidence = await db.fieldEvidence.findFirstOrThrow({ where: { proposalOperationId: operation.operationId, fieldPath: "deadline" } });
    expect(evidence.resolverMeta).toEqual({ relation: "on", resolution: { kind: "unresolved" } });
    expect(evidence.literalText).toBe(sentinel); // the expiry job, not the migration, clears literals
    expect((await db.proposalOperation.findUniqueOrThrow({ where: { operationId: operation.operationId } })).reason).toBe("task without a date");
    const snapshot = (await db.actionLog.findUniqueOrThrow({ where: { id: action.id } })).operations as Array<{ reason: string; after: unknown }>;
    expect(snapshot[0].reason).toBe("task without a date");
    expect(snapshot[0].after).toEqual({ title: "renew the permit" });
    expect((await db.fieldEvidence.findUniqueOrThrow({ where: { id: clean.id } })).resolverMeta).toEqual({
      relation: "on",
      resolution: { kind: "date", date: "2026-09-02", confidence: "high" },
    });

    const [hits] = await db.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT (
         (SELECT count(*) FROM field_evidence WHERE resolver_meta::text ILIKE $1)
       + (SELECT count(*) FROM proposal_operation WHERE reason ILIKE $1)
       + (SELECT count(*) FROM action_log WHERE operations::text ILIKE $1)
       )::int AS total`,
      `%${sentinel}%`,
    );
    expect(hits.total).toBe(0);
  });
});

import { execSync } from "node:child_process";
import { createPrismaClient } from "@/db/client";
import type { PrismaClient } from "@/db/generated/client";
import { loadLocalEnv, requiredEnv } from "@/lib/env";

/**
 * Returns TEST_DATABASE_URL, refusing anything that is not a *_test database.
 * The test database is disposable by contract (see README "Database setup");
 * this guard is the hard stop that keeps suites away from real data.
 */
export function testDatabaseUrl(): string {
  loadLocalEnv();
  const url = requiredEnv("TEST_DATABASE_URL");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `TEST_DATABASE_URL must point at a *_test database, got "${dbName}"`,
    );
  }
  return url;
}

/**
 * Rebuilds the test database from the committed migrations: drops the public
 * schema, then replays every migration with `prisma migrate deploy`. This is
 * the suite's migration-from-scratch check as well as its isolation reset.
 * Returns a connected client for the rebuilt database.
 */
export async function resetTestDatabase(): Promise<PrismaClient> {
  const url = testDatabaseUrl();
  const admin = createPrismaClient(url);
  try {
    await admin.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await admin.$executeRawUnsafe("CREATE SCHEMA public");
  } finally {
    await admin.$disconnect();
  }
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  return createPrismaClient(url);
}

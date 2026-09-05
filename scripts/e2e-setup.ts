/**
 * Prepares afhey_test for an end-to-end run (finding C, 2026-09-05): rebuild
 * the schema from the committed migrations, provision the single user with
 * AFHEY_E2E_PASSWORD, and load the fictional seed. Invoked by Playwright's
 * global setup through tsx so the Prisma client (ESM) never has to load
 * inside Playwright's CommonJS transpile.
 */
import { execSync } from "node:child_process";
import { provisionUser } from "../src/core/auth/provision";
import { loadLocalEnv } from "../src/lib/env";
import { resetTestDatabase, testDatabaseUrl } from "../tests/helpers/test-db";

loadLocalEnv();

async function main() {
  const url = testDatabaseUrl();
  const password = process.env.AFHEY_E2E_PASSWORD;
  if (!password) throw new Error("AFHEY_E2E_PASSWORD is not set; see README");
  const db = await resetTestDatabase();
  try {
    await provisionUser(db, password);
  } finally {
    await db.$disconnect();
  }
  execSync("npx prisma db seed", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  console.log("e2e database ready:", new URL(url).pathname.slice(1));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Provisions (or re-provisions) the single AfHey user. Usage:
 *   AFHEY_PASSWORD='...' npm run provision
 * Re-running with a new AFHEY_PASSWORD replaces the password credential —
 * this is also the password-reset path. The password is never logged.
 */
import { provisionUser } from "../src/core/auth/provision";
import { createPrismaClient } from "../src/db/client";
import { loadLocalEnv } from "../src/lib/env";

loadLocalEnv();

const password = process.env.AFHEY_PASSWORD;
if (!password) {
  console.error("Set AFHEY_PASSWORD in the environment (not in .env) and re-run.");
  process.exit(1);
}

const db = createPrismaClient();
provisionUser(db, password)
  .then((user) => {
    console.log(`Provisioned user ${user.id} with a password credential.`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

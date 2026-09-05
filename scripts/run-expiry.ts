/**
 * Runs the capture-text retention job once. Schedule daily (see README
 * "Maintenance jobs") or run by hand:
 *   npm run jobs:expire
 */
import { createPrismaClient } from "../src/db/client";
import { runCaptureExpiry } from "../src/jobs/expire-capture-text";
import { loadLocalEnv } from "../src/lib/env";

loadLocalEnv();
const db = createPrismaClient();
runCaptureExpiry(db)
  .then((summary) => {
    console.log("Expiry run complete:", summary);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

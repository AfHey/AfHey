/**
 * Runs the maintenance jobs once: capture-text retention and interrupted
 * apply recovery (finding 3). Schedule daily (see README "Maintenance jobs")
 * or run by hand:
 *   npm run jobs:expire
 */
import { recoverApplyingProposals } from "../src/core/proposals/lifecycle";
import { createPrismaClient } from "../src/db/client";
import { runCaptureExpiry } from "../src/jobs/expire-capture-text";
import { loadLocalEnv } from "../src/lib/env";

loadLocalEnv();
const db = createPrismaClient();
Promise.all([runCaptureExpiry(db), recoverApplyingProposals(db)])
  .then(([summary, recovered]) => {
    console.log("Expiry run complete:", summary);
    console.log("Recovery run complete:", recovered.length === 0 ? "nothing to recover" : recovered);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

/**
 * Runs the maintenance job once: capture-text retention, interrupted-apply
 * recovery, missed-block transitions, and the priority recompute. Idempotent;
 * schedule it daily (see README "Maintenance job") or run by hand:
 *   npm run jobs:maintenance
 */
import { createPrismaClient } from "../src/db/client";
import { runMaintenance } from "../src/jobs/maintenance";
import { loadLocalEnv } from "../src/lib/env";

loadLocalEnv();
const db = createPrismaClient();
runMaintenance(db)
  .then((summary) => {
    console.log("Maintenance run complete:", JSON.stringify(summary, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

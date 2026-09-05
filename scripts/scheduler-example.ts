/**
 * Worked example for the Phase 2 scheduler: rebuilds the disposable test
 * database, provisions the single user, loads the fictional seed, and runs
 * `plan_day` for a given date, printing the resulting Proposal in the
 * user's zone. Never touches afhey_dev.
 *   npx tsx scripts/scheduler-example.ts [YYYY-MM-DD] [now ISO local]
 */
import { execSync } from "node:child_process";
import { DateTime } from "luxon";
import { provisionUser } from "../src/core/auth/provision";
import { planDay } from "../src/core/scheduler/operations";
import { loadLocalEnv } from "../src/lib/env";
import { resetTestDatabase, testDatabaseUrl } from "../tests/helpers/test-db";

loadLocalEnv();
const ZONE = "America/New_York";
const date = process.argv[2] ?? "2026-09-07";
const nowIso = process.argv[3] ?? "2026-09-05T18:00:00";

async function main() {
  const url = testDatabaseUrl();
  const db = await resetTestDatabase();
  try {
    await provisionUser(db, "example-password-1");
    execSync("npx prisma db seed", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    const now = DateTime.fromISO(nowIso, { zone: ZONE });
    const run = await planDay(db, date, { now, idempotencyKey: `example:plan_day:${date}` });
    const fmt = (value: unknown) =>
      (value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(String(value))).setZone(ZONE).toFormat("ccc d LLL HH:mm");
    const tasks = new Map((await db.task.findMany()).map((t) => [t.id, t]));

    console.log(`plan_day(${date}) with now = ${now.toFormat("ccc d LLL HH:mm ZZZZ")}`);
    console.log(`Proposal: ${run.proposal ? `${run.proposal.id} (${run.proposal.origin}, ${run.proposal.status}, expires ${fmt(run.proposal.expiresAt)})` : "none"}`);
    console.log("");
    console.log("| # | op | task | when | reason |");
    console.log("|---|---|---|---|---|");
    for (const op of run.proposal?.operations ?? []) {
      const a = op.after as Record<string, unknown>;
      const task = tasks.get(String(a.taskId ?? ""));
      const when = a.startAt ? `${fmt(a.startAt)} – ${DateTime.fromISO(String(a.endAt)).setZone(ZONE).toFormat("HH:mm")}` : a.blockState ? `→ ${a.blockState}` : "";
      console.log(`| ${op.sequence} | ${op.op} | ${task?.title ?? op.entityId} | ${when} | ${op.reason ?? ""} |`);
    }
    console.log("");
    console.log("Summary:", JSON.stringify({ created: run.summary.created, moved: run.summary.moved, cancelled: run.summary.cancelled }));
    for (const u of run.summary.unplaced) console.log(`- unplaced: ${u.title} — ${u.minutes} min — ${u.reason}`);
    for (const e of run.summary.estimateRequired) console.log(`- estimate required: ${e.title}`);
    for (const f of run.summary.feasibility) console.log(`- feasibility: ${f.title} — ${f.status}${f.status === "at_risk" ? ` (short ${f.shortfallMinutes} min)` : ""}${f.capacityMinutes !== null ? ` — ${f.capacityMinutes} eligible min before the deadline` : ""}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Playwright global setup (finding C, 2026-09-05): rebuilds afhey_test with
 * the provisioned user and fictional seed before every run. The work runs in
 * a tsx child process because the generated Prisma client is ESM-only. The
 * dev server Playwright boots is bound to the same database (see
 * playwright.config.ts), so e2e never touches afhey_dev.
 */
import { execSync } from "node:child_process";

export default function globalSetup(): void {
  execSync("npx tsx scripts/e2e-setup.ts", { stdio: "inherit", env: process.env });
}

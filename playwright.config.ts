import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";
import { requireTestDatabaseUrl } from "./e2e/require-test-database";

try {
  loadEnvFile();
} catch {
  // No .env — rely on the process environment.
}

// Dedicated port so E2E runs never collide with a manually started dev server.
const PORT = 3799;

// Refused at configuration load, before global setup or the server starts
// (finding C; verification item 25). Covered by tests/config/e2e-database-guard.test.ts.
const testDatabaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    // Never reuse a server that might be bound to the dev database.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // The e2e server runs exclusively against the test database with the
      // deterministic provider (finding C).
      DATABASE_URL: testDatabaseUrl,
      EXTRACTION_PROVIDER: "fake",
      // e2e/lan-login.spec.ts reaches the server as http://lan.test to prove
      // plain-HTTP login from a non-localhost host works in development.
      AFHEY_DEV_ORIGINS: "lan.test",
      // Own build directory: `next dev` refuses to start while another dev
      // server holds the lock in .next/dev, and the suite must not stop it.
      AFHEY_DIST_DIR: ".next-e2e",
    },
  },
});

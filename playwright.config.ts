import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";

try {
  loadEnvFile();
} catch {
  // No .env — rely on the process environment.
}

// Dedicated port so E2E runs never collide with a manually started dev server.
const PORT = 3799;

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl || !/_test(\?|$)/.test(new URL(testDatabaseUrl).pathname)) {
  throw new Error("TEST_DATABASE_URL must point at a *_test database for e2e runs");
}

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
    },
  },
});

/**
 * Verification item 25 (finding C): the e2e configuration must refuse any
 * database that is not a *_test database before global setup or the dev
 * server can start. The rule is tested directly, and the real Playwright
 * configuration is loaded in a child process with a development database
 * URL to prove the refusal happens at configuration load.
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../../e2e/require-test-database";

const DEV_URL = "postgresql://afhey:afhey@localhost:5432/afhey_dev";
const TEST_URL = "postgresql://afhey:afhey@localhost:5432/afhey_test";

function loadPlaywrightConfig(url: string | undefined) {
  const env = { ...process.env };
  delete env.TEST_DATABASE_URL;
  if (url !== undefined) env.TEST_DATABASE_URL = url;
  // Executing the module runs its top-level guard; nothing else has side effects.
  return spawnSync("npx", ["tsx", "playwright.config.ts"], { env, encoding: "utf8", timeout: 60_000 });
}

describe("e2e database rule", () => {
  it("accepts only *_test databases", () => {
    expect(requireTestDatabaseUrl(TEST_URL)).toBe(TEST_URL);
    expect(requireTestDatabaseUrl(`${TEST_URL}?schema=public`)).toContain("afhey_test");
    expect(() => requireTestDatabaseUrl(DEV_URL)).toThrow(/\*_test database.*afhey_dev/);
    expect(() => requireTestDatabaseUrl("postgresql://afhey:afhey@localhost:5432/afhey_test_backup")).toThrow(/\*_test/);
    expect(() => requireTestDatabaseUrl(undefined)).toThrow(/must be set/);
    expect(() => requireTestDatabaseUrl("not a url")).toThrow(/valid connection URL/);
  });

  it("the Playwright configuration refuses a development database at load time, before setup starts", () => {
    const refused = loadPlaywrightConfig(DEV_URL);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/\*_test database/);
    expect(refused.stderr).toContain("afhey_dev");

    const accepted = loadPlaywrightConfig(TEST_URL);
    expect(accepted.status).toBe(0);
  }, 120_000);
});

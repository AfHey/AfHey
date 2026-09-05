/**
 * The e2e database rule (finding C; verification item 25): Playwright may
 * only ever run against a database whose name ends in `_test`. This module
 * has no dependencies so both the Playwright configuration (CommonJS
 * transpile) and the unit tests can import it.
 */
export function requireTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error("TEST_DATABASE_URL must be set to a *_test database for e2e runs");
  }
  let name: string;
  try {
    name = new URL(url).pathname.replace(/^\//, "");
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid connection URL");
  }
  if (!/_test$/.test(name)) {
    throw new Error(`TEST_DATABASE_URL must point at a *_test database for e2e runs, got "${name}"`);
  }
  return url;
}

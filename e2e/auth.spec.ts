import { expect, test } from "@playwright/test";

// These specs exercise the unauthenticated and login flows themselves, so
// they run without the shared storage state.
test.use({ storageState: { cookies: [], origins: [] } });

const PASSWORD = process.env.AFHEY_E2E_PASSWORD;

test("redirects unauthenticated visitors to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "AfHey" })).toBeVisible();
});

test("signs in and out", async ({ page }) => {
  test.skip(!PASSWORD, "AFHEY_E2E_PASSWORD is not set");
  await page.goto("/login");
  await page.getByLabel("Password").fill(PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/tasks$/);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

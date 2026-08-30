import { expect, test } from "@playwright/test";

// Runs against the dev database; the user is provisioned with the password in
// AFHEY_E2E_PASSWORD (see README and .env.example).
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
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

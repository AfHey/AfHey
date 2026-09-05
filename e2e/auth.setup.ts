import { expect, test as setup } from "@playwright/test";

// Logs in once per run; every chromium test starts from this storage state,
// keeping the suite to two real logins per run (this one and the sign-in test).
setup("authenticate", async ({ page }) => {
  const password = process.env.AFHEY_E2E_PASSWORD;
  if (!password) throw new Error("AFHEY_E2E_PASSWORD is not set; see README");
  await page.goto("/login");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.context().storageState({ path: "playwright/.auth/user.json" });
});

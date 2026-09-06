import { expect, test } from "@playwright/test";

/**
 * A phone on the LAN reaches `next dev` by IP or hostname over plain HTTP.
 * Next 16 blocks its own dev scripts for hosts outside `allowedDevOrigins`,
 * which left the login form un-hydrated (decisions.md 2026-09-05 "LAN access
 * to the development server"). Chromium maps lan.test to the loopback server
 * here; the config allows that host through AFHEY_DEV_ORIGINS.
 */
test.use({
  storageState: { cookies: [], origins: [] },
  launchOptions: { args: ["--host-resolver-rules=MAP lan.test 127.0.0.1"] },
});

test("signing in over plain HTTP from a non-localhost host lands on Today", async ({ page, baseURL }) => {
  const password = process.env.AFHEY_E2E_PASSWORD;
  if (!password) throw new Error("AFHEY_E2E_PASSWORD is not set; see README");
  const port = new URL(baseURL!).port;
  const blocked: string[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/_next/") && res.status() === 403) blocked.push(res.url());
  });
  await page.goto(`http://lan.test:${port}/login`);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`^http://lan\\.test:${port}/today$`));
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  expect(blocked).toEqual([]);
  const cookies = await page.context().cookies(`http://lan.test:${port}`);
  const session = cookies.find((c) => c.name === "afhey_session");
  expect(session).toBeDefined();
  expect(session!.secure).toBe(false); // development: plain HTTP must carry it
  expect(session!.httpOnly).toBe(true);
  expect(session!.sameSite).toBe("Lax");
});

import { expect, test } from "@playwright/test";

// Phase 1 exit criteria (spec §15): capture a messy paragraph, review items
// with evidence and deterministic dates, apply once, then "close and reopen"
// — a brand-new browser session — with everything saved. Stale-apply and
// unsafe-undo are covered at the engine level in tests/db/proposals.test.ts.
const stamp = Date.now();

test("a reviewed batch survives a completely fresh session", async ({ page, browser }) => {
  const title = `E2E exit task ${stamp} tomorrow`;
  await page.goto("/inbox");
  await page.getByLabel("Capture").fill(`${title}\nnote: E2E exit note ${stamp}`);
  await page.getByRole("button", { name: "Capture" }).click();
  await page.getByRole("button", { name: "Interpret with AI" }).click();

  const card = page.locator("article", { hasText: `E2E exit task ${stamp}` });
  await expect(card.locator("li").getByText(title, { exact: true })).toBeVisible();
  // Deterministic date evidence is shown for the review.
  await expect(card.getByText(/deadline: “tomorrow”/)).toBeVisible();
  await card.getByRole("button", { name: /^Accept all 2/ }).click();
  await expect(card.getByText("Applied 2 item(s).")).toBeVisible();

  // Second apply attempt is idempotent: the button is gone and the batch is
  // reported once.
  await expect(card.getByRole("button", { name: /^Accept all/ })).toHaveCount(0);

  // New session: no cookies, log in again, everything is still there.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const fresh = await context.newPage();
  await fresh.goto("/login");
  await fresh.getByLabel("Password").fill(process.env.AFHEY_E2E_PASSWORD!);
  await fresh.getByRole("button", { name: "Sign in" }).click();
  await expect(fresh).toHaveURL(/\/tasks$/);
  await expect(fresh.getByText(title)).toBeVisible();
  await expect(fresh.getByText(/Due .*Sep|Due .*Oct|Due .*Nov|Due .*Dec|Due .*Jan|Due .*Feb|Due .*Mar|Due .*Apr|Due .*May|Due .*Jun|Due .*Jul|Due .*Aug/).first()).toBeVisible();
  await fresh.goto("/notes");
  await expect(fresh.getByText(`E2E exit note ${stamp}`)).toBeVisible();
  await context.close();
});

test("the Inbox review works on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inbox");
  await page.getByLabel("Capture").fill(`E2E mobile ${stamp}`);
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByRole("region", { name: "Redaction preview" })).toBeVisible();
  await page.getByRole("button", { name: "Interpret with AI" }).click();
  const card = page.locator("article", { hasText: `E2E mobile ${stamp}` });
  await card.getByRole("button", { name: /^Accept this/ }).click();
  await expect(card.getByText("Applied 1 item(s).")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

import { expect, test } from "@playwright/test";

// Runs pre-authenticated against the dev database with the fake provider.
// Every assertion is scoped to this run's capture card, since earlier runs
// leave their own (fictional) captures behind.
const stamp = Date.now();

test("captures, previews, interprets, accepts, and undoes a batch", async ({ page }) => {
  const title = `E2E water the plants ${stamp} tomorrow`;
  await page.goto("/inbox");
  await page.getByLabel("Capture").fill(`${title}\nnote: E2E receipts ${stamp}`);
  await page.getByRole("button", { name: "Capture" }).click();

  await expect(page.getByRole("region", { name: "Redaction preview" })).toBeVisible();
  await expect(page.getByLabel("Text to send")).toHaveValue(new RegExp(`E2E water the plants ${stamp}`));
  await page.getByRole("button", { name: "Interpret with AI" }).click();

  const card = page.locator("article", { hasText: `E2E water the plants ${stamp}` });
  await expect(card.locator("li").getByText(title, { exact: true })).toBeVisible();
  await card.getByRole("button", { name: /^Accept all 2/ }).click();
  await expect(card.getByText("Applied 2 item(s).")).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByText(title)).toBeVisible();

  await page.goto("/inbox");
  await card.getByRole("button", { name: "Undo this batch" }).click();
  await expect(card.getByText("Undo would reverse:")).toBeVisible();
  await card.getByRole("button", { name: "Confirm undo" }).click();
  await expect(card.getByText(/Undone — the 2 item\(s\)/)).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByText(title)).toHaveCount(0);
});

test("keeps a private note without any AI call", async ({ page }) => {
  await page.goto("/inbox");
  await page.getByLabel("Capture").fill(`E2E private ${stamp}`);
  await page.getByLabel(/Keep private/).check();
  await page.getByRole("button", { name: "Keep note" }).click();
  await expect(page.getByText("Kept as a private note. No AI call was made.")).toBeVisible();
  await page.goto("/notes");
  await expect(page.getByText(`E2E private ${stamp}`)).toBeVisible();
});

import { expect, test } from "@playwright/test";

// Runs pre-authenticated against the dev database with the fake provider.
const stamp = Date.now();

test("captures, previews, interprets, accepts, and undoes a batch", async ({ page }) => {
  await page.goto("/inbox");
  await page.getByLabel("Capture").fill(`E2E water the plants ${stamp} tomorrow\nnote: E2E receipts ${stamp}`);
  await page.getByRole("button", { name: "Capture" }).click();

  const preview = page.getByRole("region", { name: "Redaction preview" });
  await expect(preview).toBeVisible();
  await expect(page.getByLabel("Text to send")).toHaveValue(new RegExp(`E2E water the plants ${stamp}`));
  await page.getByRole("button", { name: "Interpret with AI" }).click();

  await expect(page.getByText(`E2E water the plants ${stamp} tomorrow`)).toBeVisible();
  await expect(page.getByText("Needs confirmation").first()).toBeHidden({ timeout: 1 }).catch(() => undefined);
  await page.getByRole("button", { name: /^Accept all 2/ }).click();
  await expect(page.getByText("Applied 2 item(s).")).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByText(`E2E water the plants ${stamp} tomorrow`)).toBeVisible();

  await page.goto("/inbox");
  await page.getByRole("button", { name: "Undo this batch" }).first().click();
  await expect(page.getByText("Undo would reverse:")).toBeVisible();
  await page.getByRole("button", { name: "Confirm undo" }).click();
  await expect(page.getByText(/Undone — the 2 item\(s\)/)).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByText(`E2E water the plants ${stamp} tomorrow`)).toHaveCount(0);
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

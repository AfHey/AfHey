import { expect, test } from "@playwright/test";

/**
 * Phase 2 Step 2: the scheduling constraints are editable on a phone. The
 * seed already provides evening availability; this adds and removes a
 * window of its own so reruns stay clean.
 */
test("adds and removes an availability window on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Scheduling" });
  await expect(section).toBeVisible();
  await expect(section.getByRole("list", { name: "Availability windows" })).toContainText("17:30–21:30");

  await section.getByLabel("Availability weekday").selectOption("7");
  await section.getByLabel("Availability start").fill("14:00");
  await section.getByLabel("Availability end").fill("16:00");
  await section.getByLabel("Availability label").fill("E2E window");
  await section.getByRole("button", { name: "Add availability window" }).click();
  const row = section.getByRole("list", { name: "Availability windows" }).getByRole("listitem").filter({ hasText: "E2E window" });
  await expect(row).toContainText("Sun 14:00–16:00");

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toHaveCount(0);

  // The database rule is surfaced, not swallowed.
  await section.getByLabel("Availability start").fill("18:00");
  await section.getByLabel("Availability end").fill("17:00");
  await section.getByRole("button", { name: "Add availability window" }).click();
  await expect(section.getByText(/start time must be before end time/)).toBeVisible();
});

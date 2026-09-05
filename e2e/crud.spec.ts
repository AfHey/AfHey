import { expect, test } from "@playwright/test";

// Runs pre-authenticated via the shared storage state (see auth.setup.ts).
const stamp = Date.now();

test("creates an area, a project, and a task inside it", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "+ Add a project or area" }).click();
  await page.getByRole("combobox", { name: "Type" }).selectOption("area");
  await page.getByLabel("Name").fill(`E2E Area ${stamp}`);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: `E2E Area ${stamp}` })).toBeVisible();

  await page.getByRole("button", { name: "+ Add a project or area" }).click();
  await page.getByLabel("Name").fill(`E2E Project ${stamp}`);
  await page
    .getByRole("combobox", { name: "Area", exact: true })
    .selectOption({ label: `E2E Area ${stamp}` });
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`E2E Project ${stamp}`) })).toBeVisible();

  await page.goto("/tasks");
  await page.getByRole("button", { name: "+ Add a task" }).click();
  await page.getByLabel("Title").fill(`E2E task ${stamp}`);
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption({ label: `E2E Project ${stamp}` });
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText(`E2E task ${stamp}`)).toBeVisible();

  // Controlled checkbox: state flips only after the server refresh, so click
  // and rely on the retrying assertion below rather than check().
  await page.getByRole("checkbox", { name: `Complete "E2E task ${stamp}"` }).click();
  await expect(page.getByRole("checkbox", { name: `Reopen "E2E task ${stamp}"` })).toBeChecked();
});

test("keeps a note and shows it in the list", async ({ page }) => {
  await page.goto("/notes");
  await page.getByRole("button", { name: "+ Keep a note" }).click();
  await page.getByLabel("Note", { exact: true }).fill(`E2E note body ${stamp}`);
  await page.getByRole("button", { name: "Keep note" }).click();
  await expect(page.getByText(`E2E note body ${stamp}`)).toBeVisible();
});

test("mobile layout shows the bottom tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tasks");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/\/calendar$/);
});

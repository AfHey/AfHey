import { expect, test, type Page } from "@playwright/test";
import { DateTime } from "luxon";

/**
 * Phase 2 Step 9 (desktop): planned blocks carry a Start button that opens a
 * focus session, a task without an estimate can be estimated inline, and an
 * empty day says so. Rows are created through the API so parallel tests
 * never share them; times are wall-clock in America/New_York (seed zone).
 */
// Serial: the focus test flips a block through in_progress, which would hide
// its Start button from the section check if the two ran at once.
test.describe.configure({ mode: "serial" });
const stamp = Date.now();
const zone = "America/New_York";

async function createTask(page: Page, title: string, extra: Record<string, unknown>) {
  const res = await page.request.post("/api/tasks", {
    data: { title, status: "open", bucket: "active", taskKind: "action", isSchedulable: true, isSplittable: true, peopleIds: [], ...extra },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}

test("a planned block today offers Start, and a focus session can be started and stopped", async ({ page }) => {
  const title = `E2E focus ${stamp}`;
  const task = await createTask(page, title, { remainingEstimateMinutes: 30 });
  const day = DateTime.now().setZone(zone).startOf("day");
  const res = await page.request.post("/api/events", {
    data: {
      title,
      kind: "block",
      scheduleType: "flexible",
      isLocked: false,
      timezone: zone,
      startAt: day.plus({ hours: 23 }).toUTC().toISO(),
      endAt: day.plus({ hours: 23, minutes: 30 }).toUTC().toISO(),
      peopleIds: [],
      taskId: task.id,
      blockState: "planned",
    },
  });
  expect(res.status()).toBe(201);
  await page.goto("/today");
  const row = page.getByRole("listitem").filter({ hasText: title }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Start" }).click();
  const focus = page.getByRole("region", { name: "Focus session" });
  await expect(focus).toContainText(title);
  await focus.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Focus session stopped." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Focus session" })).toHaveCount(0);
});

test("a task without an estimate can be estimated inline from Today", async ({ page }) => {
  const title = `E2E estimate ${stamp}`;
  await createTask(page, title, {});
  await page.goto("/today");
  const row = page.getByRole("listitem").filter({ hasText: title }).first();
  await expect(row).toContainText("needs an estimate");
  await row.getByLabel(`Estimate for “${title}” in minutes`).fill("45");
  await row.getByRole("button", { name: "Set estimate" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Estimated “${title}” at 45 min.` })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: title }).first()).not.toContainText("needs an estimate");
  await expect(page.getByRole("listitem").filter({ hasText: title }).first()).toContainText("45 min left");
});

test("the planned-work section says when there is nothing to start", async ({ page }) => {
  await page.goto("/today");
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Planned work" }) });
  await expect(section).toBeVisible();
  await expect(section.getByRole("button", { name: "Start" }).first().or(section.getByText("nothing to start yet"))).toBeVisible();
});

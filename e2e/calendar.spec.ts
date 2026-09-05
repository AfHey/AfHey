import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 2 Step 8: the calendar's gestures persist. Each gesture test creates
 * its own fixed event through the API so parallel tests never touch the same
 * row. Times are checked as wall-clock strings in America/New_York.
 */
const eventByTitle = (page: Page, title: string) => page.locator(".afhey-event", { hasText: title });
const status = (page: Page) => page.getByTestId("calendar-status");
const stamp = Date.now();

async function createFixedEvent(page: Page, title: string, startZ: string, endZ: string) {
  const res = await page.request.post("/api/events", {
    data: { title, kind: "meeting", scheduleType: "fixed", isLocked: false, timezone: "America/New_York", startAt: startZ, endAt: endZ, peopleIds: [] },
  });
  expect(res.status()).toBe(201);
}

test.describe("calendar (desktop)", () => {
  test("shows a fixed event at the right wall-clock time in the user's zone, without hydration errors", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    await page.goto("/calendar?date=2026-09-02");
    const event = eventByTitle(page, "Pipeline sync");
    await expect(event).toBeVisible();
    await expect(event).toContainText("10:00");
    await expect(event).toContainText("10:30");
    await expect(page.locator('[role="gridcell"][data-date="2026-09-02"]').filter({ has: event })).toHaveCount(1);
    await page.waitForTimeout(500);
    expect(problems).toEqual([]);
  });

  test("dragging an event down one hour saves the move and reports it in the user's zone", async ({ page }) => {
    const title = `E2E drag ${stamp}`;
    await createFixedEvent(page, title, "2026-09-16T14:00:00Z", "2026-09-16T14:30:00Z"); // Wed 10:00–10:30 NY
    await page.goto("/calendar?date=2026-09-16&view=day");
    const event = eventByTitle(page, title);
    await expect(event).toBeVisible();
    const box = (await event.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const oneHour = box.height * 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + oneHour / 3, { steps: 4 });
    await page.mouse.move(x, y + oneHour, { steps: 12 });
    await page.mouse.up();
    await expect(status(page)).toContainText(`Moved "${title}" to Wed 16 Sep 11:00 – 11:30`);
    await page.reload();
    await expect(eventByTitle(page, title)).toContainText("11:00");
  });

  test("resizing from the bottom edge saves the new end", async ({ page }) => {
    const title = `E2E resize ${stamp}`;
    await createFixedEvent(page, title, "2026-09-17T14:00:00Z", "2026-09-17T14:30:00Z"); // Thu 10:00–10:30 NY
    await page.goto("/calendar?date=2026-09-17&view=day");
    const event = eventByTitle(page, title);
    await expect(event).toBeVisible();
    const box = (await event.boundingBox())!;
    const x = box.x + box.width / 2;
    await page.mouse.move(x, box.y + box.height / 2);
    await page.waitForTimeout(200);
    const edgeY = box.y + box.height - 2;
    await page.mouse.move(x, edgeY);
    await page.mouse.down();
    await page.mouse.move(x, edgeY + box.height / 2, { steps: 4 });
    await page.mouse.move(x, edgeY + box.height, { steps: 10 });
    await page.mouse.up();
    await expect(status(page)).toContainText(`Resized "${title}" to Thu 17 Sep 10:00 – 11:00`);
    await page.reload();
    await expect(eventByTitle(page, title)).toContainText("11:00");
  });

  test("selecting an empty range creates a fixed event", async ({ page }) => {
    await page.goto("/calendar?date=2026-09-18&view=day"); // Friday, nothing seeded
    await page.locator('[data-time="15:00:00"]').first().scrollIntoViewIfNeeded();
    await page.locator('[data-time="13:00:00"]').first().scrollIntoViewIfNeeded();
    const column = page.locator('[role="gridcell"][data-date="2026-09-18"]').last();
    const columnBox = (await column.boundingBox())!;
    const slot14 = (await page.locator('[data-time="14:00:00"]').first().boundingBox())!;
    const slot15 = (await page.locator('[data-time="15:00:00"]').first().boundingBox())!;
    const x = columnBox.x + columnBox.width / 2;
    await page.mouse.move(x, slot14.y + 2);
    await page.mouse.down();
    await page.mouse.move(x, slot14.y + (slot15.y - slot14.y) / 2, { steps: 4 });
    await page.mouse.move(x, slot15.y + 2, { steps: 8 });
    await page.mouse.up();
    const form = page.getByRole("form", { name: "New event" });
    await expect(form).toContainText("Fri 18 Sep 14:00 – 15:");
    const title = `E2E planning ${stamp}`;
    await form.getByLabel("Event title").fill(title);
    await form.getByRole("button", { name: "Save event" }).click();
    await expect(status(page)).toContainText(`Added "${title}"`);
    await expect(eventByTitle(page, title)).toBeVisible();
  });

  test("plans a day into blocks through a reviewed Proposal and reverts it", async ({ page }) => {
    await page.goto("/calendar?date=2026-09-21&view=day"); // a Monday with seeded evening availability
    await page.getByRole("button", { name: "Plan day" }).click();
    const review = page.getByRole("region", { name: "Proposed plan" });
    await expect(review).toBeVisible();
    await expect(review).toContainText("to add");
    await review.getByRole("button", { name: /^Accept/ }).click();
    await expect(review.getByRole("status")).toContainText(/Applied \d+ change/);
    await expect(page.locator(".afhey-kind-block").first()).toBeVisible();
    await review.getByRole("button", { name: "Undo this plan" }).click();
    await expect(review.getByRole("status")).toContainText("Reverted.");
    await review.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(".afhey-kind-block")).toHaveCount(0);
  });
});

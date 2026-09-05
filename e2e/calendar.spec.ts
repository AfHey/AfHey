import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 2 Step 1 spike: FullCalendar v7 inside Next 16. The seed puts
 * "Pipeline sync" at 2026-09-02 14:00–14:30 UTC, which is 10:00–10:30 in
 * America/New_York (the settings zone). Gestures are reported and reverted
 * in the spike, so every test checks the reported wall-clock time and that
 * the event is back where it started.
 */
const EVENT = "Pipeline sync";
const eventLocator = (page: Page) => page.locator(".afhey-event", { hasText: EVENT });
const status = (page: Page) => page.getByTestId("calendar-gesture");

test.describe("calendar (desktop)", () => {
  test("shows a fixed event at the right wall-clock time in the user's zone, without hydration errors", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    await page.goto("/calendar?date=2026-09-02");
    const event = eventLocator(page);
    await expect(event).toBeVisible();
    await expect(event).toContainText("10:00");
    await expect(event).toContainText("10:30");
    await expect(page.locator('[role="gridcell"][data-date="2026-09-02"]').filter({ has: event })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: /Aug – Sep 2026|Aug.*2026/ })).toBeVisible();
    await page.waitForTimeout(500);
    expect(problems).toEqual([]);
  });

  test("dragging a block down one hour reports 11:00 in the user's zone and reverts", async ({ page }) => {
    await page.goto("/calendar?date=2026-09-02&view=day");
    const event = eventLocator(page);
    await expect(event).toBeVisible();
    const box = (await event.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const oneHour = box.height * 2; // the event spans one 30-minute slot
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + oneHour / 3, { steps: 4 });
    await page.mouse.move(x, y + oneHour, { steps: 12 });
    await page.mouse.up();
    await expect(status(page)).toContainText(`Would move "${EVENT}" to Wed 2 Sep 11:00 – Wed 2 Sep 11:30 (America/New_York)`);
    await expect(event).toContainText("10:00");
  });

  test("resizing from the bottom edge reports the new end and reverts", async ({ page }) => {
    await page.goto("/calendar?date=2026-09-02&view=day");
    const event = eventLocator(page);
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
    await expect(status(page)).toContainText(`Would resize "${EVENT}" to Wed 2 Sep 10:00 – Wed 2 Sep 11:00 (America/New_York)`);
    await expect(event).toContainText("10:30");
  });

  test("selecting an empty range reports it in the user's zone", async ({ page }) => {
    await page.goto("/calendar?date=2026-09-02&view=day");
    await expect(eventLocator(page)).toBeVisible();
    // The grid scrolls inside its own box; bring the afternoon into view first.
    await page.locator('[data-time="15:00:00"]').first().scrollIntoViewIfNeeded();
    await page.locator('[data-time="13:00:00"]').first().scrollIntoViewIfNeeded();
    const column = page.locator('[role="gridcell"][data-date="2026-09-02"]').last();
    const columnBox = (await column.boundingBox())!;
    const slot14 = (await page.locator('[data-time="14:00:00"]').first().boundingBox())!;
    const slot15 = (await page.locator('[data-time="15:00:00"]').first().boundingBox())!;
    const x = columnBox.x + columnBox.width / 2;
    await page.mouse.move(x, slot14.y + 2);
    await page.mouse.down();
    await page.mouse.move(x, slot14.y + (slot15.y - slot14.y) / 2, { steps: 4 });
    await page.mouse.move(x, slot15.y + 2, { steps: 8 });
    await page.mouse.up();
    await expect(status(page)).toContainText("Would create an event Wed 2 Sep 14:00 – Wed 2 Sep 15:");
  });
});

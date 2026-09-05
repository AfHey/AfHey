import { devices, expect, test } from "@playwright/test";

/**
 * Phase 2 Step 8, phone half: a long-press drag saves the move. Driven
 * through Chromium's touch emulation on an iPhone-sized viewport; a physical
 * device pass remains a manual check.
 */
const { defaultBrowserType: _webkit, ...iphone } = devices["iPhone 13"];
void _webkit;
test.use({ ...iphone, storageState: "playwright/.auth/user.json" });

test("a long-press drag on touch moves an event and saves it", async ({ page, context }) => {
  const title = `E2E touch ${Date.now()}`;
  const res = await page.request.post("/api/events", {
    data: { title, kind: "meeting", scheduleType: "fixed", isLocked: false, timezone: "America/New_York", startAt: "2026-09-15T14:00:00Z", endAt: "2026-09-15T14:30:00Z", peopleIds: [] },
  });
  expect(res.status()).toBe(201);
  await page.goto("/calendar?date=2026-09-15&view=day");
  const event = page.locator(".afhey-event", { hasText: title });
  await expect(event).toBeVisible();
  await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  const box = (await event.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const oneHour = box.height * 2;
  const client = await context.newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(700); // past longPressDelay (400 ms)
  for (let step = 1; step <= 12; step++) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (oneHour * step) / 12 }] });
    await page.waitForTimeout(30);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByTestId("calendar-status")).toContainText(`Moved "${title}" to Tue 15 Sep 11:00`);
  await page.reload();
  await expect(page.locator(".afhey-event", { hasText: title })).toContainText("11:00");
});

test("Today is usable on a phone: sections, capacity, and planning", async ({ page }) => {
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Capacity" })).toContainText("free ahead");
  await expect(page.getByRole("heading", { name: "Fixed events" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Planned work" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waiting for" })).toBeVisible();
  await expect(page.getByText("Cabinet quote from Marta")).toBeVisible();
  await page.getByRole("button", { name: "Plan today" }).click();
  await expect(page.getByText(/Proposed plan|Nothing to change/).first()).toBeVisible();
  await page.getByRole("link", { name: "+ Add" }).click();
  await expect(page).toHaveURL(/\/inbox\?focus=1$/);
  await expect(page.getByRole("textbox").first()).toBeFocused();
});

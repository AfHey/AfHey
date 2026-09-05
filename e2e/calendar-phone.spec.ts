import { devices, expect, test } from "@playwright/test";

/**
 * Phase 2 Step 1 spike, phone half: FullCalendar's touch interaction is a
 * long-press followed by a drag. Emulated with Chromium's touch input
 * (CDP) on an iPhone-sized viewport with touch enabled; a physical-device
 * pass remains a manual check.
 */
// The iPhone profile (viewport, touch, mobile UA) on the project's Chromium:
// touch drags are driven through CDP, which only Chromium exposes.
const { defaultBrowserType: _webkit, ...iphone } = devices["iPhone 13"];
void _webkit;
test.use({ ...iphone, storageState: "playwright/.auth/user.json" });

const EVENT = "Pipeline sync";

test("a long-press drag on touch moves a block and reports the time", async ({ page, context }) => {
  await page.goto("/calendar?date=2026-09-02&view=day");
  const event = page.locator(".afhey-event", { hasText: EVENT });
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
  await expect(page.getByTestId("calendar-gesture")).toContainText(`Would move "${EVENT}" to Wed 2 Sep 11:00`);
  await expect(event).toContainText("10:00");
});

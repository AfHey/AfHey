import { expect, test, type Page } from "@playwright/test";
import { DateTime } from "luxon";

/**
 * Phase 2 Step 12 — the exit-criteria story end to end (docs/phase-2-plan.md
 * §3 Step 12, §8): constraints configured → fixed Event entered → tasks with
 * estimates → "Plan day" places blocks into real free time without overlaps
 * → Today shows the plan on a phone-sized viewport with the capacity check →
 * a missed block → reschedule Proposal → apply → undo → search finds it all.
 * Serial: later steps read what earlier ones wrote. Rows are created through
 * the API; times are wall-clock in America/New_York (the seed zone).
 */
test.describe.configure({ mode: "serial" });
const zone = "America/New_York";
const stamp = Date.now();
const DAY = "2026-10-06"; // a Tuesday well ahead of any run: seed gives evenings 17:30–21:30 (job hours are work-only)

async function post(page: Page, path: string, data: Record<string, unknown>, expected = 201) {
  const res = await page.request.post(path, { data });
  expect(res.status(), `${path}: ${await res.text()}`).toBe(expected);
  return (await res.json()) as { id: string };
}
const createTask = (page: Page, title: string, extra: Record<string, unknown>) =>
  post(page, "/api/tasks", { title, status: "open", bucket: "active", taskKind: "action", isSchedulable: true, isSplittable: true, peopleIds: [], ...extra });
const createEvent = (page: Page, data: Record<string, unknown>) => post(page, "/api/events", { scheduleType: "fixed", isLocked: false, timezone: zone, peopleIds: [], ...data });

/** "HH:mm – HH:mm" from an event chip, as minutes of the day. */
function minutesOf(text: string): [number, number] | null {
  const m = /(\d{2}):(\d{2})\s*[–-]\s*(\d{2}):(\d{2})/.exec(text);
  if (!m) return null;
  return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])];
}

test("1. constraints are configured and shown in Settings", async ({ page }) => {
  await post(page, "/api/settings/windows/availability", { weekday: 2, startTime: "06:00", endTime: "07:30", kind: "general", label: `E2E early ${stamp}` });
  await page.goto("/settings");
  await expect(page.getByText(`E2E early ${stamp}`)).toBeVisible();
});

test("2–4. a fixed event, two estimated tasks, and Plan day placing blocks into free time without overlaps", async ({ page }) => {
  await createEvent(page, { title: `E2E flow standup ${stamp}`, kind: "meeting", startAt: `${DAY}T21:30:00Z`, endAt: `${DAY}T22:00:00Z` }); // 17:30–18:00 NY
  await createTask(page, `E2E flow deep work ${stamp}`, { remainingEstimateMinutes: 90, isSplittable: false, userPriority: "must", deadlineDate: "2026-10-07", deadlineType: "hard" });
  await createTask(page, `E2E flow small ${stamp}`, { remainingEstimateMinutes: 30, userPriority: "must", deadlineDate: "2026-10-07", deadlineType: "hard" });

  await page.goto(`/calendar?date=${DAY}&view=day`);
  await page.getByRole("button", { name: "Plan day" }).click();
  const review = page.getByRole("region", { name: "Proposed plan" });
  await expect(review).toContainText(`Add E2E flow deep work ${stamp}`);
  await expect(review).toContainText(`Add E2E flow small ${stamp}`);
  await review.getByRole("button", { name: /^Accept/ }).click();
  await expect(review.getByRole("status")).toContainText(/Applied \d+ change/);
  await page.reload();

  const chips = page.locator(".afhey-event");
  await expect(chips.locator(".afhey-kind-block").or(chips.filter({ hasText: `E2E flow deep work ${stamp}` })).first()).toBeVisible();
  const texts = await chips.allInnerTexts();
  const spans = texts.map(minutesOf).filter((s): s is [number, number] => s !== null);
  expect(spans.length).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const overlap = spans[i][0] < spans[j][1] && spans[j][0] < spans[i][1];
      expect(overlap, `${texts[i]} overlaps ${texts[j]}`).toBe(false);
    }
  }
  // Every block lies inside the general availability for a Tuesday (06:00–07:30 from step 1, 17:30–21:30 from the seed).
  const blocks = await page.locator(".afhey-event.afhey-kind-block").allInnerTexts();
  for (const b of blocks) {
    const [s, e] = minutesOf(b)!;
    const inside = (s >= 6 * 60 && e <= 7 * 60 + 30) || (s >= 17 * 60 + 30 && e <= 21 * 60 + 30);
    expect(inside, `block outside availability: ${b}`).toBe(true);
  }
});

test("5–6. Today on a phone shows the plan and the capacity check", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const now = DateTime.now().setZone(zone);
  test.skip(now.hour >= 23 && now.minute >= 40, "too close to midnight for a same-day block");
  const task = await createTask(page, `E2E flow today ${stamp}`, { remainingEstimateMinutes: 240 });
  await createEvent(page, {
    title: `E2E flow today ${stamp}`,
    kind: "block",
    scheduleType: "flexible",
    startAt: now.plus({ minutes: 5 }).toUTC().toISO(),
    endAt: now.endOf("day").toUTC().toISO(),
    taskId: task.id,
    blockState: "planned",
  });
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Planned work" })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: `E2E flow today ${stamp}` }).first();
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Start" })).toBeVisible();
  // A block running to midnight exceeds any free time left in the seed availability.
  await expect(page.getByRole("region", { name: "Capacity" })).toContainText("overcommitted by");
});

test("7. a missed block is rescheduled through a Proposal, applied, and undone", async ({ page }) => {
  const yesterday = DateTime.now().setZone(zone).minus({ days: 1 }).startOf("day");
  const title = `E2E flow missed ${stamp}`;
  const task = await createTask(page, title, { remainingEstimateMinutes: 60 });
  await createEvent(page, {
    title,
    kind: "block",
    scheduleType: "flexible",
    startAt: yesterday.plus({ hours: 10 }).toUTC().toISO(),
    endAt: yesterday.plus({ hours: 11 }).toUTC().toISO(),
    taskId: task.id,
    blockState: "planned",
  });
  await page.goto(`/calendar?date=${yesterday.toISODate()}&view=day`);
  await expect(page.getByText(/blocks? ended without a recorded outcome/)).toBeVisible();
  const chip = page.locator(".afhey-event", { hasText: title });
  await expect(chip).toHaveClass(/afhey-block-missed_unconfirmed/);
  await chip.click();
  await page.getByRole("region", { name: "Block actions" }).getByRole("button", { name: "Reschedule day" }).click();
  const review = page.getByRole("region", { name: "Proposed plan" });
  await expect(review).toContainText(`Remove ${title}`);
  await expect(review.getByTestId("plan-headline")).toContainText("to remove");
  await review.getByRole("button", { name: /^Accept/ }).click();
  await expect(review.getByRole("status")).toContainText("Applied 1 change");
  await review.getByRole("button", { name: "Undo this plan" }).click();
  await expect(review.getByRole("status")).toContainText("Reverted.");
  await page.reload();
  await expect(page.locator(".afhey-event", { hasText: title })).toHaveClass(/afhey-block-missed_unconfirmed/);
});

test("8. search finds the flow's records", async ({ page }) => {
  await page.goto(`/search?q=${stamp}`);
  const results = page.getByRole("region", { name: "Results" });
  await expect(results).toContainText(`E2E flow deep work ${stamp}`);
  await expect(results).toContainText(`E2E flow standup ${stamp}`);
});

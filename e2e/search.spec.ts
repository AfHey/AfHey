import { expect, test, type Page } from "@playwright/test";
import { DateTime } from "luxon";

/** Phase 2 Step 10: search from the navigation box and the Search page, with a date phrase. */
const stamp = Date.now();

async function createTask(page: Page, title: string, extra: Record<string, unknown> = {}) {
  const res = await page.request.post("/api/tasks", { data: { title, status: "open", bucket: "active", taskKind: "action", isSplittable: true, isSchedulable: true, peopleIds: [], ...extra } });
  expect(res.status()).toBe(201);
}

test("the navigation search box finds a task by keyword and highlights the match", async ({ page }) => {
  const word = `zircon${stamp}`;
  await createTask(page, `E2E search ${word}`, { notes: `polish the ${word} sample` });
  await page.goto("/today");
  const box = page.getByRole("searchbox", { name: "Search" }).first();
  await box.fill(word);
  await box.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/search\\?q=${word}$`));
  const results = page.getByRole("region", { name: "Results" });
  await expect(results).toContainText(`E2E search ${word}`);
  await expect(results.locator("mark").first()).toContainText(word);
});

test("a date phrase becomes a due window over tasks and events", async ({ page }) => {
  const nowNy = DateTime.now().setZone("America/New_York");
  let friday = nowNy.set({ weekday: 5 }).startOf("day");
  if (friday <= nowNy.startOf("day")) friday = friday.plus({ weeks: 1 });
  const title = `E2E due phrase ${stamp}`;
  await createTask(page, title, { deadlineDate: friday.toISODate(), deadlineType: "soft" });
  await page.goto("/search?q=things+due+friday");
  const results = page.getByRole("region", { name: "Results" });
  await expect(results).toContainText(title);
  await expect(page.getByRole("status")).toContainText("from “due friday”");
});

test("filters narrow results and the API answers JSON", async ({ page }) => {
  const word = `feldspar${stamp}`;
  await createTask(page, `E2E filter open ${word}`);
  await createTask(page, `E2E filter someday ${word}`, { bucket: "someday" });
  await page.goto(`/search?q=${word}&bucket=someday`);
  const results = page.getByRole("region", { name: "Results" });
  await expect(results).toContainText(`E2E filter someday ${word}`);
  await expect(results).not.toContainText(`E2E filter open ${word}`);
  const res = await page.request.get(`/api/search?q=${word}&type=task`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { hits: Array<{ title: string; type: string }> };
  expect(body.hits.map((h) => h.title).sort()).toEqual([`E2E filter open ${word}`, `E2E filter someday ${word}`]);
});

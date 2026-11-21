// A page kept current (web/src/fresh.ts): one loaded before a deploy loads anew at its next screen, never in the middle
// of a question; a screen's file gone with a deploy loads the page anew for it; a profile gone in one tab is gone in the
// others too.
import { expect, type Page, test } from "@playwright/test";
import { answer, openGame } from "./play.ts";

/** Marks the page as it is now: a page loaded anew no longer has the mark. */
const mark = (page: Page) => page.evaluate(() => Object.assign(window, { before: true }));
const marked = (page: Page) => page.evaluate(() => (window as { before?: boolean }).before === true);

/** A deploy since the page loaded: the server's answers say another version. */
const deployed = (page: Page) =>
  page.route("**/api/**", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), "x-almanac-version": "next" } });
  });

test("a page loaded before a deploy opens its next screen by loading anew, and not mid-question", async ({ page }) => {
  await openGame(page, "/play/history");
  await expect(page.locator(".question-head")).toContainText("1 от 10");
  await deployed(page);
  await mark(page);
  // The answer's reply says another version: the game goes on in place, the page as it is.
  await answer(page);
  await expect(page.locator(".verdict")).toBeVisible();
  expect(await marked(page)).toBe(true);

  // Out of the game, to another screen: it comes with the page loaded anew.
  await page.goto("/board");
  // The day's board is an answer of the server's: the page is behind.
  await expect(page.locator(".day-board :is(.rank-row, .board-empty)").first()).toBeVisible();
  await mark(page);
  const loaded = page.waitForEvent("load");
  await page.locator("nav.places-foot a[href='/almanac']").click();
  await loaded;
  await expect(page).toHaveURL(/\/almanac$/);
  expect(await marked(page)).toBe(false);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a screen's own file gone with a deploy: the page loads anew for it, once", async ({ page }) => {
  let refused = 0;
  await page.route(
    "**/assets/friends-*.js",
    (route) => {
      refused++;
      return route.fulfill({ status: 404, body: "" });
    },
    { times: 1 },
  );
  await page.goto("/friends");
  await expect(page.getByRole("heading", { name: "Приятели", level: 1 })).toBeVisible();
  expect(refused).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a profile deleted in one tab: another tab of it loads anew as no one's", async ({ context }) => {
  const a = await context.newPage();
  await openGame(a, "/play/music");
  await expect(a.locator(".question-head")).toContainText("1 от 10"); // playing made a guest
  await a.goto("/me");
  await expect(a.getByRole("heading", { level: 1 })).toBeVisible();
  await mark(a);

  const b = await context.newPage();
  await b.goto("/settings");
  await b.getByRole("button", { name: "Изтрий профила" }).click();
  await b.getByRole("button", { name: "Изтрий профила" }).click();
  await expect(b).toHaveURL(/\/$/);

  await a.bringToFront();
  await expect.poll(() => marked(a).catch(() => false)).toBe(false);
  // Профил of no one's is the way in.
  await expect(a).toHaveURL(/\/signin$/);
});

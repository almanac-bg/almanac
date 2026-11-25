// A page kept current (web/src/fresh.ts): one loaded before a deploy loads anew at its next screen, never in the middle
// of a question; a profile gone in one tab is gone in the others too.
import { expect, type Page, test } from "@playwright/test";
import { answer, openGame, playRun } from "./play.ts";

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
  await page.goto("/friends");
  // Приятели is an answer of the server's: the page is behind.
  await expect(page.locator(".friends .friends-none")).toHaveText(/^Още нямаш приятели тук\./);
  await mark(page);
  const loaded = page.waitForEvent("load");
  await page.locator("nav.places-foot a[href='/almanac']").click();
  await loaded;
  await expect(page).toHaveURL(/\/almanac$/);
  expect(await marked(page)).toBe(false);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

/** The page put out of view (another app, another tab) or back into it, as a phone does. */
const inView = (page: Page, shown: boolean) =>
  page.evaluate((shown) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => !shown });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (shown ? "visible" : "hidden"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, shown);

test("a question's report being written keeps a page behind a deploy as it is; without one, it loads anew", async ({
  page,
}) => {
  await page.clock.install();
  await openGame(page, "/play/history");
  await playRun(page);
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  const sheet = page.locator("dialog[open]");
  await sheet.getByRole("button", { name: "Нещо не е наред с въпроса?" }).first().click();
  const draft = "Източникът дава друга година";
  await sheet.locator("textarea").fill(draft);
  await deployed(page);
  await mark(page);

  // Away for over a minute (gone to look up a source), a deploy meanwhile: back, the page asks, and is behind, but
  // the report stays as it was.
  await inView(page, false);
  await page.clock.fastForward(61_000);
  const asked = page.waitForResponse("**/api/me");
  await inView(page, true);
  await asked;
  await page.clock.runFor(1000);
  expect(await marked(page)).toBe(true);
  await expect(sheet.locator("textarea")).toHaveValue(draft);

  // The report given up on: the next return loads the page anew.
  await sheet.locator("textarea").fill("");
  await inView(page, false);
  const loaded = page.waitForEvent("load");
  await inView(page, true);
  await loaded;
  expect(await marked(page)).toBe(false);
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

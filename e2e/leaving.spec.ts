// Leaving a game and coming back to it: back asks while a question's time runs (the browser's back too), a game
// starts only after a tap, a reload goes back to the question it left, and back comes to a page where it was left.
import { expect, test } from "@playwright/test";
import { answer, moveOn, openGame, startDay } from "./play.ts";

const asked = "Ако излезеш сега, въпросът остава без отговор.";

test("the browser's back asks in the day's ten, opened from outside, and never leaves the game", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await startDay(page);
  await expect(page.locator(".question-head")).toContainText("1 от 10");
  // Back mid-question: asked first, over the answers (nothing under the clock moves), and „Остани“ plays on.
  const options = page.locator("article.question .answering");
  const before = await options.boundingBox();
  await page.goBack();
  await expect(page.getByText(asked)).toBeVisible();
  expect(await options.boundingBox()).toEqual(before);
  await expect(page.getByRole("button", { name: "Остани" })).toBeFocused();
  await page.getByRole("button", { name: "Остани" }).click();
  await expect(page.getByText(asked)).toBeHidden();
  await answer(page);
  await moveOn(page);
  await expect(page.locator(".question-head")).toContainText("2 от 10", { timeout: 10_000 });
  // Back again, and „Излез“: the question given up, Начало waits with the rest of the day, in the game still.
  await page.goBack();
  await page.getByRole("button", { name: "Излез" }).click();
  await expect(page.locator(".issue")).toContainText("Следва въпрос 3 от 10.");
  await expect(page).toHaveURL(/\/$/);
});

test("the browser's back in a topic asks, its address kept while it does; „Излез“ comes to its chapter", async ({
  page,
}) => {
  await page.goto("/almanac/history");
  await page.getByRole("link", { name: "Играй главата" }).click();
  await page.getByRole("button", { name: "Започни сега" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10");
  // Back once, then again while it asks: the game's address stays, the question with it.
  for (let i = 0; i < 2; i++) {
    await page.goBack();
    await expect(page.getByText(asked)).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/play\/history$/);
    await expect(page.locator(".question-head")).toContainText("1 от 10");
  }
  await page.getByRole("button", { name: "Излез" }).click();
  await expect(page).toHaveURL(/\/almanac\/history$/);
  await expect(page.getByRole("link", { name: "Продължи главата" })).toBeVisible();
});

test("a topic counts in only after a tap; a reload goes back to its question, and keeps its result", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/almanac/history");
  await page.getByRole("link", { name: "Играй главата" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  // A reload in the count starts nothing: the topic waits for „Започни“.
  await page.reload();
  await expect(page.getByRole("button", { name: "Започни", exact: true })).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(page.getByRole("heading", { name: "Приготви се" })).toHaveCount(0);
  await page.getByRole("button", { name: "Започни", exact: true }).click();
  await page.getByRole("button", { name: "Започни сега" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10");
  // A reload mid-question: straight back to it, its time still running (no count first): never more of it than before.
  const secsLeft = async () =>
    Number(
      await page
        .locator(".timer .secs")
        .first()
        .textContent()
        .then((t) => (t ?? "").replace(/\D/g, "")),
    );
  await page.waitForTimeout(2000);
  const before = await secsLeft();
  await page.reload();
  await expect(page.locator(".question-head")).toContainText("1 от 10");
  await expect(page.getByRole("heading", { name: "Приготви се" })).toHaveCount(0);
  expect(await secsLeft()).toBeLessThanOrEqual(before);
  await answer(page);
  await moveOn(page);
  for (let n = 1; n < 10; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    await answer(page);
    await moveOn(page);
  }
  await expect(page.locator(".summary")).toBeVisible({ timeout: 10_000 });
  const score = (await page.locator(".summary .score-n").textContent()) ?? "";
  // The result stays the page's: a reload shows it again, and no new game starts.
  await page.reload();
  await expect(page.locator(".summary .score-n")).toHaveText(score);
  await expect(page.getByRole("heading", { name: "Приготви се" })).toHaveCount(0);
  // Back goes to the chapter, where the tap was; forward comes to the result again.
  await page.goBack();
  await expect(page.locator(".chapter")).toBeVisible();
  await page.goForward();
  await expect(page.locator(".summary .score-n")).toHaveText(score);
});

test("„Откажи“ on the count of a topic opened from outside comes back to its start, not to Начало", async ({
  page,
}) => {
  await page.goto("/play/history");
  const begin = page.getByRole("button", { name: "Започни", exact: true });
  for (const out of ["click", "Escape"]) {
    await begin.click();
    await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
    if (out === "click") await page.getByRole("button", { name: "Откажи" }).click();
    else await page.keyboard.press("Escape");
    await expect(begin).toBeVisible();
    await expect(page.getByRole("heading", { name: "Приготви се" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/play\/history$/);
    // The game's own entry given back: the tab's first page again, back from which leaves.
    await expect.poll(() => page.evaluate(() => history.state?.game)).toBeUndefined();
    expect(await page.evaluate(() => history.state?.from)).toBeUndefined();
  }
});

test("a topic left half-way says so on its tile; another tab waits for „Продължи“", async ({ page, context }) => {
  test.setTimeout(60_000);
  await openGame(page, "/play/history");
  await answer(page);
  await moveOn(page);
  await expect(page.locator(".question-head")).toContainText("2 от 10", { timeout: 10_000 });
  // Another tab (another device, as far as the game knows): the question showing in the first isn't started here.
  const other = await context.newPage();
  await other.goto("/play/history");
  await expect(other.getByRole("button", { name: "Продължи" })).toBeVisible();
  await expect(other.locator(".start-screen")).toContainText("Следва въпрос 2 от 10.");
  await other.goto("/almanac/history");
  await expect(other.locator(".chapter-play")).toContainText("Следва въпрос 2 от 10.");
  await other.close();
});

test("the ways back pop the history; back comes to a page and its board where they were", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => fetch("/api/guest", { method: "POST", body: "{}" }));
  await page.goto("/me");
  const length = await page.evaluate(() => history.length);
  await page.getByRole("link", { name: "Настройки" }).click();
  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await page.locator("a.back").filter({ hasText: "Профил" }).click();
  await expect(page).toHaveURL(/\/me$/);
  // Back to Профил by its own way is back in the history: nothing piled up (back now leaves, not to Настройки).
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
  expect(await page.evaluate(() => history.state?.from)).toBeUndefined();

  // A page back where it was.
  await page.setViewportSize({ width: 360, height: 320 }); // short, for Профил to scroll
  await page.goto("/friends");
  await expect(page.getByRole("heading", { name: "Приятели", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Профил" }).first().click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("link", { name: "Настройки" })).toBeVisible(); // Профил loads on its own (kit.ts)
  // What Профил loads after it opens, in: scrolled before, the page would move as it comes (the browser keeps what's
  // in view), and be kept where it moved to.
  await expect(page.locator(".me-figures")).toBeVisible();
  await expect(page.locator(".pick")).toHaveCount(15);
  await page.evaluate(() => scrollTo(0, 200));
  await page.waitForTimeout(400); // kept once it stops
  const y = await page.evaluate(() => scrollY);
  expect(y).toBeGreaterThan(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/friends$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/me$/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(y);
});

test("on a laptop the day's ten have the screen to themselves: the cross is the way out, back to Днес once", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  await startDay(page);
  await expect(page.locator(".question-head")).toContainText("1 от 10");
  // The frame steps aside while a question is asked.
  await expect(page.locator("nav.places")).toBeHidden();
  await page.getByRole("link", { name: "Към Днес" }).click();
  await page.getByRole("button", { name: "Излез" }).click();
  // Back where the game was opened, in place of the game's own entry, not over it.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".issue")).toContainText("Следва въпрос 2 от 10.");
  await expect(page.locator("nav.places")).toBeVisible();
  expect(await page.evaluate(() => history.state)).toMatchObject({ i: 0 });
  expect(await page.evaluate(() => history.state?.game)).toBeUndefined();
});

test("a game's page left before it's ready holds nothing over the page come to", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => fetch("/api/guest", { method: "POST", body: "{}" }));
  await page.reload();
  await expect(page.locator(".issue")).toBeVisible();
  // The topic's start-up waits for the games left today; meanwhile the player goes back to Начало.
  let free = () => {};
  const held = new Promise<void>((on) => {
    free = on;
  });
  await page.route("**/api/runs/left", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/almanac/history");
  await page.getByRole("link", { name: "Играй главата" }).click();
  await expect(page).toHaveURL(/\/play\/history$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/almanac\/history$/);
  free();
  await page.waitForTimeout(1000);
  // The topic's count never came: no game's entry over Начало, and the header and the places are there.
  expect(await page.evaluate(() => history.state?.game)).toBeUndefined();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toHaveCount(0);
  await expect(page.locator("nav.places-foot")).toBeVisible();
});

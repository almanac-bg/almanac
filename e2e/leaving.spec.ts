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
  await expect(page.locator(".card.day")).toContainText("Следва въпрос 3 от 10.");
  await expect(page).toHaveURL(/\/$/);
});

test("a topic counts in only after a tap; a reload goes back to its question, and keeps its result", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.locator(".topics").getByRole("link", { name: "История" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  // A reload in the count starts nothing: the topic waits for „Започни“.
  await page.reload();
  await expect(page.getByRole("button", { name: "Започни", exact: true })).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(page.getByRole("heading", { name: "Приготви се" })).toHaveCount(0);
  await page.getByRole("button", { name: "Започни", exact: true }).click();
  await page.getByRole("button", { name: "Започни сега" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10");
  // A reload mid-question: straight back to it, its time still running (no count first).
  await page.waitForTimeout(2000);
  await page.reload();
  await expect(page.locator(".question-head")).toContainText("1 от 10");
  await expect(page.getByRole("heading", { name: "Приготви се" })).toHaveCount(0);
  const secs = Number(
    await page
      .locator(".timer .secs")
      .first()
      .textContent()
      .then((t) => (t ?? "").replace(/\D/g, "")),
  );
  expect(secs).toBeLessThan(20);
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
  // Back goes to Начало, where the tap was; forward comes to the result again.
  await page.goBack();
  await expect(page.locator(".card.day")).toBeVisible();
  await page.goForward();
  await expect(page.locator(".summary .score-n")).toHaveText(score);
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
  await other.goto("/");
  await expect(other.locator(".topics").getByRole("link", { name: /История/ })).toContainText(
    "Продължи · въпрос 2 от 10",
  );
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

  // Класации: the board chosen is in the address; back to the page opens it again, and a page back where it was.
  await page.setViewportSize({ width: 360, height: 320 }); // short, for Профил to scroll
  const knowledge = page.getByRole("tab", { name: "Знания" });
  await page.goto("/ranks");
  await knowledge.click();
  await expect(page).toHaveURL(/\/ranks#knowledge$/);
  await page.getByRole("link", { name: "Профил" }).first().click();
  await expect(page).toHaveURL(/\/me$/);
  await page.evaluate(() => scrollTo(0, 200));
  const y = await page.evaluate(() => scrollY);
  expect(y).toBeGreaterThan(0);
  await page.waitForTimeout(400); // kept once it stops
  await page.goBack();
  await expect(page).toHaveURL(/\/ranks#knowledge$/);
  await expect(knowledge).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(page).toHaveURL(/\/me$/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(y);
});

test("a second chance with nothing waiting says so at once, with no count", async ({ page }) => {
  await page.goto("/mistakes");
  await expect(page.getByText("Още няма въпроси за втори шанс.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Към Начало" })).toBeVisible();
});

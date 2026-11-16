import { expect, test } from "@playwright/test";
import { daysPlayed, playRun, startDay } from "./play.ts";

test("a broken streak is won back: the day's ten and one more game, the same day", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  // Three days, the first day's reserve spent on the day after them, and yesterday missed too: the streak ended.
  await daysPlayed(page, 5, 4, 3);
  await page.reload();
  const card = page.locator(".keep-card").filter({ hasText: "Серията ти от 3 дни прекъсна" });
  await expect(card).toContainText("Върни я: изиграй днес въпросите на деня и още една игра.");
  await startDay(page);
  await playRun(page);
  // The day played: one game left.
  await expect(card).toContainText("Остава още една игра днес и серията се връща.");
  await page.goto("/play/history");
  await playRun(page);
  await expect(page.locator(".news-open")).toContainText("Серията ти е върната: 4 дни.");
  // Back on Начало: the streak goes on, and nothing more is said of it.
  await page.goto("/");
  await expect(page.locator(".streak-chip")).toContainText("4");
  await expect(page.locator(".keep-card").filter({ hasText: "прекъсна" })).toHaveCount(0);
  await expect(page.locator(".streak-notice")).toHaveCount(0);
});

test("a streak too short to win back is only said to have ended, once", async ({ page }) => {
  await page.goto("/");
  await daysPlayed(page, 4, 3);
  await page.reload();
  await expect(page.locator(".streak-notice")).toContainText("Серията ти от 2 дни прекъсна. Днес започва нова.");
  await page.reload();
  await expect(page.getByRole("button", { name: "Започни" })).toBeVisible();
  await expect(page.locator(".streak-notice")).toHaveCount(0);
});

test("Профил keeps the longest streak, under the one going on", async ({ page }) => {
  await page.goto("/");
  await daysPlayed(page, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 2, 1);
  await page.goto("/me");
  await expect(page.locator(".streak .streak-num")).toHaveText("2");
  await expect(page.locator(".streak")).toContainText("Най-дълга серия: 12 дни");
});

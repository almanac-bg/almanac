import { expect, test } from "@playwright/test";
import { daysPlayed, openGame, playRun, startDay } from "./play.ts";

test("a streak that ended is said to have ended, once", async ({ page }) => {
  await page.goto("/");
  // Five days missed since: two weeks forgive four at most, so one of the last three ends it, whatever today's
  // weekday. Its number is never said (DECISIONS.md, „The direction“).
  await daysPlayed(page, 7, 6);
  await page.reload();
  await expect(page.locator(".streak-notice")).toContainText("Серията ти прекъсна. Днес започва нова.");
  await expect(page.locator(".streak-notice")).not.toContainText(/\d/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Започни" })).toBeVisible();
  await expect(page.locator(".streak-notice")).toHaveCount(0);
});

test("Профил keeps the longest streak, and says what the week forgives", async ({ page }) => {
  await page.goto("/");
  await daysPlayed(page, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 2, 1);
  await page.goto("/me");
  await expect(page.locator(".me-longest .status-n")).toHaveText("12");
  await expect(page.locator(".me-intro")).toContainText("До два пропуснати дни в седмицата не прекъсват серията.");
});

test("a streak at stake: unlit till the day lights it, pointed to from a topic, tomorrow under the result", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  // Three days, to yesterday, none missed: the week would forgive today, so nothing ends at midnight, whatever the hour.
  await daysPlayed(page, 3, 2, 1);
  await page.reload();
  await expect(page.locator(".streak-chip.unlit")).toContainText("3");
  await expect(page.locator(".today-streak .day-stake")).toHaveText("С днешния брой серията става 4.");
  // A topic's result points to the day while it waits: the gold button, the streak under it, „Още десет“ plain.
  await openGame(page, "/play/history");
  await playRun(page);
  // A new level may come with the game, in its sheet once the result has landed: put away.
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  const day = page.getByRole("link", { name: "Към въпросите на деня" });
  await expect(day).toHaveClass(/primary/);
  await expect(page.locator(".actions .day-stake")).toHaveText("С днешния брой серията става 4.");
  await expect(page.getByRole("button", { name: "Още десет" })).not.toHaveClass(/primary/);
  await day.click();
  await startDay(page);
  await playRun(page);
  // Played: tomorrow under the result says what it makes of the streak.
  const tomorrow = page.locator(".summary .tomorrow");
  await expect(tomorrow).toContainText("Утре");
  await expect(tomorrow).toContainText("Серията ти става 5.");
  // The day played: a topic's result has „Още десет“ for its action, and says where its facts went, with no number.
  await openGame(page, "/play/history");
  await playRun(page);
  await expect(page.getByRole("button", { name: "Още десет" })).toHaveClass(/primary/);
  await expect(page.getByRole("link", { name: "Към въпросите на деня" })).toHaveCount(0);
  await expect(page.locator(".summary")).toContainText("Фактите от играта са в книгата ти, в сиво.");
});

test("a week's streak on Днес, and the day played makes it one more: no sheet over the result, no note of it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  // Six days: the seventh makes it seven; nothing is noted (DECISIONS.md, „The direction“: no notes as rewards).
  await daysPlayed(page, 6, 5, 4, 3, 2, 1);
  await page.reload();
  await expect(page.locator(".streak-chip.unlit")).toContainText("6изиграни дни");
  await startDay(page);
  await playRun(page);
  await expect(page.locator(".summary .tomorrow")).toContainText("Серията ти става 8.");
  await expect(page.locator(".summary")).not.toContainText("Отбелязано");
  // Never a sheet over the result, whatever the game was.
  await page.waitForTimeout(1500);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

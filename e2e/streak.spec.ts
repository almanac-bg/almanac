import { expect, type Page, test } from "@playwright/test";
import { daysPlayed, openGame, playRun, startDay } from "./play.ts";

test("a broken streak is won back: the day's ten and one more game, the same day", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  // Three days, the third's reserve spent on the day after them, and yesterday missed too: the streak ended.
  await daysPlayed(page, 5, 4, 3);
  await page.reload();
  const card = page.locator(".keep-card").filter({ hasText: "Серията ти от 3 дни прекъсна" });
  await expect(card).toContainText("Върни я до полунощ: въпросите на деня и още една игра.");
  // At stake, not gone: the chip has the streak's days to win back, not „0 дни поред“.
  await expect(page.locator(".streak-chip")).toContainText("3дни за връщане");
  await startDay(page);
  await playRun(page);
  // The day played: one game left, and the card has the gold way to it (the result's „Сподели“ is plain then).
  await expect(card).toContainText("Остава още една игра днес и серията се връща.");
  await expect(page.locator(".btn.primary")).toHaveCount(1);
  await card.getByRole("link", { name: "Още една игра" }).click();
  await expect(page).toHaveURL(/\/play\/[a-z]+$/);
  await page.getByRole("button", { name: "Започни сега" }).click();
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

test("a streak at stake: unlit till the day lights it, pointed to from a topic, tomorrow under the result", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  // Three days, to yesterday; the third earned a reserve day, so nothing ends at midnight, whatever the hour.
  await daysPlayed(page, 3, 2, 1);
  await page.reload();
  await expect(page.locator(".streak-chip.unlit")).toContainText("3");
  await expect(page.locator(".day .day-stake")).toHaveText("Серия от 3 дни. С днешните въпроси става 4.");
  // The reserve day, a tap from what it's for.
  await page.locator(".status-reserve .explain").click();
  await expect(page.getByRole("note")).toHaveText("Резервен ден: пази серията, ако пропуснеш ден.");
  // A topic's result points to the day while it waits: the gold button, the streak under it, „Още десет“ plain.
  await openGame(page, "/play/history");
  await playRun(page);
  // A new level may come with the game, in its sheet once the result has landed: put away.
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  const day = page.getByRole("link", { name: "Към въпросите на деня" });
  await expect(day).toHaveClass(/primary/);
  await expect(page.locator(".actions .day-stake")).toHaveText("Серия от 3 дни. С днешните въпроси става 4.");
  await expect(page.getByRole("button", { name: "Още десет" })).not.toHaveClass(/primary/);
  await day.click();
  await startDay(page);
  await playRun(page);
  // Played: the flame lit, and tomorrow under the result's buttons (and the goals still open).
  await expect(page.locator(".streak-chip")).toContainText("4");
  await expect(page.locator(".streak-chip.unlit")).toHaveCount(0);
  const tomorrow = page.locator(".summary .tomorrow");
  await expect(tomorrow).toContainText("Утре — нови десет");
  await expect(tomorrow).toContainText("Изиграй ги и серията ти става 5.");
});

/** Keeps every way the streak's chip reads as Начало draws and moves it (its number and words, and „unlit“ while its
 * flame is), for `heard`. */
async function watchChip(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const said: string[] = [];
    (window as unknown as { chipSaid: string[] }).chipSaid = said;
    new MutationObserver(() => {
      for (const chip of document.querySelectorAll(".streak-chip")) {
        const now = `${chip.querySelector(".status-text")?.textContent}${chip.classList.contains("unlit") ? " unlit" : ""}`;
        if (said.at(-1) !== now) said.push(now);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true, attributeFilter: ["class"] });
  });
}

/** What the streak's chip has said since last asked. */
const heard = (page: Page) => page.evaluate(() => (window as unknown as { chipSaid: string[] }).chipSaid.splice(0));

test("the day played rolls the streak on in its chip, its words with its number: never „1 дни поред“", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await watchChip(page);
  await page.goto("/");
  await daysPlayed(page, 1);
  await page.reload();
  await expect(page.locator(".streak-chip.unlit")).toContainText("1ден поред");
  await startDay(page);
  await heard(page);
  await playRun(page);
  await expect(page.locator(".streak-chip:not(.unlit) .status-text")).toHaveText("2дни поред");
  // From the day before, unlit, rolling on (both numbers on their way), to the day played, lit.
  const said = await heard(page);
  expect(said).toContain("1ден поред unlit");
  expect(said).toContain("12дни поред");
  expect(said.filter((s) => /^1дни/.test(s))).toEqual([]);
});

test("a round streak is told by its sheet, not first by its chip: the number rolls on just before it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await watchChip(page);
  await page.goto("/");
  // Two days: no reserve day yet, so the second's stake is real; the third brings the first, told with its sheet.
  await daysPlayed(page, 2, 1);
  await page.reload();
  await expect(page.locator(".streak-chip.unlit")).toContainText("2дни поред");
  await expect(page.locator(".status-reserve")).toHaveCount(0);
  await startDay(page);
  await heard(page);
  await playRun(page);
  const sheet = page.getByRole("dialog", { name: "3 дни поред с въпросите на деня." });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Получаваш резервен ден: ако пропуснеш ден, серията остава.");
  const said = await heard(page);
  expect(said[0]).toBe("2дни поред unlit");
  expect(said).toContain("23дни поред");
  expect(said.at(-1)).toBe("3дни поред");
});

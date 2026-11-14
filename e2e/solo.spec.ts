import { expect, test } from "@playwright/test";
import { answer, moveOn, playRun } from "./play.ts";

test("the day: ten questions, the result, the review, and one try only", async ({ page }) => {
  test.setTimeout(120_000);
  // The phone's share sheet, stood in for: what it was given is kept.
  await page.addInitScript(() => {
    navigator.share = async (data?: ShareData) => {
      (window as unknown as { shared: string }).shared = data?.text ?? "";
    };
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Десет въпроса за днес" })).toBeVisible();
  // A new player sees the day and the topics only: playing with others comes after a first game.
  await expect(page.locator(".topics").getByRole("link", { name: /История/ })).toBeVisible();
  await expect(page.locator(".modes")).toHaveCount(0);
  await expect(page.locator(".streak-chip")).toHaveCount(0);
  await page.getByRole("button", { name: "Започни" }).click();
  await playRun(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("от 10");
  // The day's goal is done, said once with its XP; what the game brought is a line, the level with it.
  await expect(page.locator(".goal.fresh").filter({ hasText: "Изиграй въпросите на деня" })).toContainText("+50 XP");
  // (A first day may well be a new level: then that's the card, with the XP.)
  await expect(page.locator(".news-xp, .level-card.up").first()).toContainText(/\+\d+ XP · /);
  // After the day, the other ways to play are right there: with others, and by topic.
  await expect(page.locator(".modes").getByRole("link", { name: /Дуел/ })).toBeVisible();
  await expect(page.locator(".topics").getByRole("link", { name: /История/ })).toBeVisible();
  // The result is shared without its answers: the date, the score, a square for each question, the site.
  await page.getByRole("button", { name: "Сподели" }).click();
  const shared = await page.evaluate(() => (window as unknown as { shared: string }).shared);
  expect(shared).toMatch(/^АЛМАНАХ · \d{1,2} \p{L}+\n\d+ от 10\n[🟩🟨🟥]{10}\nalmanac\.bg$/u);
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(page.locator(".reviewed")).toHaveCount(10);
  await page.reload();
  await expect(page.locator(".summary")).toBeVisible();
  await expect(page.getByRole("button", { name: "Започни" })).toHaveCount(0);
  await expect(page.locator(".modes")).toBeVisible();
  // The day's goal stays done. (The other two goals are drawn per day, and a run of the day can finish them too.)
  await expect(page.locator(".goal.done").filter({ hasText: "Изиграй въпросите на деня" })).toBeVisible();
  // Начало's top tells the streak and the level the day made.
  await expect(page.locator(".streak-chip")).toContainText("1");
  await expect(page.locator(".level-chip")).toContainText("Ниво");
  // Класации opens on the day's board, the player on it; the game put them in the week's league, racing on its XP;
  // the rating's board waits for ten rated games.
  await page.goto("/ranks");
  await expect(page.locator(".board .row.me")).toContainText("/10");
  await page.getByRole("tab", { name: "Лига" }).click();
  await expect(page.locator(".league-card")).toContainText("Странджа");
  await expect(page.locator(".league-board .row.me")).toContainText("XP");
  await page.getByRole("tab", { name: "Рейтинг" }).click();
  await expect(page.locator(".board-empty")).toContainText("Още никой няма 10 игри за рейтинг.");
  // Профил shows the league too, in a line that is a tap from the group.
  await page.goto("/me");
  await expect(page.locator(".league-link")).toContainText("място от");
  await page.locator(".league-link").click();
  await expect(page.locator(".league-board .row.me")).toBeVisible();
});

test("a topic, ten questions, a question reported, and ten more", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.locator(".topics").getByRole("link", { name: "История" }).click();
  // A short count first, then the game starts by itself.
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveAccessibleName(/Започва след [1-3] с/);
  await playRun(page);
  // A word about a question waits for the end, in the review.
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await page.getByRole("button", { name: "Нещо не е наред с въпроса?" }).first().click();
  await page.getByLabel("Какво не е наред?").fill("Отговорът е остарял.");
  await page.getByRole("button", { name: "Изпрати" }).click();
  await expect(page.getByText("Благодарим! Ще го прегледаме.")).toBeVisible();
  await page.getByRole("button", { name: "Още десет" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await expect(page.locator(".question-head")).toContainText("1 от 10");
});

test("a topic's count can be backed out of, or cut short", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Всички теми" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.getByRole("button", { name: "Откажи" }).click();
  await expect(page).toHaveURL(/\/$/);
  // Nothing started behind it.
  await page.waitForTimeout(3500);
  await expect(page).toHaveURL(/\/$/);

  await page.locator(".topics").getByRole("link", { name: "История" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);

  await page.locator(".topics").getByRole("link", { name: "История" }).click();
  await page.getByRole("button", { name: "Започни сега" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10", { timeout: 1500 });
});

test("a run left between two questions goes on at once", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Започни" }).click();
  await answer(page);
  await expect(page.locator(".verdict")).toBeVisible();
  await page.reload();
  // Back, the next question opens by itself: nothing waits for a button.
  await expect(page.locator(".question-head")).toContainText("2 от 10");
  await expect(page.getByRole("button", { name: /Напред|Продължи/ })).toHaveCount(0);
});

test("an old challenge link says where playing with friends went", async ({ page }) => {
  await page.goto("/c/abc234");
  await expect(page.getByRole("heading", { name: "Тази връзка вече не работи" })).toBeVisible();
  await page.getByRole("link", { name: "Към дуелите" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Дуел" })).toBeVisible();
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the keys play a topic, and Начало takes the width", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/play/history");
    // The count says its keys: Enter starts at once.
    await expect(page.getByRole("button", { name: "Започни сега" }).locator(".key-hint")).toHaveText("Enter");
    await page.keyboard.press("Enter");
    // An answer's mark is the key that gives it; the key answers, and Enter goes on at once.
    let keyed = false;
    for (let n = 0; n < 10; n++) {
      await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
      const options = page.locator("article.question .options:not(.pic-options) .option");
      if (!keyed && (await options.count()) === 4) {
        await expect(options.locator(".letter")).toHaveText(["1", "2", "3", "4"]);
        await page.keyboard.press("2");
        await expect(options.nth(1)).toHaveClass(/right|wrong/);
        await expect(page.locator(".up-next .key-hint")).toHaveText("Enter");
        await page.keyboard.press("Enter");
        keyed = true;
        continue;
      }
      await answer(page);
      await moveOn(page);
    }
    expect(keyed).toBe(true);
    await expect(page.locator(".summary")).toBeVisible({ timeout: 10_000 });
    // After a first game, Начало is two columns: the day and the topics, and beside them the ways to play.
    await page.goto("/");
    const day = await page.locator(".home-main").boundingBox();
    const side = await page.locator(".home-side .modes").boundingBox();
    const topics = await page.locator(".topics").boundingBox();
    expect(side && day && side.x > day.x + day.width).toBe(true);
    expect(topics && day && topics.y > day.y + day.height && Math.abs(topics.x - day.x) < 1).toBe(true);
    // Ten topics, five to a row: none alone in a row.
    const rows = await page
      .locator(".topics li:not(.topic-all)")
      .evaluateAll((li) => new Set(li.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    expect(rows).toBe(2);
  });
});

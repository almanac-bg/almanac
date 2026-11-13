import { expect, test } from "@playwright/test";
import { answer, playRun } from "./play.ts";

test("the day: ten questions, the result, the review, and one try only", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Десет въпроса за днес" })).toBeVisible();
  await page.getByRole("button", { name: "Започни" }).click();
  await playRun(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("от 10");
  // The day's goal is done, said once with its XP.
  await expect(page.locator(".goal.fresh").filter({ hasText: "Изиграй въпросите на деня" })).toContainText("+100 XP");
  await expect(page.locator(".modes").getByRole("link", { name: /Теми/ })).toBeVisible();
  await page.getByRole("button", { name: "Въпросите, отговорите и „Знаеше ли?“" }).click();
  await expect(page.locator(".reviewed")).toHaveCount(10);
  await page.reload();
  await expect(page.locator(".summary")).toBeVisible();
  await expect(page.getByRole("button", { name: "Започни" })).toHaveCount(0);
  // The day's goal stays done. (The other two goals are drawn per day, and a run of the day can finish them too.)
  await expect(page.locator(".goal.done").filter({ hasText: "Изиграй въпросите на деня" })).toBeVisible();
  // The XP shows on the board of levels; the season's board waits for ten rated games.
  await page.goto("/ranks");
  await expect(page.locator(".season-card")).toContainText("0 от 10");
  await page.getByRole("tab", { name: "Ниво" }).click();
  await expect(page.locator(".board .row.me")).toContainText("ниво");
  await page.getByRole("tab", { name: "Приятели" }).click();
  await expect(page.locator(".board .row.me")).toBeVisible();
});

test("a topic, ten questions, a question reported, and ten more", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/play");
  await page.getByRole("link", { name: "История" }).click();
  await playRun(page);
  // A word about a question waits for the end, in the review.
  await page.getByRole("button", { name: "Въпросите, отговорите и „Знаеше ли?“" }).click();
  await page.getByRole("button", { name: "Нещо не е наред с въпроса?" }).first().click();
  await page.getByLabel("Какво не е наред?").fill("Отговорът е остарял.");
  await page.getByRole("button", { name: "Изпрати" }).click();
  await expect(page.getByText("Благодарим! Ще го прегледаме.")).toBeVisible();
  await page.getByRole("button", { name: "Още десет" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10");
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
  await expect(page.getByRole("heading", { name: "Предизвикателствата ги няма" })).toBeVisible();
  await page.getByRole("link", { name: "Към дуелите" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Дуел" })).toBeVisible();
});

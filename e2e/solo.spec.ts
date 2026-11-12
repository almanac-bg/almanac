import { expect, test } from "@playwright/test";
import { answer, playRun } from "./play.ts";

test("the day: ten questions, the result, the review, and one try only", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Десет въпроса за днес" })).toBeVisible();
  await page.getByRole("button", { name: "Започни" }).click();
  await playRun(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("от 10");
  await expect(page.getByRole("button", { name: "Сподели резултата" })).toBeVisible();
  await page.getByRole("button", { name: "Виж въпросите и отговорите" }).click();
  await expect(page.locator(".reviewed")).toHaveCount(10);
  await page.reload();
  await expect(page.locator(".summary")).toBeVisible();
  await expect(page.getByRole("button", { name: "Започни" })).toHaveCount(0);
});

test("a topic, ten questions, and ten more", async ({ page }) => {
  await page.goto("/play");
  await page.getByRole("link", { name: "История" }).click();
  await playRun(page);
  await page.getByRole("button", { name: "Още десет" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10");
});

test("a question can be reported", async ({ page }) => {
  await page.goto("/play/science");
  await answer(page);
  await page.getByRole("button", { name: "Нещо не е наред с въпроса?" }).click();
  await page.getByLabel("Какво не е наред?").fill("Отговорът е остарял.");
  await page.getByRole("button", { name: "Изпрати" }).click();
  await expect(page.getByText("Благодарим! Ще го прегледаме.")).toBeVisible();
});

test("a challenge from Заедно: ten questions, the link, and a friend takes it", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await page.goto("/together");
  await page.getByRole("link", { name: "Предизвикай" }).click();
  await playRun(page);
  await expect(page.getByRole("button", { name: "Изпрати предизвикателството" })).toBeVisible();
  const link = await page.locator(".challenge-link").getAttribute("href");
  expect(link).toMatch(/^\/c\/[a-z0-9]{6}$/);
  const friend = await (await browser.newContext()).newPage();
  await friend.goto(link ?? "");
  await expect(friend.getByRole("heading", { name: /те предизвиква/ })).toBeVisible();
  await friend.getByRole("button", { name: "Приеми" }).click();
  await expect(friend.locator(".question-head")).toContainText("1 от 10");
});

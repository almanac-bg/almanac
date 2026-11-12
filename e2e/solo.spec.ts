import { expect, test } from "@playwright/test";
import { answer, playRun } from "./play.ts";

test("the day: ten questions, the result, the review, and one try only", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Десет въпроса за днес" })).toBeVisible();
  await page.getByRole("button", { name: "Започни" }).click();
  await playRun(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("от 10");
  await expect(page.getByRole("link", { name: "Играй по теми" })).toBeVisible();
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

test("an old challenge link says where playing with friends went", async ({ page }) => {
  await page.goto("/c/abc234");
  await expect(page.getByRole("heading", { name: "Предизвикателствата ги няма" })).toBeVisible();
  await page.getByRole("link", { name: "Към Заедно" }).click();
  await expect(page.getByRole("heading", { name: "Заедно" })).toBeVisible();
});

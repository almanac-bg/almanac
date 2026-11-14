import { expect, test } from "@playwright/test";
import { playRun } from "./play.ts";

test("a year in the game: one card at a time, from the days played to the XP, and a few lines to share", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/play/history");
  await playRun(page);

  await page.goto("/year/2026");
  const story = page.locator(".year-story");
  await expect(story).toContainText("Твоята 2026");
  await expect(page.locator(".year-pips li.on")).toHaveCount(1);
  await page.getByRole("button", { name: "Напред" }).click();
  await expect(story).toContainText("Дни игра");
  await expect(page.locator(".year-pips li.on")).toHaveCount(2);
  await page.getByRole("button", { name: "Напред" }).click();
  await expect(story).toContainText("Отговори");
  await expect(story).toContainText("% от тях верни");
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(story).toContainText("Дни игра");
  // On to the end: the year's XP, and its lines to share.
  while (await page.getByRole("button", { name: "Напред" }).isVisible()) {
    await page.getByRole("button", { name: "Напред" }).click();
  }
  await expect(story).toContainText("XP за годината");
  await expect(page.getByRole("button", { name: "Сподели годината" })).toBeVisible();
  // (Начало and Профил open it from 15 December: lib/year.test.ts.)
});

import { expect, test } from "@playwright/test";
import { openGame, playRun } from "./play.ts";

test("a year in the game: one card at a time, from the days played to the XP, and a few lines to share", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // No share sheet here: a share is copied.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } });
  });
  await openGame(page, "/play/history");
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
  // On a computer too, „Напред“ keeps its place and „Назад“ is under it, never on its right.
  await page.setViewportSize({ width: 1280, height: 800 });
  const on = await page.getByRole("button", { name: "Напред" }).boundingBox();
  const back = await page.getByRole("button", { name: "Назад" }).boundingBox();
  expect(on && back && back.x === on.x && back.y > on.y).toBe(true);
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(story).toContainText("Дни игра");
  // On to the end: the year's XP, and its lines to share.
  while (await page.getByRole("button", { name: "Напред" }).isVisible()) {
    await page.getByRole("button", { name: "Напред" }).click();
  }
  await expect(story).toContainText("XP за годината");
  // Shared where there's no share sheet: copied, said on a row of its own, „Към Начало“ beside it as tall as before.
  const home = page.getByRole("link", { name: "Към Начало" });
  const tall = (await home.boundingBox())?.height;
  await page.getByRole("button", { name: "Сподели годината" }).click();
  await expect(page.locator(".actions").getByText("Копирано.")).toBeVisible();
  expect((await home.boundingBox())?.height).toBe(tall);
  // (Начало and Профил open it from 15 December: lib/year.test.ts.)
});

import { expect, test } from "@playwright/test";
import { daysPlayed, playRun, startDay } from "./play.ts";

test("a player who comes back: the day played one short card, and every game a tap away", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await daysPlayed(page, 1);
  await page.reload();
  await startDay(page);
  await playRun(page);
  // Just played: the result in full.
  await expect(page.locator(".summary")).toBeVisible();
  // A later visit: one short card, another game the gold thing to do, the questions on their page.
  await page.reload();
  const card = page.locator(".day-done");
  await expect(card).toBeVisible();
  await expect(page.locator(".summary")).toHaveCount(0);
  await expect(card.locator(".trail")).toBeVisible();
  const gold = page.locator(".btn.primary");
  await expect(gold).toHaveCount(1);
  await expect(gold).toHaveText("Още десет");

  await card.getByRole("link", { name: "Прегледай въпросите" }).click();
  await expect(page).toHaveURL(/\/games\/\d+$/);
  await expect(page.locator(".review")).toBeVisible();
  // Every game, by day: the day's ten by their issue.
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "Всички игри" })).toBeVisible();
  await expect(page.locator(".game-what").first()).toHaveText(/^Брой \d+$/);
  await page.getByRole("tab", { name: "Теми" }).click();
  await expect(page.getByText("Още няма такива игри.")).toBeVisible();
  await expect(page).toHaveURL(/\/games#topic$/);
});

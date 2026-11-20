import { expect, test } from "@playwright/test";
import { daysPlayed, playRun, startDay } from "./play.ts";

test("a player who comes back: the day played one short card, its questions a tap away", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await daysPlayed(page, 1);
  await page.reload();
  await startDay(page);
  await playRun(page);
  // Just played: the result in full.
  await expect(page.locator(".summary")).toBeVisible();
  // A later visit: the result as it is (no moment, no news), sharing it the gold thing to do, the questions a tap
  // away under it.
  await page.reload();
  const card = page.locator(".result");
  await expect(card).toBeVisible();
  await expect(page.locator(".news-open")).toHaveCount(0);
  await expect(card.locator(".tiles")).toBeVisible();
  const gold = page.locator(".btn.primary");
  await expect(gold).toHaveCount(1);
  await expect(gold).toHaveText("Сподели");

  await card.getByRole("button", { name: "Въпросите и фактите" }).click();
  await expect(page.locator(".review .reviewed")).toHaveCount(10);
});

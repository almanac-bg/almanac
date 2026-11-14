import { expect, test } from "@playwright/test";
import { answer, playRun } from "./play.ts";

test("a second chance: the questions missed come back, from Начало and from the Almanac", async ({ page }) => {
  test.setTimeout(180_000);
  // Two topic games of first answers: plenty of them wrong.
  await page.goto("/play/science");
  await playRun(page);
  await page.getByRole("button", { name: "Още десет" }).click();
  await playRun(page);

  // After the wait (seconds here, three days in the game), they wait for a second chance.
  const card = page.locator(".second-chance");
  await expect(async () => {
    await page.goto("/almanac");
    await expect(card).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(card).toContainText(/\d+ въпроса, на които сгреши, чакат нов опит/);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Втори шанс/ })).toContainText(/\d+ въпроса, на които сгреши/);

  await page.goto("/almanac");
  await page.getByRole("link", { name: "Опитай пак" }).click();
  await expect(page).toHaveURL(/\/mistakes$/);
  const head = page.locator(".question-head");
  await expect(head).toContainText(/1 от \d+/, { timeout: 10_000 });
  const total = Number((await head.textContent())?.match(/от (\d+)/)?.[1]);
  expect(total).toBeGreaterThanOrEqual(5);
  for (let n = 0; n < total; n++) {
    await expect(head).toContainText(`${n + 1} от ${total}`, { timeout: 10_000 });
    await answer(page);
    await expect(page.locator(".verdict")).toBeVisible();
  }
  await expect(page.locator(".summary")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".kicker", { hasText: "Втори шанс" })).toBeVisible();
});

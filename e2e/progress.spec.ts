import { expect, test } from "@playwright/test";
import { playRun } from "./play.ts";

test("progress: a game's level, the achievements, and a look of one's own", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/play/history");
  await playRun(page);
  await expect(page.locator(".level-card")).toContainText("Ниво");

  await page.goto("/rewards");
  await expect(page.getByRole("heading", { name: /Постижения · \d+ от 19/ })).toBeVisible();
  // By tier, each with how it's earned; every title, the locked ones with what unlocks them.
  await expect(page.getByRole("heading", { name: "Легендарни · 0 от 3" })).toBeVisible();
  await expect(page.locator(".achievement", { hasText: "Петдесет победи" })).toContainText("Спечели петдесет дуела.");
  await expect(page.locator(".title-pick.locked", { hasText: "Сто дни" })).toContainText(
    "Отключва се: играй въпросите на деня сто дни поред.",
  );
  await page.getByRole("button", { name: "Луна", exact: true }).click();
  await expect(page.getByRole("button", { name: "Луна", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Корона, заключена" }).click();
  await expect(page.getByText("Короната се отключва на ниво 10.")).toBeVisible();

  // Sounds are on until turned off, and stay off on this device.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Изключи звуците" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Включи звуците" })).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { playRun } from "./play.ts";

test("progress: a game's level, the achievements, and a look of one's own", async ({ page }) => {
  await page.goto("/play/history");
  await playRun(page);
  await expect(page.locator(".level-card")).toContainText("Ниво");

  await page.goto("/me");
  await expect(page.getByRole("heading", { name: /Постижения · \d+ от 19/ })).toBeVisible();
  await page.getByRole("button", { name: "Луна", exact: true }).click();
  await expect(page.getByRole("button", { name: "Луна", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Корона, заключена" }).click();
  await expect(page.getByText("Короната се отключва на ниво 10.")).toBeVisible();

  // Sounds are on until turned off, and stay off on this device.
  await page.getByRole("button", { name: "Изключи звуците" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Включи звуците" })).toBeVisible();
});

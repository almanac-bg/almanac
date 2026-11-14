import { expect, test } from "@playwright/test";
import { playRun } from "./play.ts";

test("progress: a game's level, the achievements, and a look of one's own", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/play/history");
  await playRun(page);
  // What the game brought is a line (a level card only for a new level), and „Ново за теб“ tells the rest: how the
  // topic is known now, and everything the game unlocked, each a tap from being worn.
  await expect(page.locator(".news-xp, .level-card.up").first()).toContainText(/[Нн]иво \d+/);
  await expect(page.locator(".unlocks")).toContainText("Ново за теб");
  await expect(page.locator(".unlocks .mastery-line")).toContainText("История");
  const unlocked = page.locator(".unlocks .unlock-row", { hasText: "Титла „Нова искра“" });
  await expect(unlocked).toContainText("С ниво 1.");
  await unlocked.getByRole("button", { name: "Сложи: титла „Нова искра“" }).click();
  await expect(unlocked).toContainText("Сложено");

  await page.goto("/rewards");
  await expect(page.getByRole("heading", { name: /Постижения · \d+ от 31/ })).toBeVisible();
  // By tier, each with how it's earned; every title, the locked ones with what unlocks them.
  await expect(page.getByRole("heading", { name: "Легендарни · 0 от 3" })).toBeVisible();
  await expect(page.locator(".achievement", { hasText: "Петдесет победи" })).toContainText("Спечели петдесет дуела.");
  // Progress towards a goal, a reward in sight, and the hidden ones kept secret.
  await expect(page.locator(".achievement", { hasText: "Сто отговора" })).toContainText(/\d+ \/ 100/);
  // Each earns XP, and some more: only what's new to the player (the flame is the first streak's).
  await expect(page.locator(".achievement", { hasText: "Сто отговора" })).toContainText(
    "Награда: +50 XP · аватар „Книга“",
  );
  await expect(page.locator(".achievement", { hasText: "Цял месец" })).toContainText(
    "Награда: +400 XP · титла „Неугасим пламък“ · рамка „Пламъци“",
  );
  await expect(page.getByText("Първото епично постижение отключва фон „Лъчи“.")).toBeVisible();
  await expect(page.locator(".achievement", { hasText: /скрит/i }).first()).toContainText("ще разбереш");

  // Гардероб, a tap away in Профил: the avatar first, the titles a tab away, the locked ones folded.
  await page.getByRole("navigation", { name: "Профил" }).getByRole("link", { name: "Гардероб" }).click();
  await page.getByRole("tab", { name: "Титла" }).click();
  await page.getByText(/Още \d+ за отключване/).click();
  await expect(page.locator(".title-pick.locked", { hasText: "Сто изгрева" })).toContainText(
    "Отключва се: играй въпросите на деня сто дни поред.",
  );
  await page.getByRole("tab", { name: "Аватар" }).click();
  await page.getByRole("button", { name: "Таралеж", exact: true }).click();
  await expect(page.getByRole("button", { name: "Таралеж", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Avatars are pictures (art/pictures.ts), loaded after the first screen: the hedgehog is drawn on its tile.
  await expect(page.locator('.pick[aria-pressed="true"] .avatar-pic path').first()).toBeAttached();
  await page.getByRole("button", { name: "Корона, заключено" }).click();
  await expect(page.getByText("Короната се отключва на ниво 10.")).toBeVisible();

  // Sounds are on until turned off, and stay off on this device.
  await page.goto("/settings");
  await expect(page.getByRole("switch", { name: "Звуци" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: "Звуци" }).click();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Звуци" })).toHaveAttribute("aria-checked", "false");

  // Достъпност: bigger text and less motion stay on this device too.
  await page.getByRole("switch", { name: "По-едър текст" }).click();
  await expect(page.getByRole("switch", { name: "По-едър текст" })).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/big-text/);
});

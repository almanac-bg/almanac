import { expect, test } from "@playwright/test";
import { earnedUntold, playedBefore, playRun } from "./play.ts";

test("progress: a game's level, the achievements, and a look of one's own", async ({ page }) => {
  test.setTimeout(120_000);
  // A player on their second day played, who has met XP (play/unfold.go: a first day's news has none).
  await page.goto("/");
  await playedBefore(page, 1);
  // An achievement („Точно в целта“: a number to the unit) earned and not told yet: its avatar comes with this news.
  // (The first level's title isn't news: everyone has it from the start.)
  await earnedUntold(page, "exact");
  await page.goto("/play/history");
  await playRun(page);
  // What the game brought is a line (a level card only for a new level), and „Ново за теб“ tells the rest: how the
  // topic is known now, and everything the game unlocked, each a tap from being worn.
  await expect(page.locator(".news-xp, .level-card.up").first()).toContainText(/[Нн]иво \d+/);
  await expect(page.locator(".unlocks")).toContainText("Ново за теб");
  await expect(page.locator(".unlocks .mastery-line")).toContainText("История");
  // Three rows at most (the highest tier first; the hour may add „След полунощ“), the rest a tap away.
  expect(await page.locator(".unlocks .unlock-row").count()).toBeLessThanOrEqual(3);
  await page
    .locator(".unlocks")
    .getByRole("button", { name: /^Сложи: / })
    .first()
    .click();
  await expect(page.locator(".unlocks").getByRole("status")).toHaveText("Сложено");

  await page.goto("/rewards");
  // A second day's: XP and the goals are met, the league isn't, so its three achievements wait (play/unfold.go).
  await expect(page.getByRole("heading", { name: /Постижения · \d+ от 30/ })).toBeVisible();
  await expect(page.locator(".how")).not.toContainText("Лиги");
  // The nearest to done and the earned ones first; the rest by tier a tap away, each in full: how it's earned, how
  // far along, what it gives.
  await expect(page.getByRole("heading", { name: "Най-близо" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Легендарни/ })).toBeHidden();
  await page.getByText(/^Всички постижения \(\d+\)$/).click();
  await expect(page.getByRole("heading", { name: "Легендарни · 0 от 6" })).toBeVisible();
  const row = (name: string) => page.locator(".achievement", { hasText: name }).last();
  await expect(row("Петдесет победи")).toContainText("Спечели петдесет дуела.");
  // Progress towards a goal (a bar, no ring), a reward in sight, and the hidden ones kept secret.
  const hundred = row("Сто факта");
  await expect(hundred).toContainText(/\d+ \/ 100/);
  await expect(hundred.locator(".meter")).toBeVisible();
  await expect(page.locator(".badge-ring")).toHaveCount(0);
  // Each earns XP, and some more: only what's new to the player (the flame is the first streak's).
  await expect(hundred).toContainText("Награда: +50 XP · аватар „Книга“");
  await expect(row("Цял месец")).toContainText("Награда: +400 XP · титла „Неугасим пламък“ · рамка „Пламъци“");
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

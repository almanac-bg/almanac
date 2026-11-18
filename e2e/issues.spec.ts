import { expect, test } from "@playwright/test";
import { pastIssue, playRun } from "./play.ts";

test("a past issue: from Начало's first tile, played once, outside the streak, told against its day's players", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  // Two days ago: twelve played it then, from none right to all (and one again).
  const past = await pastIssue(page, 2, 12);
  expect(past.issue).toBeGreaterThan(0);
  await page.reload();
  const tile = page.locator(".topics li").first();
  await expect(tile).toContainText("Минали броеве");
  await tile.getByRole("link").click();
  await expect(page).toHaveURL(/\/issues$/);
  await expect(page.getByText("Минал брой: не влиза в серията и в лигата.")).toBeVisible();
  const row = page.locator(".issues-list a.game").filter({ hasText: `Брой ${past.issue}` });
  await expect(row).toContainText("Изиграй");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/issues/${past.issue}$`));
  await page.getByRole("button", { name: "Започни сега" }).click();
  await playRun(page);
  // Its result: what it was, that it counts for nothing of the day's, and how it went against the day's players.
  const summary = page.locator(".summary");
  await expect(summary.locator(".day-line .kicker")).toContainText(`Брой ${past.issue} · `);
  await expect(summary).toContainText("Минал брой: не влиза в серията и в лигата.");
  await expect(summary.locator(".crowd-says").filter({ hasText: "Средно на този брой:" })).toBeVisible();
  // Played once: back to it, its result again, never a second game.
  await page.goto(`/issues/${past.issue}`);
  await expect(page.locator(".summary")).toBeVisible();
  await expect(page.getByRole("button", { name: "Започни" })).toHaveCount(0);
  await page.goto("/issues");
  await expect(page.locator(".issues-list a.game").filter({ hasText: `Брой ${past.issue}` })).toContainText(" от ");
  // No streak of it: Начало still has the day's ten to start one.
  await page.goto("/");
  await expect(page.locator(".streak-chip")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Започни", exact: true })).toBeVisible();
});

test("an issue not out yet says so; the game of every topic is gone", async ({ page }) => {
  await page.goto("/");
  const today = await page.evaluate(async () => ((await (await fetch("/api/day")).json()) as { issue: number }).issue);
  await page.goto(`/issues/${today}`);
  await expect(page.getByText("Този брой още не е минал.", { exact: false })).toBeVisible();
  await page.goto("/play/all");
  await expect(page.locator(".question-head")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Приготви се" })).toHaveCount(0);
});

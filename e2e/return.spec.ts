import { expect, test } from "@playwright/test";
import { daysPlayed, playRun, startDay } from "./play.ts";

/** Whether yesterday's board is final by now: a quarter of an hour and a question's time after midnight in Bulgaria. */
function yesterdaySettled(): boolean {
  const [h = 0, m = 0] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Sofia",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date())
    .split(":")
    .map(Number);
  return h > 0 || m >= 20;
}

test("a player who comes back: yesterday told, the day played one short card, and every game a tap away", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await daysPlayed(page, 1);
  await page.reload();
  // While today's ten wait: how yesterday ended, a way to its final board and its winner.
  if (yesterdaySettled()) {
    const line = page.locator(".yesterday-line");
    await expect(line).toContainText(/^Вчера: 0 от 10 · Как завърши брой \d+$/);
    await line.getByRole("link").click();
    await expect(page).toHaveURL(/\/ranks#yesterday$/);
    await expect(page.getByRole("tab", { name: "Вчера" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".board-winner")).toContainText(/^Брой \d+ спечели .+: 0 от 10 за \d+ сек\.$/);
    await page.goto("/");
  }
  await startDay(page);
  await playRun(page);
  // Just played: the result in full.
  await expect(page.locator(".summary")).toBeVisible();
  await expect(page.locator(".yesterday-line")).toHaveCount(0);
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

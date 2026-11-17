// What goes wrong is never a dead end: a screen that can't load says why, offers „Опитай пак“ where trying again can
// help (and tries again by itself as the line comes back), and a way on; a run offline keeps its clock and its frame.
import { expect, test } from "@playwright/test";
import { answer, moveOn, openGame } from "./play.ts";

test("Начало and Класации that can't load try again, by a tap or as the line comes back", async ({ page }) => {
  await page.route("**/api/day", (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Няма връзка");
  await page.unroute("**/api/day");
  await page.getByRole("button", { name: "Опитай пак" }).click();
  await expect(page.locator(".card.day")).toBeVisible();

  await page.goto("/ranks");
  await page.context().setOffline(true);
  await page.getByRole("tab", { name: "Знания" }).click();
  await expect(page.getByRole("button", { name: "Опитай пак" })).toBeVisible();
  // The line back: the board comes by itself.
  await page.context().setOffline(false);
  await expect(page.getByRole("button", { name: "Опитай пак" })).toBeHidden();
  await expect(page.locator(".board, .board-empty").first()).toBeVisible();
});

test("a page that isn't there says so, with a way on", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => fetch("/api/guest", { method: "POST", body: "{}" }));
  await page.goto("/duel/friend/999999");
  await expect(page.getByText("с този играч още не сте приятели")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toHaveCount(0);
  await page.getByRole("link", { name: "Към приятелите" }).click();
  await expect(page).toHaveURL(/\/friends$/);

  await page.goto("/year/1999");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Опитай пак" })).toHaveCount(0); // no line would make 1999 come
  await expect(page.getByRole("link", { name: "Към Профил" })).toBeVisible();
});

test("a run offline: the clock runs on while the answer is sent, and the run keeps its frame", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await openGame(page, "/play/history");
  const q = page.locator("article.question");
  await expect(q.locator(".question-head")).toContainText("1 от 10");
  // An answer tapped offline: the clock isn't stopped, and once the quiet tries are over, it says so under the question.
  await context.setOffline(true);
  await answer(page);
  await expect(q.locator(".timer")).not.toHaveClass(/stopped/);
  await expect(q.getByRole("alert")).toContainText("Няма връзка", { timeout: 10_000 });
  await expect(q.locator(".question-head")).toBeVisible();
  // The line back: the answer goes by itself.
  await context.setOffline(false);
  await expect(page.locator(".verdict")).toBeVisible({ timeout: 10_000 });
  // Moving on offline: the run's frame stays, its head and arrow, and it goes on as the line comes back.
  await expect(page.locator(".after .up-next")).toBeVisible();
  await context.setOffline(true);
  await moveOn(page);
  await expect(page.getByRole("alert")).toContainText("Няма връзка", { timeout: 10_000 });
  await expect(page.getByRole("link", { name: "Към Начало", exact: true })).toBeVisible();
  await expect(page.locator(".question-head")).toContainText("2 от 10");
  await context.setOffline(false);
  await expect(page.locator("article.question h1.ask")).toBeVisible({ timeout: 10_000 });
});

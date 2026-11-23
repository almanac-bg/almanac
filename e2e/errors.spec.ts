// What goes wrong is never a dead end: a screen that can't load says why, offers „Опитай пак“ where trying again can
// help (and tries again by itself as the line comes back), and a way on; a run offline keeps its clock and its frame.
import { expect, test } from "@playwright/test";
import { answer, moveOn, openGame } from "./play.ts";

test("Днес that can't load tries again, by a tap", async ({ page }) => {
  // Днес's page comes with the day in it: the day is asked for when Днес is opened from another screen. (A player:
  // a new visitor's cover has no places.)
  await page.goto("/");
  await page.evaluate(() => fetch("/api/guest", { method: "POST", body: "{}" }));
  await page.reload();
  await expect(page.locator(".issue")).toBeVisible();
  await page.route("**/api/day", (route) => route.abort("internetdisconnected"));
  await page.locator("nav.places-foot").getByRole("link", { name: "Приятели" }).click();
  await page.locator("nav.places-foot").getByRole("link", { name: "Днес" }).click();
  await expect(page.getByRole("alert")).toContainText("Няма връзка");
  await page.unroute("**/api/day");
  await page.getByRole("button", { name: "Опитай пак" }).click();
  await expect(page.locator(".issue")).toBeVisible();
});

test("a page that isn't there says so, with a way on", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => fetch("/api/guest", { method: "POST", body: "{}" }));
  // An old link of something the game no longer has (a challenge's): said so, with the way to the day.
  await page.goto("/c/abc234");
  await expect(page.getByRole("heading", { name: "Няма такава страница" })).toBeVisible();

  // A chapter the game doesn't have (an old link): said so, not a blank page.
  await page.goto("/play/nothing");
  await expect(page.getByRole("heading", { name: "Няма такава страница" })).toBeVisible();
  await page.getByRole("link", { name: "Към днешния брой" }).click();
  await expect(page.locator(".issue")).toBeVisible();
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
  await expect(page.getByRole("link", { name: "Към Днес", exact: true })).toBeVisible();
  await expect(page.locator(".question-head")).toContainText("2 от 10");
  await context.setOffline(false);
  await expect(page.locator("article.question h1.ask")).toBeVisible({ timeout: 10_000 });
});

test("an answer tried again offline, by hand and as the line comes back, goes once; its verdict shows", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  // The answers that reached the server, by their status.
  const answers: number[] = [];
  page.on("response", (r) => {
    if (/\/api\/runs\/\d+\/answer$/.test(r.url())) answers.push(r.status());
  });
  await openGame(page, "/play/history");
  const q = page.locator("article.question");
  await expect(q.locator(".question-head")).toContainText("1 от 10");
  // Offline: the answer, and „Опитай пак“ tapped twice while the line is still out.
  await context.setOffline(true);
  await answer(page);
  const again = q.getByRole("button", { name: "Опитай пак" });
  for (let i = 0; i < 2; i++) {
    await expect(again).toBeVisible({ timeout: 10_000 });
    await again.click();
  }
  await expect(again).toBeVisible({ timeout: 10_000 });
  // The line back: the answer goes once, and its verdict shows, on its own question.
  await context.setOffline(false);
  await expect(page.locator(".verdict")).toBeVisible({ timeout: 10_000 });
  await expect(q.locator(".question-head")).toContainText("1 от 10");
  // The line drops and comes back once more: nothing goes again, nothing moves on early.
  await context.setOffline(true);
  await context.setOffline(false);
  await page.waitForTimeout(1000);
  await expect(page.locator(".verdict")).toBeVisible();
  await expect(q.locator(".question-head")).toContainText("1 от 10");
  expect(answers).toEqual([200]);
  await moveOn(page);
  await expect(page.locator(".question-head")).toContainText("2 от 10", { timeout: 10_000 });
  expect(answers).toEqual([200]);
});

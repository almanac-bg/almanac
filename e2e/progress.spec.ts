import { expect, test } from "@playwright/test";
import { openGame, playedBefore, playRun, startDay } from "./play.ts";

test("a topic's game tells how well the topic is known, and the avatar is anyone's to choose", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await playedBefore(page, 1);
  await openGame(page, "/play/history");
  await playRun(page);
  // Ten answers in a topic are its first estimate: told under the result, quietly. Nothing about XP, levels or
  // achievements: the game has none (DECISIONS.md, „The redesign“).
  await expect(page.locator(".mastery-line")).toContainText("История");
  await expect(page.locator(".mastery-line")).toContainText("Първа оценка");
  await expect(page.locator(".screen")).not.toContainText(/XP|[Нн]иво \d|[Пп]остижени/);

  // The avatar, a tap from Профил: every animal and every colour, none locked.
  await page.goto("/me");
  await page.getByRole("link", { name: "Смени аватара" }).first().click();
  await expect(page).toHaveURL(/\/avatar$/);
  await expect(page.locator(".pick")).toHaveCount(15);
  await expect(page.locator(".tone-pick")).toHaveCount(6);
  await page.getByRole("button", { name: "Рис", exact: true }).click();
  await expect(page.getByRole("button", { name: "Рис", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Цвят: мента" }).click();
  await expect(page.getByRole("button", { name: "Цвят: мента" })).toHaveAttribute("aria-pressed", "true");
  // Avatars are pictures (art/pictures.ts), loaded after the first screen: the lynx is drawn on its tile.
  await expect(page.locator('.pick[aria-pressed="true"] .avatar-pic path').first()).toBeAttached();
  // Kept: Профил shows it.
  await page.goto("/me");
  await expect(page.locator(".me-head .avatar.sh-lynx.tone-mint")).toBeVisible();

  // Sounds are on until turned off, and stay off on this device.
  await page.goto("/settings");
  await expect(page.getByRole("switch", { name: "Звуци" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: "Звуци" }).click();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Звуци" })).toHaveAttribute("aria-checked", "false");

  // Достъпност: less motion and the text's size stay on this device too (the sizes: text.spec.ts).
  await page.getByRole("switch", { name: "По-малко движение" }).click();
  await page.getByRole("radio", { name: "Едър", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/calm/);
  await expect(page.getByRole("radio", { name: "Едър", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("just played, a right answer few others got is told in gold", async ({ page }) => {
  test.setTimeout(120_000);
  // The day as the server would have it with others playing: the right answer a tenth of the others got, told (as
  // the server does) only once the day is played.
  await page.route("**/api/day", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const t = await res.json();
    if (t.run?.done) t.rarest = { n: 0, right: 0.1 };
    await route.fulfill({ response: res, json: t });
  });
  await page.goto("/");
  await startDay(page);
  await playRun(page);
  await expect(page.locator(".summary .crowd-says.rare")).toHaveText(
    "Позна въпрос 1: днес го знаят само 10% от играчите.",
  );
  await expect(page.locator(".summary .btn.primary")).toHaveCount(1);
});

test("after the day: one gold thing to do next, and Профил leading back to play", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await playedBefore(page, 1);
  await page.reload();
  await startDay(page);
  await playRun(page);
  // One gold action: another game.
  const gold = page.locator(".btn.primary");
  await expect(gold).toHaveCount(1);
  await expect(gold).toHaveText("Още десет");
  // The topic played least: the day's ten touch every topic once, so the bank's first of them.
  await expect(gold).toHaveAttribute("href", /^\/play\/[a-z]+$/);
  await expect(page.locator(".open-goals, .goal")).toHaveCount(0);

  // A topic, then Профил: the topic known leads back to it, the games played to going over them.
  await openGame(page, "/play/history");
  await playRun(page);
  await page.goto("/me");
  await expect(page.locator(".mastery-row a.mastery-topic", { hasText: "История" })).toHaveAttribute(
    "href",
    "/play/history",
  );
  await page.locator("a.game").first().click();
  await expect(page).toHaveURL(/\/games\/\d+$/);
  await expect(page.locator(".day-line")).toContainText("История");
  await expect(page.locator(".reviewed")).toHaveCount(10);
  await page.getByRole("link", { name: "Профил" }).first().click();
  await expect(page).toHaveURL(/\/me$/);
});

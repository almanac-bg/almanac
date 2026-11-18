import { expect, test } from "@playwright/test";
import { earnedUntold, openGame, playedBefore, playRun, startDay } from "./play.ts";

test("progress: a game's level, the achievements, and a look of one's own", async ({ page }) => {
  test.setTimeout(120_000);
  // A player on their second day played, who has met XP (play/unfold.go: a first day's news has none).
  await page.goto("/");
  await playedBefore(page, 1);
  // An achievement („Точно в целта“: a number to the unit) earned and not told yet: its avatar comes with this news.
  // (The first level's title isn't news: everyone has it from the start.)
  await earnedUntold(page, "exact");
  await openGame(page, "/play/history");
  await playRun(page);
  // What the game brought is a line (a level card only for a new level), and „Ново за теб“ tells the rest: how the
  // topic is known now, and everything the game unlocked, each a tap from being worn.
  await expect(page.locator(".news-xp, .level-card.up").first()).toContainText(/[Нн]иво \d+/);
  await expect(page.locator(".unlocks")).toContainText("Ново за теб");
  await expect(page.locator(".unlocks .mastery-line")).toContainText("История");
  // Three rows at most (the highest tier first; the hour may add „След полунощ“), the rest a tap away.
  expect(await page.locator(".unlocks .unlock-row").count()).toBeLessThanOrEqual(3);
  // A new level that unlocks something comes in its sheet once the result has landed (the goals and achievements the
  // game earned may make one): put away for later.
  await page.waitForTimeout(2500);
  const later = page.getByRole("dialog").getByRole("button", { name: "По-късно" });
  if (await later.isVisible()) await later.click();
  await page
    .locator(".unlocks")
    .getByRole("button", { name: /^Сложи: / })
    .first()
    .click();
  await expect(page.locator(".unlocks").getByRole("status")).toHaveText("Сложено");

  await page.goto("/rewards");
  // A second day's: XP and the goals are met, the league isn't, so its three achievements wait (play/unfold.go).
  await expect(page.getByRole("heading", { name: /Постижения · \d+ от 31/ })).toBeVisible();
  await expect(page.locator(".how")).not.toContainText("Лиги");
  // The nearest to done and the earned ones first; the rest by tier a tap away, each in full: how it's earned, how
  // far along, what it gives.
  await expect(page.getByRole("heading", { name: "Най-близо" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Легендарни/ })).toBeHidden();
  await page.getByText(/^Останалите постижения \(\d+\)$/).click();
  await expect(page.getByRole("heading", { name: "Легендарни · 0 от 7" })).toBeVisible();
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
    "Отключва се: постижението „Сто дни“",
  );
  await page.getByRole("tab", { name: "Аватар" }).click();
  await page.getByRole("button", { name: "Таралеж", exact: true }).click();
  await expect(page.getByRole("button", { name: "Таралеж", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Avatars are pictures (art/pictures.ts), loaded after the first screen: the hedgehog is drawn on its tile.
  await expect(page.locator('.pick[aria-pressed="true"] .avatar-pic path').first()).toBeAttached();
  await page.getByRole("button", { name: "Корона, заключен аватар" }).click();
  await expect(page.getByText("Корона. Отключва се: ниво 10.")).toBeVisible();

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

test("just played, a right answer few others got makes „Сподели“ gold", async ({ page }) => {
  test.setTimeout(120_000);
  // The day as the server would have it with others playing: 4 right answers of the player's own (worth sharing only
  // for the rare one; one lucky answer in a poorer day isn't), and the right answer a tenth of the others got, told
  // (as the server does) only once the day is played.
  await page.route("**/api/runs/*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const s = await res.json();
    if (s.done) s.rights = 4;
    await route.fulfill({ response: res, json: s });
  });
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
  await expect(page.locator(".summary").getByRole("button", { name: "Сподели" })).toHaveClass(/primary/);
  await expect(page.locator(".summary .btn.primary")).toHaveCount(1);
});

test("after the day: one gold thing to do next, the goals still open, and Профил leading back to play", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await playedBefore(page, 1);
  await page.reload();
  await startDay(page);
  await playRun(page);
  // One gold action: „Сподели“ for a result worth it, else another game (and „Сподели“ plain beside the review).
  const gold = page.locator(".btn.primary");
  await expect(gold).toHaveCount(1);
  if ((await gold.textContent())?.includes("Още десет")) {
    await expect(gold).toHaveAttribute("href", /^\/(play\/[a-z]+|issues\/\d+)$/); // a goal's topic, a past issue
    await expect(page.getByRole("button", { name: "Сподели" })).not.toHaveClass(/primary/);
  }
  // The goals still open, each the way to where it's done; the day's own is done.
  const open = page.locator(".open-goals");
  await expect(open).toBeVisible();
  await expect(open).not.toContainText("Изиграй въпросите на деня");

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

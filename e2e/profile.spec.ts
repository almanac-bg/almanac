import { expect, test } from "@playwright/test";
import { playedBefore, playRun, ranked } from "./play.ts";

test("Профил: one tap on a seal wears it, no mode to choose in first", async ({ page }) => {
  await page.goto("/");
  await ranked(page);
  await page.goto("/me");
  const cards = page.locator(".me-seals .seal-list button.rk");
  await expect(cards).toHaveCount(10);
  // No „избери друг“ to open first: every earned seal is a button already, the worn one pressed.
  await expect(page.locator(".me-seals")).not.toContainText("избери");
  await expect(cards.and(page.locator('[aria-pressed="true"]'))).toHaveCount(1);
  const pressed = await cards.evaluateAll((all) => all.map((b) => b.getAttribute("aria-pressed")));
  const other = cards.nth(pressed.indexOf("false"));
  const chapter = (await other.locator(".rk-words b").textContent()) ?? "";
  await other.click();
  await expect(other).toHaveAttribute("aria-pressed", "true");
  await expect(cards.and(page.locator('[aria-pressed="true"]'))).toHaveCount(1);
  await expect(page.locator(".me-seals .seal-worn")).toHaveText(`Носиш печата на глава „${chapter}“.`);
  // Kept: worn still after a reload, and on its ladder.
  await page.reload();
  await expect(page.locator(".me-seals button.rk[aria-pressed='true'] .rk-words b")).toHaveText(chapter);
  await expect(page.locator(".me-ladder h2")).toHaveText(`Печатът на ${chapter}`);
});

test("a player's profile: asked to be friends from it, and friends there", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // Ana plays a topic.
  await a.goto("/almanac/history");
  await a.getByRole("link", { name: "Игра на главата" }).click();
  await playRun(a);
  const ana = await a.evaluate(
    async () => (await (await fetch("/api/me")).json()).user as { name: string; tag: string },
  );

  // Bo opens her profile (a board's name is a link to it).
  await b.goto(`/players/${ana.tag}`);
  await expect(b.getByRole("heading", { level: 1, name: ana.name })).toBeVisible();
  await expect(b.locator(".me-tag")).toHaveText(`@${ana.tag}`);
  // A topic's game writes no rank and no streak: nothing yet, and no lifetime totals nor how well she knows a topic.
  await expect(b.getByText("Още няма печат.")).toBeVisible();
  await expect(b.locator(".me-head")).not.toContainText("Ниво");
  await expect(b.locator(".screen")).not.toContainText(/изиграна игра|верни отговори|Колко знае/);

  // Nobody on his device yet: told to play a game first or sign in, and no guest is made for the asking.
  await expect(b.getByText("За да добавяш приятели, първо изиграй една игра или влез с имейл.")).toBeVisible();
  await expect(b.getByRole("button", { name: "Добави приятел" })).toHaveCount(0);
  expect(await b.evaluate(async () => (await (await fetch("/api/me")).json()).user)).toBeNull();

  // He has played a game: he asks to be friends; she sees it on his profile and accepts there.
  await playedBefore(b, 1);
  await b.reload();
  await b.getByRole("button", { name: "Добави приятел" }).click();
  await expect(b.getByText("Поканата за приятелство чака отговор.")).toBeVisible();
  const bo = await b.evaluate(
    async () => (await (await fetch("/api/me")).json()).user as { name: string; tag: string },
  );
  await a.goto("/friends");
  await a.locator(".invitation").getByRole("link", { name: bo.name }).click();
  await expect(a.getByText(`${bo.name} иска да сте приятели.`)).toBeVisible();
  await a.getByRole("button", { name: "Приеми" }).click();
  await expect(a.getByText("Приятели сте.")).toBeVisible();

  // Friends now, on his side too.
  await b.reload();
  await expect(b.locator(".player-actions")).toContainText("Приятели сте.");

  // Her own profile, as others see it, says so.
  await a.goto(`/players/${ana.tag}`);
  await expect(a.getByText("Така те виждат другите.")).toBeVisible();
  await a.goto("/players/nosuchplayer");
  await expect(a.getByRole("heading", { name: "Няма такъв профил" })).toBeVisible();
});

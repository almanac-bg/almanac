import { expect, test } from "@playwright/test";
import { playedBefore, playRun, ranked } from "./play.ts";

test("Профил: the seal worn is the best, never chosen; locked art says when it opens, and how far", async ({
  page,
}) => {
  await page.goto("/");
  await ranked(page, 1);
  await page.goto("/me");
  // The seals a view of the ranks: nothing to tap, nothing ringed as worn, no way to choose.
  await expect(page.locator(".me-seals .seal-list .rk")).toHaveCount(10);
  await expect(page.locator(".me-seals button")).toHaveCount(0);
  await expect(page.locator(".me-seals")).not.toContainText(/избери|Носиш/);
  // The badge is the best: every chapter alike (rank, ink, day), the bank's first.
  await expect(page.locator(".me-avatar .seal")).toHaveClass(/\bt-general\b/);
  expect((await page.request.patch("/api/me/seal", { data: { chapter: "music" } })).ok()).toBe(false);
  // Each chapter's art not the player's yet says when it opens under its name; a tap, how far it is, its real count
  // (Бележка, 1 with ink: 4 more to Страница's 5).
  const art = page.locator(".me-avatars .pick.locked");
  await expect(art).toHaveCount(10);
  await expect(art.first().locator(".pick-when")).toHaveText("при „Страница“");
  await page.locator(".me-avatars .pick.locked", { hasText: "История" }).click();
  await expect(page.locator(".me-avatars .pick-why")).toHaveText(
    "Картината на История става твоя при печата „Страница“: още 4 с\u00a0мастило.",
  );
  // The rule isn't said again under the grid.
  await expect(page.locator(".me-avatars")).not.toContainText("можеш да избереш за аватар");
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

import { expect, test } from "@playwright/test";
import { playedBefore, playRun, ranked } from "./play.ts";

test("Профил: one list of seals, the best worn on the avatar, never chosen; only animals as avatars", async ({
  page,
}) => {
  await page.goto("/");
  await ranked(page, 3);
  await page.goto("/me");
  // One list, a row a chapter: its seal, its name, its rank with the pips to the next, its ink. Nothing to tap,
  // nothing ringed as worn, no way to choose; no single chapter's ladder over it.
  const rows = page.locator(".me-seals .seal-list .seal-row");
  await expect(rows).toHaveCount(10);
  const history = rows.filter({ hasText: "История" });
  await expect(history.locator(".seal")).toHaveClass(/\bt-history\b/);
  await expect(history.locator(".seal-row-rank")).toHaveText("Тетрадка");
  await expect(history.locator(".seal-pips i.on")).toHaveCount(1);
  await expect(history.locator(".seal-row-ink")).toHaveText("15 с мастило");
  await expect(page.locator(".me-seals button, .ladder")).toHaveCount(0);
  await expect(page.locator(".screen")).not.toContainText(/избери|Носиш|Печатът на/);
  // The badge is the best (every chapter alike in rank, ink and day: the bank's first), on the avatar's corner.
  await expect(page.locator(".me-avatar .avatar > .seal")).toHaveClass(/\bt-general\b/);
  expect((await page.request.patch("/api/me/seal", { data: { chapter: "music" } })).ok()).toBe(false);
  // An avatar is a face: the fifteen animals, and no chapter's art, whatever its rank, here or by the API.
  await expect(page.locator(".me-avatars .pick")).toHaveCount(15);
  await expect(page.locator(".me-avatars")).not.toContainText(/История|Страница/);
  for (const art of ["history", "geography"])
    expect((await page.request.patch("/api/me/look", { data: { avatar: art } })).ok()).toBe(false);
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

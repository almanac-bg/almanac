import { expect, test } from "@playwright/test";
import { playedBefore, playRun, ranked } from "./play.ts";

test("Профил: one list of seals, the best worn on the avatar, never chosen; only animals as avatars", async ({
  page,
}) => {
  await page.goto("/");
  await ranked(page, 3);
  await page.goto("/me");
  // One list, a row a chapter: its seal, its name and its ink, and under them a bar of its ink out of the next rank's
  // (15 of 40, even at the rank's first ink), the rank under its left end and what's left under its right. Nothing to
  // tap, nothing ringed as worn, no way to choose; no single chapter's ladder over it.
  const rows = page.locator(".me-seals .seal-list .seal-row");
  await expect(rows).toHaveCount(10);
  const history = rows.filter({ hasText: "История" });
  await expect(history.locator(".seal")).toHaveClass(/\bt-history\b/);
  await expect(history.locator(".seal-row-name")).toHaveText("История");
  await expect(history.locator(".seal-row-ink")).toHaveText("15 с мастило");
  await expect(history.locator(".standing-now")).toHaveText("Тетрадка");
  await expect(history.locator(".standing-next")).toHaveText(/^още\s25\sдо\s„Книга“$/);
  await expect(history.locator(".standing-bar")).toBeVisible();
  expect(await history.locator(".standing-bar > i").evaluate((i) => (i as HTMLElement).style.width)).toBe("37.5%");
  await expect(page.locator(".me-seals button, .ladder")).toHaveCount(0);
  await expect(page.locator(".screen")).not.toContainText(/избери|Носиш|Печатът на/);
  // The badge is the best (every chapter alike in rank, ink and day: the bank's first), on the avatar's corner.
  await expect(page.locator(".me-avatar .avatar > .seal")).toHaveClass(/\bt-general\b/);
  expect((await page.request.patch("/api/me/seal", { data: { chapter: "music" } })).ok()).toBe(false);
  // An avatar is a face: the fifteen animals, and no chapter's art, whatever its rank, here or by the API. A choice
  // made rarely: on a sheet, not on the page.
  await expect(page.locator(".screen .pick")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Аватар" })).toHaveCount(0);
  await page.getByRole("button", { name: "Смени аватара" }).click();
  const sheet = page.getByRole("dialog", { name: "Аватар" });
  await expect(sheet.locator(".pick")).toHaveCount(15);
  await expect(sheet).not.toContainText(/История|Страница/);
  for (const art of ["history", "geography"])
    expect((await page.request.patch("/api/me/look", { data: { avatar: art } })).ok()).toBe(false);
});

test("Профил: the avatar is changed on a sheet, the one worn marked; a tap wears one, kept, and puts the sheet away", async ({
  page,
}) => {
  await page.goto("/");
  await playedBefore(page, 1);
  await page.goto("/me");
  // Found by „Смени“ under the avatar as well as the avatar itself: one button, its name says what it does.
  await page.locator(".me-avatar-change").click();
  const sheet = page.getByRole("dialog", { name: "Аватар" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.pick[aria-pressed="true"]')).toHaveCount(1);
  // „Затвори“ puts it away, nothing changed.
  const was = await page.locator(".me-head .avatar").getAttribute("class");
  await sheet.getByRole("button", { name: "Затвори" }).click();
  await expect(sheet).toHaveCount(0);
  expect(await page.locator(".me-head .avatar").getAttribute("class")).toBe(was);
  // A tap on an animal wears it at once and puts the sheet away; kept, as Профил shows it again.
  await page.getByRole("button", { name: "Смени аватара" }).click();
  await sheet.getByRole("button", { name: "Рис", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".me-head .avatar.sh-lynx")).toBeVisible();
  await page.reload();
  await expect(page.locator(".me-head .avatar.sh-lynx")).toBeVisible();
  await page.getByRole("button", { name: "Смени аватара" }).click();
  await expect(sheet.getByRole("button", { name: "Рис", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Esc puts it away too.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
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
  // Her avatar is hers to change, not his: no way to it here.
  await expect(b.getByRole("button", { name: "Смени аватара" })).toHaveCount(0);
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

  // Friends now, on his side too, with a duel a tap away (its name first, a drawn one: duels.spec); the page laid out
  // as Профил is: the head, how they stand where the streak would be, the seals.
  await b.reload();
  await expect(b.locator(".player-actions")).toContainText("Приятели сте.");
  expect(await b.locator(".screen.me > .me-intro > *").evaluateAll((els) => els.map((e) => e.classList[0]))).toEqual([
    "me-head",
    "player-actions",
    "sect",
  ]);
  await expect(b.getByRole("button", { name: /^Дуел (с|със) / })).toBeVisible();

  // Her own profile, as others see it, says so.
  await a.goto(`/players/${ana.tag}`);
  await expect(a.getByText("Така те виждат другите.")).toBeVisible();
  await a.goto("/players/nosuchplayer");
  await expect(a.getByRole("heading", { name: "Няма такъв профил" })).toBeVisible();
});

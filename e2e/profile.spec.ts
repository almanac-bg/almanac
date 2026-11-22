import { expect, test } from "@playwright/test";
import { daysPlayed, playedBefore, playRun, ranked, startDay } from "./play.ts";

test("Профил: one list of seals, the best worn on the avatar, never chosen; only animals as avatars", async ({
  page,
}) => {
  await page.goto("/");
  // Every chapter at Тетрадка: music with the most ink, history next, the rest at the rank's first (15).
  await ranked(page, 3, { music: 30, history: 20 });
  await page.goto("/me");
  // One list, a row a chapter: its seal, its name and its ink, and under them a bar of its ink out of the next rank's
  // in steps (40: 20, 10, 5 and five of one; 20 of 40 fills the first), the rank under its left end and what's left under its right. Nothing to
  // tap, nothing ringed as worn, no way to choose; no single chapter's ladder over it.
  const rows = page.locator(".me-seals .seal-list .seal-row");
  await expect(rows).toHaveCount(10);
  const history = rows.filter({ hasText: "История" });
  await expect(history.locator(".seal")).toHaveClass(/\bt-history\b/);
  await expect(history.locator(".seal-row-name")).toHaveText("История");
  await expect(history.locator(".seal-row-ink")).toHaveText("20 с мастило");
  await expect(history.locator(".standing-now")).toHaveText("Тетрадка");
  await expect(history.locator(".standing-next")).toHaveText(/^още\s20\sдо\s„Книга“$/);
  await expect(history.locator(".standing-bar")).toBeVisible();
  expect(
    await history
      .locator(".standing-bar > span > i")
      .evaluateAll((is) => is.map((i) => (i as HTMLElement).style.width)),
  ).toEqual(["100%", "0%", "0%", "0%", "0%", "0%", "0%", "0%"]);
  // The most ink first, then the bank's order: the first row is the seal worn on the avatar's corner, which it
  // explains. Beside „Печати“, the book's whole ink, the rows' summed.
  await expect(rows.locator(".seal-row-name")).toHaveText([
    "Музика",
    "История",
    "Обща култура",
    "Наука",
    "География",
    "Кино и телевизия",
    "Спорт",
    "Технологии и игри",
    "Изкуство и литература",
    "Природа и животни",
  ]);
  await expect(page.locator(".me-seals .sect-head h2")).toHaveText("Печати");
  await expect(page.locator(".me-seals .sect-note")).toHaveText("170 факта с\u00a0мастило");
  await expect(page.locator(".me-seals button, .ladder")).toHaveCount(0);
  await expect(page.locator(".screen")).not.toContainText(/избери|Носиш|Печатът на/);
  // The badge is the best (every chapter alike in rank and day: the most ink), on the avatar's corner: the first row.
  await expect(page.locator(".me-avatar .avatar > .seal")).toHaveClass(/\bt-music\b/);
  // The day they started, as another's page has it, in the same place.
  await expect(page.locator(".me-head .me-line").first()).toHaveText(/^Играе от \d{1,2} [а-я]+ \d{4}\u00a0г\.$/);
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
  // The avatar is the button, named for what it does; its pencil is on it, no word beside it.
  await expect(page.locator(".me-avatar-change")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Смени аватара" })).toHaveAttribute("title", "Смени аватара");
  await page.getByRole("button", { name: "Смени аватара" }).click();
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
  await a.getByRole("link", { name: "Играй 10 въпроса" }).click();
  await playRun(a);
  const ana = await a.evaluate(
    async () => (await (await fetch("/api/me")).json()).user as { name: string; tag: string },
  );

  // Bo opens her profile (a board's name is a link to it).
  await b.goto(`/players/${ana.tag}`);
  await expect(b.getByRole("heading", { level: 1, name: ana.name })).toBeVisible();
  await expect(b.locator(".me-tag")).toHaveText(`@${ana.tag}`);
  // Since the day she started, as the game writes a date, with its year.
  await expect(b.locator(".me-line")).toHaveText(/^Играе от \d{1,2} [а-я]+ \d{4}\u00a0г\.$/);
  // Her avatar is hers to change, not his: no way to it here.
  await expect(b.getByRole("button", { name: "Смени аватара" })).toHaveCount(0);
  // A topic's game writes no rank and no streak: nothing yet, and no lifetime totals nor how well she knows a topic.
  await expect(b.getByText("Още няма печат.")).toBeVisible();
  await expect(b.locator(".me-streak")).toHaveCount(0);
  await expect(b.locator(".me-head")).not.toContainText("Ниво");
  await expect(b.locator(".screen")).not.toContainText(/изиграна игра|верни отговори|Колко знае/);

  // Nobody on his device yet: told to play a game first or sign in, and no guest is made for the asking.
  await expect(b.locator(".player-actions .kicker")).toHaveText("Приятели");
  await expect(b.getByText("За да добавяш приятели, първо изиграй една игра или влез с имейл.")).toBeVisible();
  await expect(b.getByRole("button", { name: "Добави приятел" })).toHaveCount(0);
  expect(await b.evaluate(async () => (await (await fetch("/api/me")).json()).user)).toBeNull();

  // He has played a game: he asks to be friends; she sees it on his profile and accepts there.
  await playedBefore(b, 1);
  await b.reload();
  await b.getByRole("button", { name: "Добави приятел" }).click();
  await expect(b.locator(".player-actions .kicker")).toHaveText("Покана за приятелство");
  await expect(b.getByText(`Чака отговор от ${ana.name}.`)).toBeVisible();
  const bo = await b.evaluate(
    async () => (await (await fetch("/api/me")).json()).user as { name: string; tag: string },
  );
  await a.goto("/friends");
  await a.locator(".invitation").getByRole("link", { name: bo.name }).click();
  await expect(a.getByText(`${bo.name} иска да сте приятели.`)).toBeVisible();
  await a.getByRole("button", { name: "Приеми" }).click();
  await expect(a.locator(".player-actions .kicker")).toHaveText("Приятели");
  await expect(a.locator(".player-actions")).toContainText("Още нямате дуели.");

  // Friends now, on his side too, with a duel a tap away (its name first, a drawn one: duels.spec); the page laid out
  // as Профил is: the head, her streak as it is now by her tag (as Профил has it, without the week's forgiving:
  // hers), how they stand, the seals.
  await daysPlayed(a, 3, 2, 1);
  await b.reload();
  await expect(b.locator(".player-actions .kicker")).toHaveText("Приятели");
  expect(await b.locator(".screen.me > .me-intro > *").evaluateAll((els) => els.map((e) => e.classList[0]))).toEqual([
    "me-head",
    "player-actions",
    "sect",
  ]);
  await expect(b.locator(".me-head .me-ids .me-streak")).toHaveText("3 дни без прекъсване");
  await expect(b.locator(".me-streak")).not.toHaveAttribute("title");
  await expect(b.locator(".screen")).not.toContainText(/простен|пропуснат/);
  await expect(b.getByRole("button", { name: /^Дуел (с|със) / })).toBeVisible();
  // The duels between them so far, as numerals with their words under them: wins and losses, draws only where any.
  for (const [rec, want] of [
    [{ won: 3, lost: 0, drawn: 0 }, ["3победи", "0загуби"]],
    [{ won: 1, lost: 2, drawn: 1 }, ["1победа", "2загуби", "1равенство"]],
  ] as const) {
    await b.route(`**/api/players/${ana.tag}`, async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), record: rec } });
    });
    await b.reload();
    await expect(b.locator(".player-record .player-stat")).toHaveText([...want]);
    await b.unroute(`**/api/players/${ana.tag}`);
  }

  // Профил has no way to the page as others see it: her own, opened by its tag, is Профил.
  await a.goto("/me");
  await expect(a.locator(".me-head .me-streak")).toHaveText("3 дни без прекъсване");
  await expect(a.getByText(/Как (те|ме) виждат другите/)).toHaveCount(0);
  await a.goto(`/players/${ana.tag}`);
  await expect(a).toHaveURL(/\/me$/);
  await expect(a.getByRole("button", { name: "Смени аватара" })).toBeVisible();
  await expect(a.locator(".player-actions")).toHaveCount(0);
  await a.goto(`/players/${ana.tag.toUpperCase()}`);
  await expect(a).toHaveURL(/\/me$/);
  await a.goto("/players/nosuchplayer");
  await expect(a.getByRole("heading", { name: "Няма такъв профил" })).toBeVisible();
});

test("a link to oneself goes to Профил, wherever one's name is: never to one's page by its tag", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await startDay(page);
  await playRun(page);
  const me = await page.evaluate(async () => (await (await fetch("/api/me")).json()).user as { tag: string });
  // The day's board names the player among the others, the name a link: to Профил.
  const board = page.locator(".day-board");
  await expect(board.locator(".rank-row.me a")).toHaveAttribute("href", "/me");
  await expect(page.locator(`a[href="/players/${me.tag}"]`)).toHaveCount(0);
  await board.locator(".rank-row.me a").first().click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("button", { name: "Смени аватара" })).toBeVisible();
});

// Duels on one's own time (play/duels.go): a friend's, played first and sent, played back when the friend can, both
// at the end with the record and a rematch; and one against a recording of a real game.
import { expect, type Page, test } from "@playwright/test";
import { answer, befriend, meetAs, moveOn, playedFair, playRun } from "./play.ts";

/** A game opened by a tap: its count, cut short. */
async function countIn(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.getByRole("button", { name: "Започни сега" }).click();
}

/** Does what loads a page, and waits until it has asked whether something has come to Приятели (the dot). */
async function lookedFor(page: Page, load: () => Promise<unknown>): Promise<void> {
  await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === "/api/friends/news"), load()]);
}

/** Plays a duel's ten as the second side: the other's answer shows beside the player's own, from the first. */
async function playSecond(page: Page, other: string): Promise<void> {
  for (let n = 0; n < 10; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    await answer(page);
    await expect(page.locator(".their-line")).toContainText(`${other}:`);
    await moveOn(page);
  }
}

test("a duel with a friend: played first and sent, played back when they can, the record, a rematch", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await befriend(a, b);

  // Ana, in Приятели: a duel with her friend a tap away. Her name first (he'll see it), then her ten.
  await a.goto("/friends");
  await a.locator(".friend").getByRole("button", { name: /^Дуел/ }).click();
  await meetAs(a, "Ана");
  await expect(a).toHaveURL(/\/duel\/\d+$/);
  await countIn(a);
  await playRun(a);
  // Sent: her own result, and that he'll play the same ten.
  await expect(a.locator(".duel-sent")).toContainText("ще изиграе същите десет въпроса");
  // Приятели opens on its friends: no duel waits for her. Her duels are a tab away, and the tab is kept in the
  // address: a reload comes back to it.
  await a.goto("/friends");
  const aDuels = a.getByRole("tab", { name: "Дуели" });
  await expect(a.getByRole("tab", { name: "Приятели" })).toHaveAttribute("aria-selected", "true");
  await expect(a.locator(".friend")).toHaveCount(1);
  await expect(aDuels.locator(".tab-dot")).toHaveCount(0);
  await aDuels.click();
  await expect(a).toHaveURL(/\/friends\?tab=duels$/);
  await expect(a.locator(".friend")).toHaveCount(0);
  await a.reload();
  await expect(aDuels).toHaveAttribute("aria-selected", "true");
  // Her card: a duel with a friend, the two face to face, „Чакаш“ and how long he has between them, her score under.
  const sent = a.locator(".duels .duel-card.s-theirs");
  await expect(sent.locator(".duel-card-kind")).toHaveText("С приятел");
  await expect(sent.locator(".duel-card-side")).toHaveCount(2);
  await expect(sent.locator(".duel-card-mid")).toHaveText(/Чакаш\s*още 7\sдни/);
  await expect(sent.locator(".duel-card-note")).toHaveText(/Ти: \d+ от 10/);
  // The whole card is one link to the duel; no name in it is a link of its own.
  await expect(sent).toHaveAttribute("href", /^\/duel\/\d+$/);
  await expect(sent.locator("a")).toHaveCount(0);

  // Bo: a dot on Приятели (nothing over the day: Днес is the issue and the streak), the duel his to play there, a tap
  // away. Opened, Приятели has no dot: it's news since the last look, not what waits; the duel stays his to play.
  const bDot = b.locator("nav.places-foot a[href='/friends']");
  await b.goto("/");
  await expect(bDot).toHaveClass(/news/);
  await expect(b.locator(".notices")).toBeEmpty();
  await bDot.click();
  await expect(b).toHaveURL(/\/friends$/);
  await expect(bDot).not.toHaveClass(/news/);
  // A duel waits for him: „Дуели“ opens first, a dot on its tab, his turn in the card with „Играй“.
  const bDuels = b.getByRole("tab", { name: "Дуели" });
  await expect(bDuels).toHaveAttribute("aria-selected", "true");
  await expect(bDuels.locator(".tab-dot")).toHaveCount(1);
  await expect(b.locator(".duel-card.turn .duel-card-mid")).toHaveText(/Твой ред\s*още 7\sдни/);
  // The friends a tab away, kept over a reload though a duel waits; the dot stays on „Дуели“.
  await b.getByRole("tab", { name: "Приятели" }).click();
  await expect(b).toHaveURL(/\/friends\?tab=friends$/);
  await b.reload();
  await expect(b.getByRole("tab", { name: "Приятели" })).toHaveAttribute("aria-selected", "true");
  await expect(b.locator(".friend")).toHaveCount(1);
  await expect(bDuels.locator(".tab-dot")).toHaveCount(1);
  await lookedFor(b, () => b.goto("/"));
  await expect(bDot).not.toHaveClass(/news/);
  await b.goto("/friends");
  await b.locator(".duel-card.turn .duel-card-go").click();
  await countIn(b);
  await playSecond(b, "Ана");

  // Both at the end: face to face, question by question, the record between them, a rematch.
  await expect(b.getByRole("heading", { level: 1, name: /^(Победа|Загуба|Равенство)$/ })).toBeVisible({
    timeout: 10_000,
  });
  await b.keyboard.press("Shift"); // the moment, to its end
  await expect(b.locator(".duel-record")).toContainText("Срещу Ана");
  // One action and one way back, no more.
  await expect(b.getByRole("button", { name: "Реванш" })).toBeVisible();
  await expect(b.locator(".duel-side .actions").locator("a.btn, button.btn")).toHaveCount(2);
  // Played today: the ten questions as rows, each with how it went for the two side by side (no rows of marks
  // saying it again), its answers and its fact a tap away.
  await expect(b.locator(".duel-q")).toHaveCount(10);
  await expect(b.locator(".duel-q-side")).toHaveCount(20);
  await expect(b.locator(".duel-marks")).toHaveCount(0);
  await expect(b.locator(".duel-q-body")).toHaveCount(0);
  const row = b.locator(".duel-q").first();
  await row.getByRole("button", { name: "Отговорите и фактът" }).click();
  await expect(row.locator(".duel-q-body")).toBeVisible();
  await row.getByRole("button", { name: "Скрий" }).click();
  await expect(b.locator(".duel-q-body")).toHaveCount(0);

  // Ana: his result is news, a dot on Приятели; it goes as she opens it, and she sees it there, played.
  const aDot = a.locator("nav.places-foot a[href='/friends']");
  await a.goto("/");
  await expect(aDot).toHaveClass(/news/);
  await aDot.click();
  await expect(a).toHaveURL(/\/friends$/);
  await expect(aDot).not.toHaveClass(/news/);
  await aDuels.click();
  await expect(a.locator(".duels")).toContainText("Изиграни");
  const done = a.locator(".duels .duel-card").first();
  await expect(done).toHaveClass(/s-(won|lost|draw)/);
  // Its score between the two, a heavy numeral, and its end a chip, told apart at a glance: a win filled in ink with
  // its ✓, a loss and a draw outlined.
  await expect(done.locator(".duel-card-score")).toHaveText(/^\d+:\d+$/);
  const chip = done.locator(".duel-chip");
  const end = ((await done.getAttribute("class")) ?? "").match(/s-(\w+)/)?.[1];
  await expect(chip).toHaveClass(new RegExp(`\\b${end}\\b`));
  await expect(chip).toHaveText({ won: "✓ Победа", lost: "Загуба", draw: "Равенство" }[end ?? ""] ?? "");
  const fill = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(fill === "rgba(0, 0, 0, 0)", `${end}'s chip filled: ${fill}`).toBe(end !== "won");
  await lookedFor(a, () => a.goto("/"));
  await expect(aDot).not.toHaveClass(/news/);

  // His rematch, played and sent: news for her again.
  await b.getByRole("button", { name: "Реванш" }).click();
  await meetAs(b);
  await countIn(b);
  await expect(b.locator(".question-head .versus")).toHaveText("Дуел с Ана");
  await playRun(b);
  await expect(b.locator(".duel-sent")).toBeVisible();
  await a.reload();
  await expect(aDot).toHaveClass(/news/);
});

test("against a recording: a real game's ten, its player named, its answers as they came", async ({ browser }) => {
  test.setTimeout(240_000);
  // A real game to play against: someone's topic, at a person's pace.
  const a = await (await browser.newContext()).newPage();
  await a.goto("/play/history");
  await a.getByRole("button", { name: "Започни", exact: true }).click();
  await countIn(a);
  await playRun(a);
  await playedFair(a);

  const c = await (await browser.newContext()).newPage();
  await c.goto("/duel/new");
  await expect(c.getByText("Още нямаш приятели тук.")).toBeVisible();
  await c.getByRole("button", { name: "По-силен запис" }).click();
  await countIn(c);
  // Whose game it drew: Ана's, or another real game the tests running beside this one played meanwhile (the server
  // is theirs too). Named from the start, whoever it is.
  await expect(c).toHaveURL(/\/duel\/\d+$/);
  const owner = await c.evaluate(
    async (id) => (await (await fetch(`/api/duels/${id}`)).json()).duel.opponent.name as string,
    new URL(c.url()).pathname.split("/").pop(),
  );
  await expect(c.locator(".question-head .versus")).toContainText(owner);
  await playSecond(c, owner);
  await expect(c.getByRole("heading", { level: 1, name: /^(Победа|Загуба|Равенство)$/ })).toBeVisible({
    timeout: 10_000,
  });
  await c.keyboard.press("Shift");
  // Called by the level chosen only if the recording is it (stronger than the player); else only „Запис“.
  await expect(c.locator(".duel-head .kicker")).toContainText(owner);
  const kicker = (await c.locator(".duel-head .kicker").textContent()) ?? "";
  expect([`По-силен запис · ${owner}`, `Запис · ${owner}`]).toContain(kicker);
  await expect(c.locator(".duel-meant")).toContainText(`Записът е от истинска игра на ${owner}`);
  // Another asks for the level chosen last on this page, whatever this one met.
  const again = c.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/duels");
  await c.getByRole("button", { name: "Още един дуел срещу запис" }).click();
  expect((await again).postDataJSON()).toEqual({ recording: true, level: "stronger" });
});

test("a duel left before its first question isn't „Твой ред“; one begun goes on with its own run from „Играй“", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await befriend(a, b);
  // Whatever „Играй“ opens, never another game: no chapter's game is started meanwhile.
  const other: string[] = [];
  a.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (r.method() === "POST" && (path === "/api/topic" || path === "/api/day")) other.push(path);
  });

  // A tap on „Дуел“, then „Отказ“ on the count: no question shown, so nothing waits in Приятели.
  await a.goto("/friends");
  await a.locator(".friend").getByRole("button", { name: /^Дуел/ }).click();
  await meetAs(a, "Ана");
  await expect(a).toHaveURL(/\/duel\/\d+$/);
  const duel = new URL(a.url()).pathname;
  await expect(a.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await a.getByRole("button", { name: "Отказ" }).click();
  await expect(a).toHaveURL(/\/friends$/);
  await a.getByRole("tab", { name: "Дуели" }).click();
  await expect(a.locator(".duels").getByRole("link", { name: "Нов дуел" })).toBeVisible();
  await expect(a.locator(".duel-card")).toHaveCount(0);

  // Tapped again: the same duel. Its first question answered, then away.
  await a.getByRole("tab", { name: "Приятели" }).click();
  await a.locator(".friend").getByRole("button", { name: /^Дуел/ }).click();
  await expect(a).toHaveURL(duel);
  await countIn(a);
  await expect(a.locator(".question-head")).toContainText("1 от 10", { timeout: 10_000 });
  await answer(a);
  await expect(a.locator(".verdict")).toBeVisible();
  await a.goto("/friends");

  // „Твой ред“, and „Играй“ goes on with the duel's own run, where it was left.
  await expect(a.locator(".duel-card.turn")).toContainText("Довърши своята игра");
  await a.locator(".duel-card.turn .duel-card-go").click();
  await expect(a).toHaveURL(duel);
  await a.getByRole("button", { name: "Продължи" }).click();
  await expect(a.locator(".question-head")).toContainText("2 от 10", { timeout: 10_000 });
  await expect(a.locator(".question-head .versus")).toContainText("Дуел с");
  expect(other).toEqual([]);
});

test("a duel that is gone is said to be gone, to a guest too: not a sign-in", async ({ page }) => {
  await page.goto("/");
  expect((await page.request.post("/api/guest", { data: {} })).ok()).toBe(true);
  await page.goto("/duel/999999");
  await expect(page.getByRole("heading", { name: "Няма такава страница" })).toBeVisible();
});

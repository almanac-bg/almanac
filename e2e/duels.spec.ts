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
  await a.goto("/friends");
  await expect(a.locator(".duels")).toContainText("Чакаш");
  // Her row says her score and how long he has: „Ти: 7 · още 7 дни“ (his name over it).
  await expect(a.locator(".duels .duel-row.s-theirs")).toContainText(/Ти: \d+ ·\sоще 7\sдни/);

  // Bo: a dot on Приятели (nothing over the day: Днес is the issue and the streak), the duel his to play there, a tap
  // away. Opened, Приятели has no dot: it's news since the last look, not what waits; the duel stays his to play.
  const bDot = b.locator("nav.places-foot a[href='/friends']");
  await b.goto("/");
  await expect(bDot).toHaveClass(/news/);
  await expect(b.locator(".notices")).toBeEmpty();
  await bDot.click();
  await expect(b).toHaveURL(/\/friends$/);
  await expect(bDot).not.toHaveClass(/news/);
  await expect(b.locator(".duel-turn")).toContainText("Изиграй същите десет");
  await lookedFor(b, () => b.goto("/"));
  await expect(bDot).not.toHaveClass(/news/);
  await b.goto("/friends");
  await b.locator(".duel-turn").getByRole("link", { name: "Играй" }).click();
  await countIn(b);
  await playSecond(b, "Ана");

  // Both at the end: face to face, question by question, the record between them, a rematch.
  await expect(b.getByRole("heading", { level: 1, name: /^(Победа|Загуба|Равенство)$/ })).toBeVisible({
    timeout: 10_000,
  });
  await b.keyboard.press("Shift"); // the moment, to its end
  await expect(b.locator(".duel-marks")).toBeVisible();
  await expect(b.locator(".duel-record")).toContainText("Срещу Ана");
  await expect(b.getByRole("button", { name: "Реванш" })).toBeVisible();

  // Ana: his result is news, a dot on Приятели; it goes as she opens it, and she sees it there, played.
  const aDot = a.locator("nav.places-foot a[href='/friends']");
  await a.goto("/");
  await expect(aDot).toHaveClass(/news/);
  await aDot.click();
  await expect(a).toHaveURL(/\/friends$/);
  await expect(aDot).not.toHaveClass(/news/);
  await expect(a.locator(".duels")).toContainText("Изиграни");
  await expect(a.locator(".duels .duel-row").first()).toHaveClass(/s-(won|lost|draw)/);
  // Its end a chip, told apart at a glance: a win filled in ink with its ✓, a loss and a draw outlined.
  const chip = a.locator(".duels .duel-row").first().locator(".duel-chip");
  const end = ((await a.locator(".duels .duel-row").first().getAttribute("class")) ?? "").match(/s-(\w+)/)?.[1];
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
  await expect(a.locator(".duels").getByRole("link", { name: "Нов дуел" })).toBeVisible();
  await expect(a.locator(".duel-turn")).toHaveCount(0);

  // Tapped again: the same duel. Its first question answered, then away.
  await a.locator(".friend").getByRole("button", { name: /^Дуел/ }).click();
  await expect(a).toHaveURL(duel);
  await countIn(a);
  await expect(a.locator(".question-head")).toContainText("1 от 10", { timeout: 10_000 });
  await answer(a);
  await expect(a.locator(".verdict")).toBeVisible();
  await a.goto("/friends");

  // „Твой ред“, and „Играй“ goes on with the duel's own run, where it was left.
  await expect(a.locator(".duel-turn")).toContainText("Довърши своята игра");
  await a.locator(".duel-turn").getByRole("link", { name: "Играй" }).click();
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

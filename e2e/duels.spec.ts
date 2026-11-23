// Duels on one's own time (play/duels.go), with a friend, challenged from their row in Приятели: played first and
// sent, played back when the friend can, its end on its row in Приятели (there is no page of a duel's result), with
// its questions in their dialog, on any day. Приятели is one page: the duels waiting, the friends, the duels played.
import { expect, type Page, test } from "@playwright/test";
import { answer, befriend, endedBefore, meetAs, moveOn, playRun } from "./play.ts";

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

test("a duel with a friend: played first and sent, played back when they can, its row, its questions days later", async ({
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
  // Sent: she lands on Приятели, the duel's card first there, once, as it's sent: waiting for him, her score and her
  // row of marks on it, the two face to face, „Чакаш“ and how long he has between them.
  await expect(a).toHaveURL(/\/friends\?duel=\d+$/);
  const sent = a.locator(".duels-open .duel-card.landed");
  await expect(sent).toHaveClass(/s-theirs/);
  await expect(sent.locator(".duel-card-row")).toHaveCount(1);
  await expect(sent.locator(".mini > i")).toHaveCount(10);
  await expect(sent.locator(".duel-card-side")).toHaveCount(2);
  await expect(sent.locator(".duel-card-mid")).toHaveText(/Чакаш\s*още 7\sдни/);
  await expect(sent.locator(".duel-card-note")).toHaveText(/Ти: \d+ от 10/);
  // Nothing of hers to do there: no „Играй“, no name a link (a profile is the friends' list's); the card is her
  // questions.
  await expect(sent.locator(".duel-card-go")).toHaveCount(0);
  await expect(sent.getByRole("link")).toHaveCount(0);
  await expect(sent.locator(".duel-card-open")).toHaveAccessibleName(/^Въпросите от дуела (с|със) /);
  const sentId = ((await sent.getAttribute("id")) ?? "").replace("duel-", "");
  // Приятели is one page, no tabs; a duel she sent is his to play, not hers: not listed (only as it lands). Her
  // friends, with their count.
  await a.goto("/friends");
  await expect(a.getByRole("tab")).toHaveCount(0);
  await expect(a.locator(".friend")).toHaveCount(1);
  await expect(a.locator(".sect.friends h2")).toHaveText("Приятели (1)");
  await expect(a.locator(".duels-open")).toHaveCount(0);
  await expect(a.locator(".duels-played")).toHaveCount(0);
  // Its old page comes to it, shown as it landed.
  await a.goto(`/duel/${sentId}`);
  await expect(a).toHaveURL(new RegExp(`/friends\\?duel=${sentId}$`));
  await expect(a.locator(".duel-card.landed")).toHaveClass(/s-theirs/);

  // Bo: a dot on Приятели (nothing over the day: Днес is the issue and the streak), the duel his to play there, a tap
  // away. Opened, Приятели has no dot: it's news since the last look, not what waits; the duel stays his to play.
  const bDot = b.locator("nav.places-foot a[href='/friends']");
  await b.goto("/");
  await expect(bDot).toHaveClass(/news/);
  await expect(b.locator(".notices")).toBeEmpty();
  await bDot.click();
  await expect(b).toHaveURL(/\/friends$/);
  await expect(bDot).not.toHaveClass(/news/);
  // A duel waits for him, first on the page: his turn in its card with „Играй“, his friends under it. Only „Играй“
  // leads to the game (nothing laid over the card), the one link on it: no name is one. One duel: no stack.
  const turn = b.locator(".duel-card.turn");
  await expect(turn.locator(".duel-card-mid")).toHaveText(/Твой ред\s*още 7\sдни/);
  await expect(turn.locator(".duel-card-open")).toHaveCount(0);
  await expect(turn.locator(".duel-stack-open")).toHaveCount(0);
  await expect(turn.getByRole("link", { name: /^Играй/ })).toHaveAttribute("href", /^\/duel\/\d+$/);
  await expect(turn.getByRole("link")).toHaveCount(1);
  await expect(b.locator(".friend")).toHaveCount(1);
  await lookedFor(b, () => b.goto("/"));
  await expect(bDot).not.toHaveClass(/news/);
  await b.goto("/friends");
  await b.locator(".duel-card.turn .duel-card-go").click();
  await countIn(b);
  await playSecond(b, "Ана");

  // The end lands on Приятели, the duel's card first of the played, never a page of its own: the score counts up once,
  // and the two rows of marks are on it, his and hers.
  await expect(b).toHaveURL(/\/friends\?duel=\d+$/, { timeout: 10_000 });
  const result = b.locator(".duel-card.landed");
  await expect(result).toHaveClass(/s-(won|lost|draw)/);
  await b.keyboard.press("Shift"); // the moment, to its end
  await expect(result.locator(".duel-card-score")).toHaveText(/^\d+:\d+$/);
  await expect(result.locator(".duel-card-row")).toHaveCount(2);
  await expect(result.locator(".mini > i")).toHaveCount(20);
  await expect(b.locator(".duels-open")).toHaveCount(0);
  await expect(b.locator(".duel-card")).toHaveCount(1);
  // A played card opens its questions, the whole of it (no name on it a link: those are an open duel's), with no
  // button on it to say so: a tap on it (here on its marks) opens the ten in their dialog, each with how it went for
  // the two side by side, its answers and its fact.
  const open = result.locator(".duel-card-open");
  await expect(open).toHaveAccessibleName("Въпросите от дуела с Ана");
  await expect(result.getByRole("link")).toHaveCount(0);
  const box = await result.boundingBox();
  await b.mouse.click((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) - 20);
  const sheet = b.locator("dialog.review-sheet");
  await expect(sheet.getByRole("heading", { name: "Въпросите" })).toBeVisible();
  await expect(sheet.locator(".review-of")).toHaveText(/^Дуел с Ана · \d+:\d+$/);
  await expect(sheet.locator(".reviewed")).toHaveCount(10);
  await expect(sheet.locator(".duel-q-side")).toHaveCount(20);
  await expect(
    sheet.locator(".reviewed").first().locator(".options, .tf-options, .number-out, ol, ul").first(),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Затвори" }).click();
  await expect(sheet).toHaveCount(0);
  // A reload: the row as it is, landed already. Its old page comes here too.
  await b.reload();
  await expect(result.locator(".duel-card-score")).toHaveText(/^\d+:\d+$/);
  const played = new URL(b.url()).searchParams.get("duel");
  await b.goto(`/duel/${played}`);
  await expect(b).toHaveURL(new RegExp(`/friends\\?duel=${played}$`));
  // The row leads to its questions and her profile, nothing else: a new duel starts from the friend's row, the one way
  // here. From the keyboard too: Enter opens them, as Space does.
  await expect(result.locator("button")).toHaveCount(1);
  await open.focus();
  await b.keyboard.press("Enter");
  await expect(sheet.locator(".reviewed")).toHaveCount(10);
  await sheet.getByRole("button", { name: "Затвори" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(b.getByRole("link", { name: "Нов дуел" })).toHaveCount(0);
  await expect(b.locator(".friend").getByRole("button", { name: /^Дуел/ })).toBeVisible();

  // Ana: his result is news, a dot on Приятели; it goes as she opens it, and she sees it there, played.
  const aDot = a.locator("nav.places-foot a[href='/friends']");
  await a.goto("/");
  await expect(aDot).toHaveClass(/news/);
  await aDot.click();
  await expect(a).toHaveURL(/\/friends$/);
  await expect(aDot).not.toHaveClass(/news/);
  await expect(a.locator(".duels-played h2")).toHaveText("Завършени дуели");
  await expect(a.locator(".duels-open")).toHaveCount(0);
  const done = a.locator(".duels-played .duel-card").first();
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

  // Her friend's row: the duels between the two in words (not the friend's day: that's the day's board's), and „Дуел“,
  // a button.
  await a.goto("/friends");
  await expect(a.locator(".friend .friend-record")).toHaveText(/^Дуели помежду ви: (печелиш 1|губиш 1|1 равенство)$/);
  await expect(a.locator(".friend").getByRole("button", { name: /^Дуел/ })).toHaveClass(/\bbtn\b/);

  // Days later the duel is still in Приятели, and its questions still open from it (a duel's alone: play.Review).
  await endedBefore(b, 3);
  await b.reload();
  await b.getByRole("button", { name: "Въпросите от дуела с Ана" }).press(" ");
  await expect(sheet.locator(".reviewed")).toHaveCount(10);
  await expect(sheet.getByRole("alert")).toHaveCount(0);
});

test("a duel opened from its link (a notification, a chat) ends on its card in Приятели, never back out of the site", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await befriend(a, b);
  await a.goto("/friends");
  await a.locator(".friend").getByRole("button", { name: /^Дуел/ }).click();
  await meetAs(a, "Ана");
  await countIn(a);
  await playRun(a);
  await expect(a).toHaveURL(/\/friends\?duel=\d+$/);
  const id = new URL(a.url()).searchParams.get("duel");

  // Bo opens its link in a tab of its own, from outside the game (the page before it is no page of the game's): the
  // game's end goes back from its own entry once, not twice (bug hunt 2026-11-23: „…“ for good, or the page before).
  const link = await b.context().newPage();
  await link.goto(`/duel/${id}`);
  await link.getByRole("button", { name: "Започни", exact: true }).click();
  await countIn(link);
  await playSecond(link, "Ана");
  await expect(link).toHaveURL(new RegExp(`/friends\\?duel=${id}$`), { timeout: 10_000 });
  await expect(link.locator(".duel-card.landed")).toHaveClass(/s-(won|lost|draw)/);
});

test("every duel to play is in one stack, the first challenged on top, played from it; played back, first of the played", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const c = await (await browser.newContext()).newPage();
  await befriend(a, b);
  await befriend(c, b);
  // Ana sends him three, as many as may wait with one friend (play.DuelsToOne); then Cy one.
  const sentIds: string[] = [];
  const send = async (p: Page, name: string, n: number) => {
    await p.goto("/friends");
    await p.locator(".friend").getByRole("button", { name: /^Дуел/ }).click();
    if (n === 0) await meetAs(p, name);
    await countIn(p);
    await playRun(p);
    await expect(p).toHaveURL(/\/friends\?duel=\d+$/);
    sentIds.push(new URL(p.url()).searchParams.get("duel") ?? "");
  };
  for (let n = 0; n < 3; n++) await send(a, "Ана", n);
  // Hers aren't listed: his to play. Three wait for him: no fourth until he plays one, and his row says so, „Дуел“ off.
  await a.goto("/friends");
  await expect(a.locator(".duels-open")).toHaveCount(0);
  await expect(a.locator(".friend .friend-full")).toHaveText("Три дуела чакат. Нов — щом изиграе някой.");
  await expect(a.locator(".friend").getByRole("button", { name: /^Дуел/ })).toBeDisabled();
  await expect(a.locator(".duel-pile")).toHaveCount(0);
  await send(c, "Цвети", 0);

  // Bo: all four in one stack, whoever sent them, the first challenged on top with „Играй“, the edges of more under it.
  await b.goto("/friends");
  const pile = b.locator(".duels-open .duel-pile");
  await expect(pile).toHaveCount(1);
  await expect(pile).toHaveAttribute("data-more", "2");
  await expect(b.locator(".duels-open .duel-card")).toHaveCount(1);
  await expect(pile.locator(".duel-card")).toHaveAttribute("id", `duel-${sentIds[0]}`);
  await expect(b.locator(".duels-open h2")).toHaveText("Чакащи дуели (4)");
  await expect(pile.locator(".duel-card")).toHaveClass(/\bturn\b/);
  await expect(pile.locator(".duel-card-go")).toHaveText("Играй");
  // No list of them: one is played at a time, the top one.
  await expect(pile.getByRole("button", { name: /Виж всички/ })).toHaveCount(0);
  await pile.getByRole("link", { name: /^Играй/ }).click();
  await expect(b).toHaveURL(new RegExp(`/duel/${sentIds[0]}$`));
  await countIn(b);
  await playSecond(b, "Ана");

  // Its end: first of the played, at the page's foot, under the three still waiting (the stack) and the friends, and
  // brought into sight.
  await expect(b).toHaveURL(/\/friends\?duel=\d+$/, { timeout: 10_000 });
  const waiting = b.locator(".duels-open");
  const playedOnes = b.locator(".duels-played");
  await expect(waiting.getByRole("heading")).toHaveText("Чакащи дуели (3)");
  await expect(waiting.locator(".duel-pile .duel-card")).toHaveAttribute("id", `duel-${sentIds[1]}`);
  await expect(playedOnes.getByRole("heading")).toHaveText("Завършени дуели");
  const landed = playedOnes.locator(".duel-card").first();
  await expect(landed).toHaveAttribute("id", `duel-${sentIds[0]}`);
  await expect(landed).toHaveClass(/\blanded\b/);
  await expect(landed).toHaveClass(/s-(won|lost|draw)/);
  await expect(landed).toBeInViewport();
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
    if (r.method() === "POST" && (path === "/api/chapter" || path === "/api/day")) other.push(path);
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
  await expect(a.locator(".friend")).toHaveCount(1);
  await expect(a.locator(".duel-card")).toHaveCount(0);

  // Tapped again: the same duel. Its first question answered, then away.
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

test("every duel played, beyond the ten listed, in a dialog a page at a time", async ({ page }) => {
  // The server's answers made here: 23 played, the ten latest listed, the rest a page of ten at a time.
  const duel = (id: number) => ({
    id,
    state: id % 2 ? "won" : "lost",
    you: { name: "Заек 817", rights: 7, done: true, look: { avatar: "hare" } },
    opponent: { name: `Мария ${id}`, tag: `maria${id}`, rights: 5, done: true, look: { avatar: "fox" } },
    runId: id,
    first: true,
    createdAt: Date.now(),
    endedAt: Date.now(),
  });
  const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => duel(from - i));
  await page.goto("/");
  expect((await page.request.post("/api/guest", { data: {} })).ok()).toBe(true);
  await page.route("**/api/duels", (r) =>
    r.fulfill({ json: { yours: [], theirs: [], played: ids(23, 10), playedAll: 23 } }),
  );
  await page.route("**/api/duels/played?page=*", (r) => {
    const n = Number(new URL(r.request().url()).searchParams.get("page"));
    return r.fulfill({ json: { duels: ids(23 - (n - 1) * 10, n === 3 ? 3 : 10), page: n, pages: 3 } });
  });
  await page.goto("/friends");
  const played = page.locator(".duels-played");
  await expect(played.locator(".duel-card")).toHaveCount(10);
  // Under the last, the way to all of them.
  const all = played.getByRole("button", { name: "Всички завършени дуели (23)" });
  expect(
    await played.locator(".duel-cards, .duels-all-open").evaluateAll((els) => els.map((e) => e.className)),
  ).toEqual(["duel-cards", "btn duels-all-open"]);
  await all.click();
  const box = page.getByRole("dialog", { name: "Завършени дуели" });
  await expect(box.locator(".duel-card")).toHaveCount(10);
  await expect(box.locator(".pages-at")).toHaveText("Страница 1\u00a0от\u00a03");
  await expect(box.getByRole("button", { name: "По-нови" })).toBeDisabled();
  await box.getByRole("button", { name: "По-стари" }).click();
  await expect(box.locator(".pages-at")).toHaveText("Страница 2\u00a0от\u00a03");
  await expect(box.locator(".duel-card").first()).toHaveAttribute("id", "duel-13");
  await box.getByRole("button", { name: "По-стари" }).click();
  await expect(box.locator(".duel-card")).toHaveCount(3);
  await expect(box.getByRole("button", { name: "По-стари" })).toBeDisabled();
  await box.getByRole("button", { name: "По-нови" }).click();
  await expect(box.locator(".pages-at")).toHaveText("Страница 2\u00a0от\u00a03");
  // A card there as in the list: the whole of it its questions, no name a link.
  await expect(box.locator(".duel-card").first().getByRole("link")).toHaveCount(0);
  await expect(box.locator(".duel-card").first().locator(".duel-card-open")).toHaveAccessibleName(
    "Въпросите от дуела с Мария 13",
  );
  await box.locator(".sheet-head").getByRole("button", { name: "Затвори" }).click();
  await expect(box).toHaveCount(0);
});

test("a duel that is gone is said to be gone, to a guest too: not a sign-in", async ({ page }) => {
  await page.goto("/");
  expect((await page.request.post("/api/guest", { data: {} })).ok()).toBe(true);
  await page.goto("/duel/999999");
  await expect(page.getByRole("heading", { name: "Няма такава страница" })).toBeVisible();
});

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
  // Sent: she lands on Приятели, the duel first there: waiting for him, her score and her row of marks under his name.
  await expect(a).toHaveURL(/\/friends\?duel=\d+$/);
  const landed = a.locator(".duel-row.landed");
  await expect(landed).toHaveClass(/s-theirs/);
  await expect(landed.locator(".duel-card-row")).toHaveCount(1);
  await expect(landed.locator(".mini > i")).toHaveCount(10);
  // Приятели is one page, no tabs: the duel waiting („Чакащи дуели“, with its count) over her friends (with theirs),
  // both in sight at once.
  await a.goto("/friends");
  await expect(a.getByRole("tab")).toHaveCount(0);
  await expect(a.locator(".friend")).toHaveCount(1);
  await expect(a.locator(".duels-open h2")).toHaveText("Чакащи дуели (1)");
  await expect(a.locator(".sect.friends h2")).toHaveText("Приятели (1)");
  await expect(a.locator(".duels-played")).toHaveCount(0);
  const order = await a
    .locator(".duels-open, .sect.friends")
    .evaluateAll((els) => els.map((el) => (el.classList.contains("friends") ? "friends" : "duels")));
  expect(order).toEqual(["duels", "friends"]);
  // Her row: „Чакаш“ and how long he has under his name, her score under that.
  const sent = a.locator(".duels-open .duel-row.s-theirs");
  await expect(sent.locator(".duel-row-state")).toHaveText("Чакаш · още 7 дни");
  await expect(sent.locator(".duel-card-note")).toHaveText(/Ти: \d+ от 10/);
  // Nothing of hers to do there: no „Играй“; his name leads to his profile, the rest of the row to her questions. Its
  // old page comes to it.
  await expect(sent.locator(".duel-card-go")).toHaveCount(0);
  await expect(sent.locator("a.friend-name")).toHaveAttribute("href", /^\/players\//);
  await expect(sent.locator(".duel-row-open")).toHaveAccessibleName(/^Въпросите от дуела с /);
  const sentId = ((await sent.getAttribute("id")) ?? "").replace("duel-", "");
  await a.goto(`/duel/${sentId}`);
  await expect(a).toHaveURL(new RegExp(`/friends\\?duel=${sentId}$`));
  await expect(a.locator(".duel-row.landed")).toHaveClass(/s-theirs/);

  // Bo: a dot on Приятели (nothing over the day: Днес is the issue and the streak), the duel his to play there, a tap
  // away. Opened, Приятели has no dot: it's news since the last look, not what waits; the duel stays his to play.
  const bDot = b.locator("nav.places-foot a[href='/friends']");
  await b.goto("/");
  await expect(bDot).toHaveClass(/news/);
  await expect(b.locator(".notices")).toBeEmpty();
  await bDot.click();
  await expect(b).toHaveURL(/\/friends$/);
  await expect(bDot).not.toHaveClass(/news/);
  // A duel waits for him, first on the page: his turn in its row with „Играй“, his friends under it. Only „Играй“
  // leads to the game (nothing laid over the row), and Ana's name leads to her profile.
  const turn = b.locator(".duel-row.turn");
  await expect(turn.locator(".duel-row-state")).toHaveText("Твой ред · още 7 дни");
  await expect(turn.locator(".duel-row-open")).toHaveCount(0);
  await expect(turn.getByRole("link", { name: /^Играй/ })).toHaveAttribute("href", /^\/duel\/\d+$/);
  await expect(turn.getByRole("link", { name: "Ана", exact: true })).toHaveAttribute("href", /^\/players\//);
  await expect(b.locator(".friend")).toHaveCount(1);
  await lookedFor(b, () => b.goto("/"));
  await expect(bDot).not.toHaveClass(/news/);
  await b.goto("/friends");
  await b.locator(".duel-row.turn .duel-card-go").click();
  await countIn(b);
  await playSecond(b, "Ана");

  // The end lands on Приятели, the duel first of the played, a compact row, never a page of its own: the score counts
  // up once, and the two rows of marks are on it, his and hers.
  await expect(b).toHaveURL(/\/friends\?duel=\d+$/, { timeout: 10_000 });
  const result = b.locator(".duel-row.landed");
  await expect(result).toHaveClass(/s-(won|lost|draw)/);
  await b.keyboard.press("Shift"); // the moment, to its end
  await expect(result.locator(".duel-card-score")).toHaveText(/^\d+:\d+$/);
  await expect(result.locator(".duel-card-row")).toHaveCount(2);
  await expect(result.locator(".mini > i")).toHaveCount(20);
  await expect(b.locator(".duels-open")).toHaveCount(0);
  await expect(b.locator(".duel-row")).toHaveCount(1);
  // The row opens its questions, the whole of it but her name (a way to her profile), with no button on it to say so:
  // a tap on it opens the ten in their dialog, each with how it went for the two side by side, its answers and its fact.
  const open = result.locator(".duel-row-open");
  await expect(open).toHaveAccessibleName("Въпросите от дуела с Ана");
  await expect(result.getByRole("link", { name: "Ана", exact: true })).toHaveAttribute("href", /^\/players\//);
  const box = await result.boundingBox();
  await b.mouse.click((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) - 6);
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
  await expect(a.locator(".duels-played h2")).toHaveText("Изиграни дуели");
  await expect(a.locator(".duels-open")).toHaveCount(0);
  const done = a.locator(".duels-played .duel-row").first();
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
  await expect(a.locator(".friend .friend-record")).toHaveText(
    /^Дуели помежду ви: (1 победа, 0 загуби|0 победи, 1 загуба|0 победи, 0 загуби, 1 равенство)$/,
  );
  await expect(a.locator(".friend").getByRole("button", { name: /^Дуел/ })).toHaveClass(/\bbtn\b/);

  // Days later the duel is still in Приятели, and its questions still open from it (a duel's alone: play.Review).
  await endedBefore(b, 3);
  await b.reload();
  await b.getByRole("button", { name: "Въпросите от дуела с Ана" }).press(" ");
  await expect(sheet.locator(".reviewed")).toHaveCount(10);
  await expect(sheet.getByRole("alert")).toHaveCount(0);
});

test("one friend's duels sent are one pile, „Играй“ on it; one played back lands first of the played, under those waiting", async ({
  browser,
}) => {
  test.setTimeout(360_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await befriend(a, b);
  // Ana sends him three, as many as may wait with one friend (play.DuelsToOne).
  for (let n = 0; n < 3; n++) {
    await a.goto("/friends");
    await a.locator(".friend").getByRole("button", { name: /^Дуел/ }).click();
    if (n === 0) await meetAs(a, "Ана");
    await countIn(a);
    await playRun(a);
    await expect(a).toHaveURL(/\/friends\?duel=\d+$/);
  }
  // Hers wait each on its own row: each has her own score on it. Three wait for him: no fourth until he plays one,
  // and his row says so, „Дуел“ off.
  await expect(a.locator(".duels-open .duel-row.s-theirs")).toHaveCount(3);
  await expect(a.locator(".friend .friend-full")).toHaveText("Три дуела чакат. Нов — щом изиграе някой.");
  await expect(a.locator(".friend").getByRole("button", { name: /^Дуел/ })).toBeDisabled();
  await expect(a.locator(".duel-pile")).toHaveCount(0);

  // Bo: the three are one row, the next to lapse, with „Играй“, the count said on its line and in the heading.
  await b.goto("/friends");
  const pile = b.locator(".duel-pile");
  await expect(pile).toHaveCount(1);
  await expect(pile).toHaveAttribute("data-more", "2");
  await expect(b.locator(".duels-open .duel-row")).toHaveCount(1);
  await expect(b.locator(".duels-open h2")).toHaveText("Чакащи дуели (3)");
  await expect(pile).toHaveClass(/\bturn\b/);
  await expect(pile.locator(".duel-card-go")).toHaveText("Играй");
  await expect(pile.locator(".duel-card-note")).toHaveText("Още 2 дуела чакат.");
  await pile.locator(".duel-card-go").click();
  await countIn(b);
  await playSecond(b, "Ана");

  // Its end: first of the played, at the page's foot, under the two still waiting (one row, a pile)
  // and the friends, and brought into sight.
  await expect(b).toHaveURL(/\/friends\?duel=\d+$/, { timeout: 10_000 });
  const waiting = b.locator(".duels-open");
  const playedOnes = b.locator(".duels-played");
  await expect(waiting.getByRole("heading")).toHaveText("Чакащи дуели (2)");
  await expect(waiting.locator(".duel-pile")).toHaveAttribute("data-more", "1");
  await expect(waiting.locator(".duel-card-note")).toHaveText("Още един дуел чака.");
  await expect(playedOnes.getByRole("heading")).toHaveText("Изиграни дуели");
  const landed = playedOnes.locator(".duel-row").first();
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
  await expect(a.locator(".friend")).toHaveCount(1);
  await expect(a.locator(".duel-row")).toHaveCount(0);

  // Tapped again: the same duel. Its first question answered, then away.
  await a.locator(".friend").getByRole("button", { name: /^Дуел/ }).click();
  await expect(a).toHaveURL(duel);
  await countIn(a);
  await expect(a.locator(".question-head")).toContainText("1 от 10", { timeout: 10_000 });
  await answer(a);
  await expect(a.locator(".verdict")).toBeVisible();
  await a.goto("/friends");

  // „Твой ред“, and „Играй“ goes on with the duel's own run, where it was left.
  await expect(a.locator(".duel-row.turn")).toContainText("Довърши своята игра");
  await a.locator(".duel-row.turn .duel-card-go").click();
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

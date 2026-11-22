// Duels on one's own time (play/duels.go), with a friend, challenged from their row in Приятели: played first and
// sent, played back when the friend can, its end on its card in Приятели (there is no page of a duel's result), with
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

test("a duel with a friend: played first and sent, played back when they can, its card, its questions days later", async ({
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
  // Sent: she lands on Приятели, the duel's card first there: waiting for him, her score and her row of marks on it.
  await expect(a).toHaveURL(/\/friends\?duel=\d+$/);
  const landed = a.locator(".duel-card.landed");
  await expect(landed).toHaveClass(/s-theirs/);
  await expect(landed.locator(".duel-card-row")).toHaveCount(1);
  await expect(landed.locator(".mini > i")).toHaveCount(10);
  // Приятели is one page, no tabs: the duel waiting („Чакащи“) over her friends, both in sight at once.
  await a.goto("/friends");
  await expect(a.getByRole("tab")).toHaveCount(0);
  await expect(a.locator(".friend")).toHaveCount(1);
  await expect(a.locator(".duels-open").getByRole("heading", { name: "Чакащи" })).toBeVisible();
  await expect(a.locator(".duels-played")).toHaveCount(0);
  const order = await a
    .locator(".duels-open, .sect.friends")
    .evaluateAll((els) => els.map((el) => (el.classList.contains("friends") ? "friends" : "duels")));
  expect(order).toEqual(["duels", "friends"]);
  // Her card: the two face to face, „Чакаш“ and how long he has between them, her score under.
  const sent = a.locator(".duels-open .duel-card.s-theirs");
  await expect(sent.locator(".duel-card-side")).toHaveCount(2);
  await expect(sent.locator(".duel-card-mid")).toHaveText(/Чакаш\s*още 7\sдни/);
  await expect(sent.locator(".duel-card-note")).toHaveText(/Ти: \d+ от 10/);
  // Nothing of hers to do there: the card is no link, and no name in it is one. Its old page comes to it.
  await expect(sent).not.toHaveAttribute("href");
  await expect(sent.locator("a")).toHaveCount(0);
  const sentId = ((await sent.getAttribute("id")) ?? "").replace("duel-", "");
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
  // A duel waits for him, first on the page: his turn in the card with „Играй“, his friends under it.
  await expect(b.locator(".duel-card.turn .duel-card-mid")).toHaveText(/Твой ред\s*още 7\sдни/);
  await expect(b.locator(".friend")).toHaveCount(1);
  await lookedFor(b, () => b.goto("/"));
  await expect(bDot).not.toHaveClass(/news/);
  await b.goto("/friends");
  await b.locator(".duel-card.turn .duel-card-go").click();
  await countIn(b);
  await playSecond(b, "Ана");

  // The end lands on Приятели, the duel's card first of the played, never a page of its own: the score counts up once, and
  // the two rows of marks are on it, his and hers.
  await expect(b).toHaveURL(/\/friends\?duel=\d+$/, { timeout: 10_000 });
  const result = b.locator(".duel-card.landed");
  await expect(result).toHaveClass(/s-(won|lost|draw)/);
  await b.keyboard.press("Shift"); // the moment, to its end
  await expect(result.locator(".duel-card-score")).toHaveText(/^\d+:\d+$/);
  await expect(result.locator(".duel-card-row")).toHaveCount(2);
  await expect(result.locator(".mini > i")).toHaveCount(20);
  await expect(b.locator(".duel-card")).toHaveCount(1);
  // The card is the button to its questions, the whole of it, with no button on it: a tap anywhere on it (here on its
  // marks) opens the ten in their dialog, each with how it went for the two side by side, its answers and its fact.
  await expect(result).toHaveRole("button");
  await expect(result).toHaveAccessibleName(/^Въпросите от дуела с Ана\. .*Ти.*Ана/);
  await expect(result.locator("button, a")).toHaveCount(0);
  await result.locator(".duel-card-marks").click();
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
  // A reload: the card as it is, landed already. Its old page comes here too.
  await b.reload();
  await expect(result.locator(".duel-card-score")).toHaveText(/^\d+:\d+$/);
  const played = new URL(b.url()).searchParams.get("duel");
  await b.goto(`/duel/${played}`);
  await expect(b).toHaveURL(new RegExp(`/friends\\?duel=${played}$`));
  // The card leads to its questions and nothing else: a new duel starts from the friend's row, the one way here. From
  // the keyboard too: Enter opens them, as Space does.
  await expect(result.locator("button, a")).toHaveCount(0);
  await result.focus();
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
  await expect(a.locator(".duels-played").getByRole("heading", { name: "Изиграни", exact: true })).toBeVisible();
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
  // On a big screen too, the cards one a row, as on a phone.
  await a.setViewportSize({ width: 1366, height: 800 });
  const across = await a
    .locator(".duels-played .duel-cards")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(across).toBe(1);
  await lookedFor(a, () => a.goto("/"));
  await expect(aDot).not.toHaveClass(/news/);

  // Her friend's row: the day's issue (not played: a dash) and the duels between the two, each an icon and its number,
  // said whole by its tooltip and to a screen reader.
  await a.goto("/friends");
  const stats = a.locator(".friend .friend-stat");
  await expect(stats).toHaveCount(2);
  await expect(stats.first()).toHaveText("—");
  await expect(stats.first()).toHaveAttribute("title", "Днешният брой: още не е изигран");
  await expect(stats.first()).toHaveAccessibleName("Днешният брой: още не е изигран");
  await expect(stats.last()).toHaveText(/^\d:\d$/);
  await expect(stats.last()).toHaveAttribute("title", /^Дуели помежду ви: \d (победа|победи), \d (загуба|загуби)/);
  expect(await stats.last().getAttribute("aria-label")).toBe(await stats.last().getAttribute("title"));

  // Days later the duel is still on its card, and its questions still open from it (a duel's alone: play.Review).
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
  // Hers wait each on its own card: each has her own score on it.
  await expect(a.locator(".duels-open .duel-card.s-theirs")).toHaveCount(3);
  await expect(a.locator(".duel-pile")).toHaveCount(0);

  // Bo: the three are one card, the next to lapse on top with „Играй“, two sheets' edges under it, the count said.
  await b.goto("/friends");
  const pile = b.locator(".duel-pile");
  await expect(pile).toHaveCount(1);
  await expect(pile).toHaveAttribute("data-more", "2");
  await expect(b.locator(".duel-card")).toHaveCount(1);
  await expect(pile.locator(".duel-card.turn .duel-card-go")).toHaveText("Играй");
  await expect(pile.locator(".duel-card-note")).toHaveText("Още 2 дуела чакат.");
  await pile.locator(".duel-card-go").click();
  await countIn(b);
  await playSecond(b, "Ана");

  // Its end: first of the played, at the page's foot, under the two still waiting (one pile, a sheet's edge under it)
  // and the friends, and brought into sight.
  await expect(b).toHaveURL(/\/friends\?duel=\d+$/, { timeout: 10_000 });
  const waiting = b.locator(".duels-open");
  const playedOnes = b.locator(".duels-played");
  await expect(waiting.getByRole("heading")).toHaveText("Чакащи");
  await expect(waiting.locator(".duel-pile")).toHaveAttribute("data-more", "1");
  await expect(waiting.locator(".duel-card-note")).toHaveText("Още един дуел чака.");
  await expect(playedOnes.getByRole("heading")).toHaveText("Изиграни");
  const landed = playedOnes.locator(".duel-card").first();
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

test("a duel that is gone is said to be gone, to a guest too: not a sign-in", async ({ page }) => {
  await page.goto("/");
  expect((await page.request.post("/api/guest", { data: {} })).ok()).toBe(true);
  await page.goto("/duel/999999");
  await expect(page.getByRole("heading", { name: "Няма такава страница" })).toBeVisible();
});

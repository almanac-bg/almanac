// Duels on one's own time (play/duels.go): a friend's, played first and sent, played back when the friend can, its
// end on its card in Приятели's „Дуели“ (there is no page of a duel's result), with its questions in their dialog, on
// any day; and one against a recording of a real game.
import { expect, type Page, test } from "@playwright/test";
import { answer, befriend, endedBefore, meetAs, moveOn, playedFair, playRun } from "./play.ts";

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
  // Sent: she lands on „Дуели“, the duel's card first there: waiting for him, her score and her row of marks on it.
  await expect(a).toHaveURL(/\/friends\?tab=duels&duel=\d+$/);
  const landed = a.locator(".duel-card.landed");
  await expect(landed).toHaveClass(/s-theirs/);
  await expect(landed.locator(".duel-card-row")).toHaveCount(1);
  await expect(landed.locator(".mini > i")).toHaveCount(10);
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
  // Nothing of hers to do there: the card is no link, and no name in it is one. Its old page comes to it.
  await expect(sent).not.toHaveAttribute("href");
  await expect(sent.locator("a")).toHaveCount(0);
  const sentId = ((await sent.getAttribute("id")) ?? "").replace("duel-", "");
  await a.goto(`/duel/${sentId}`);
  await expect(a).toHaveURL(new RegExp(`/friends\\?tab=duels&duel=${sentId}$`));
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

  // The end lands on „Дуели“, the duel's card first there, never a page of its own: the score counts up once, and
  // the two rows of marks are on it, his and hers.
  await expect(b).toHaveURL(/\/friends\?tab=duels&duel=\d+$/, { timeout: 10_000 });
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
  await expect(result).toHaveAccessibleName(/^Въпросите от дуела с Ана\. С приятел .*Ти.*Ана/);
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
  await expect(b).toHaveURL(new RegExp(`/friends\\?tab=duels&duel=${played}$`));
  // The card leads to its questions and nothing else: a new duel starts from „Нов дуел“, under the cards. From the
  // keyboard too: Enter opens them, as Space does.
  await expect(result.locator("button, a")).toHaveCount(0);
  await result.focus();
  await b.keyboard.press("Enter");
  await expect(sheet.locator(".reviewed")).toHaveCount(10);
  await sheet.getByRole("button", { name: "Затвори" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(b.locator(".duels").getByRole("link", { name: "Нов дуел" })).toHaveAttribute("href", "/duel/new");

  // Ana: his result is news, a dot on Приятели; it goes as she opens it, and she sees it there, played.
  const aDot = a.locator("nav.places-foot a[href='/friends']");
  await a.goto("/");
  await expect(aDot).toHaveClass(/news/);
  await aDot.click();
  await expect(a).toHaveURL(/\/friends$/);
  await expect(aDot).not.toHaveClass(/news/);
  await aDuels.click();
  await expect(a.locator(".duels").getByRole("heading", { name: "Изиграни", exact: true })).toBeVisible();
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
  // On a big screen too, the cards one a row, as on a phone.
  await a.setViewportSize({ width: 1366, height: 800 });
  const across = await a
    .locator(".duels .duel-cards")
    .last()
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(across).toBe(1);
  await lookedFor(a, () => a.goto("/"));
  await expect(aDot).not.toHaveClass(/news/);

  // Her friend's row: the day's issue (not played: a dash) and the duels between the two, each an icon and its number,
  // said whole by its tooltip and to a screen reader.
  await a.goto("/friends?tab=friends");
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
  // The way back is to „Дуели“; a recording is one kind, said in a sentence, with one button.
  await expect(c.locator("a.back")).toHaveText("Дуели");
  await expect(c.locator("a.back")).toHaveAttribute("href", "/friends?tab=duels");
  await expect(c.locator(".lead")).toHaveText(
    "Десет въпроса. С приятел — той ги играе, когато може. Срещу запис — веднага.",
  );
  await expect(c.getByText("срещу истинска игра на играч, който знае горе-долу колкото теб")).toBeVisible();
  await expect(c.getByRole("button", { name: /запис/i })).toHaveCount(1);
  const asked = c.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/duels");
  await c.getByRole("button", { name: "Играй срещу запис" }).click();
  expect((await asked).postDataJSON()).toEqual({ recording: true });
  await countIn(c);
  // Whose game it drew: Ана's, or another real game the tests running beside this one played meanwhile (the server
  // is theirs too). Named from the start, whoever it is.
  await expect(c).toHaveURL(/\/duel\/\d+$/);
  const owner = await c.evaluate(
    async (id) => (await (await fetch(`/api/duels/${id}`)).json()).duel.opponent.name as string,
    new URL(c.url()).pathname.split("/").pop(),
  );
  await expect(c.locator(".question-head .versus")).toContainText(owner);
  await expect(c.locator(".question-head .versus")).toContainText(`Запис · ${owner}`);
  await playSecond(c, owner);
  // Its end, on its card: against a recording, whose it was, the two rows of marks, and its questions.
  await expect(c).toHaveURL(/\/friends\?tab=duels&duel=\d+$/, { timeout: 10_000 });
  const card = c.locator(".duel-card.landed");
  await expect(card).toHaveClass(/s-(won|lost|draw)/);
  await c.keyboard.press("Shift");
  await expect(card.locator(".duel-card-kind")).toHaveText("Срещу запис");
  await expect(card.locator(".duel-card-name").last()).toContainText(owner);
  await expect(card.locator(".duel-card-row")).toHaveCount(2);
  await expect(card).toHaveRole("button");
  await expect(card).toHaveAccessibleName(
    new RegExp(`^Въпросите от дуела срещу запис на ${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. Срещу запис`),
  );
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
    await expect(a).toHaveURL(/\/friends\?tab=duels&duel=\d+$/);
  }
  // Hers wait each on its own card: each has her own score on it.
  await expect(a.locator(".duels .duel-card.s-theirs")).toHaveCount(3);
  await expect(a.locator(".duel-pile")).toHaveCount(0);

  // Bo: the three are one card, the next to lapse on top with „Играй“, two sheets' edges under it, the count said.
  await b.goto("/friends?tab=duels");
  const pile = b.locator(".duel-pile");
  await expect(pile).toHaveCount(1);
  await expect(pile).toHaveAttribute("data-more", "2");
  await expect(b.locator(".duel-card")).toHaveCount(1);
  await expect(pile.locator(".duel-card.turn .duel-card-go")).toHaveText("Играй");
  await expect(pile.locator(".duel-card-note")).toHaveText("Още 2 дуела чакат.");
  await pile.locator(".duel-card-go").click();
  await countIn(b);
  await playSecond(b, "Ана");

  // Its end: first of the played, under the two still waiting (one pile, a sheet's edge under it), and in sight.
  await expect(b).toHaveURL(/\/friends\?tab=duels&duel=\d+$/, { timeout: 10_000 });
  const groups = b.locator(".duel-groups > section");
  await expect(groups).toHaveCount(2);
  await expect(groups.first().getByRole("heading")).toHaveText("Чакащи");
  await expect(groups.first().locator(".duel-pile")).toHaveAttribute("data-more", "1");
  await expect(groups.first().locator(".duel-card-note")).toHaveText("Още един дуел чака.");
  await expect(groups.last().getByRole("heading")).toHaveText("Изиграни");
  const landed = groups.last().locator(".duel-card").first();
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

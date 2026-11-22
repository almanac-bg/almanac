import { expect, test } from "@playwright/test";
import { answer, moveOn, openGame, playedFair, playRun, startDay } from "./play.ts";

test("the day: ten questions, the result, the review, and one try only", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Десет въпроса за днес" })).toBeVisible();
  // A new visitor's cover is the day alone: no places, no streak, no topics.
  await expect(page.locator(".places-foot")).toBeHidden();
  await expect(page.locator(".streak-chip")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /История/ })).toHaveCount(0);
  await startDay(page);
  await playRun(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("от 10");
  // A first result is quiet: the right answers, no points, XP, level or goals (the game has none).
  await expect(page.locator(".screen")).not.toContainText(/XP|[Нн]иво \d|Цели за деня|точк/);
  // The first result's action sits right under the score: keeping the game and being reminded (or, until that's there
  // to ask, sharing it). Topics are played from the Алманах, duels from Приятели.
  await expect(page.locator(".result-main > .result-score + .result-share.result-first")).toBeVisible();
  // The questions gone over, in their dialog: by the button, each question with its answers.
  const review = page.getByRole("dialog", { name: "Въпросите" });
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(review.locator(".reviewed")).toHaveCount(10);
  await expect(review.locator(".review-of")).toHaveText(/^Брой\s\d+ · \d+ \S+ · \d+ от 10$/);
  await expect(review.locator(".lit")).toHaveCount(0);
  await review.getByRole("button", { name: "Затвори" }).click();
  await expect(review).toHaveCount(0);
  await expect(page.locator(".result .reviewed")).toHaveCount(0);
  // By a tap on the score's card: the same dialog, from its top.
  await page.locator(".result-score .score").click();
  await expect(review.locator(".reviewed")).toHaveCount(10);
  await expect(review.locator(".reviewed").first()).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(review).toHaveCount(0);
  // By a tile: at its question, right under the dialog's head, marked for a moment.
  await page.getByRole("button", { name: /^7\. / }).click();
  const seventh = review.locator(".reviewed").nth(6);
  await expect(seventh).toHaveClass(/\blit\b/);
  await expect(seventh.locator(".kicker")).toHaveText(/^7 · /);
  const [head, at] = [await review.locator(".sheet-head").boundingBox(), await seventh.boundingBox()];
  expect(Math.abs((at?.y ?? 0) - ((head?.y ?? 0) + (head?.height ?? 0)))).toBeLessThan(32);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".result")).toBeVisible();
  await expect(page.getByRole("button", { name: "Започни" })).toHaveCount(0);
  await expect(page.locator(".places-foot")).toBeVisible();
  // The result tells the streak tomorrow makes.
  await expect(page.locator(".tomorrow")).toContainText("С него серията ти става 2.");
  // The day's board on the result: of friends (none yet), and of all България, where it opens, the player on it.
  await expect(page.locator(".day-board").getByRole("tab")).toHaveText(["Приятели", "Всички"]);
  await expect(page.locator(".day-board").getByRole("tab", { name: "Всички" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".day-board .rank-row.me")).toContainText(/\d\sот\s10$/);
  // A row is the place, the name and the score: no level, no title.
  await expect(page.locator(".day-board .lv, .day-board .who-title")).toHaveCount(0);
  await page.goto("/me");
  await expect(page.locator(".me-seals")).toBeVisible();
  // The seals one list, a row a chapter with a rank, and the best of them worn on the avatar's corner.
  if (await page.locator(".me-seals .seal-row").count()) {
    await expect(page.locator(".me-avatar .avatar > .seal")).toHaveCount(1);
    await expect(page.locator(".me-seals .seal-row").first().locator(".standing-bar")).toBeVisible();
  }

  await openGame(page, "/play/history");
  await playRun(page);
  await expect(page.locator(".summary")).toBeVisible();
});

test("a day with none right opens its questions and their facts under the score, and praises nothing", async ({
  page,
}) => {
  await page.goto("/");
  // The ten given up, one by one (no answer: none right).
  await page.request.post("/api/guest", { data: {} });
  const run = await (await page.request.post("/api/day", { data: {} })).json();
  for (let n = 0; n < 10; n++) {
    await page.request.post(`/api/runs/${run.id}/show`, { data: {} });
    await page.request.post(`/api/runs/${run.id}/start`, { data: { n } });
    expect((await page.request.post(`/api/runs/${run.id}/answer`, { data: { n, answer: null } })).ok()).toBe(true);
  }
  await page.goto("/");
  await expect(page.locator(".score-n")).toHaveText("0");
  // Right under the score: the first four, each with its fact, and the way to the rest.
  await expect(page.locator(".result-score + .missed-day .miss")).toHaveCount(4);
  await expect(page.locator(".missed-day .sect-note")).toHaveText("1–4 от 10");
  // Each with its right answer (an order's, a match's, a split's in lines); the ten whole in their dialog, by the one
  // button under the four: never a second way to them beside it.
  await expect(page.locator(".missed-day .miss .miss-a")).toHaveCount(4);
  await expect(page.locator(".reviewed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Въпросите", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Прегледай въпросите" })).toHaveCount(1);
  await page.locator(".missed-day").getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(page.getByRole("dialog", { name: "Въпросите" }).locator(".reviewed")).toHaveCount(10);
  await page.keyboard.press("Escape");
  await expect(page.locator(".screen")).not.toContainText(/[Бб]раво|[Пп]оздрав|[Сс]упер|[Оо]тлично/);
});

test("the day says how its other players did with each question: under the verdict, and in the review", async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  // Another player has answered the day's first question (the browser tests count a crowd from one answer).
  const other = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  await other.post("/api/guest", { data: {} });
  const run = await (await other.post("/api/day", { data: {} })).json();
  await other.post(`/api/runs/${run.id}/show`, { data: {} });
  await other.post(`/api/runs/${run.id}/start`, { data: { n: 0 } }); // its pictures in, if it has any
  expect((await other.post(`/api/runs/${run.id}/answer`, { data: { n: 0, answer: null } })).ok()).toBe(true);
  await other.dispose();

  await page.goto("/");
  await startDay(page);
  await answer(page);
  const says = page.locator(".after .verdict + .crowd-says");
  // The other answered nothing, so this may be the first right answer: then it says so, never „0%“.
  // With the tests beside it playing the day too, it's a share („днес“ held to it by a no-break space: a pattern's
  // text isn't evened out as a string's is, so the pattern says which space).
  await expect(says).toHaveText(
    /^([А-Яа-я ]+ (\d+|под 1)\u00a0% от играчите\u00a0днес|Днес (само ти го позна|още никой не го е познал))\.$/,
  );
  await moveOn(page);
  for (let n = 1; n < 10; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    await answer(page);
    await moveOn(page);
  }
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(page.locator(".reviewed").first().locator(".crowd-says")).toHaveText(/от играчите\u00a0днес\.$|^Днес /);
});

test("a topic, ten questions, a question reported, and ten more", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/almanac/history");
  await page.getByRole("link", { name: "Играй 10 въпроса" }).click();
  // A short count first, then the game starts by itself.
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveAccessibleName(/Започва след [1-3] с/);
  await playRun(page);
  // A word about a question waits for the end, in the review.
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await page.getByRole("button", { name: "Нещо не е наред с въпроса?" }).first().click();
  // Sent empty, it's asked for in the game's words, not the browser's bubble.
  await page.getByRole("button", { name: "Прати" }).click();
  await expect(page.getByRole("alert")).toHaveText("Напиши какво не е наред.");
  await page.getByLabel("Какво не е наред?").fill("Отговорът е остарял.");
  await page.getByRole("button", { name: "Прати" }).click();
  await expect(page.getByText("Благодарим ти! Ще го прегледаме.")).toBeVisible();
  await page.keyboard.press("Escape");
  // One action; the other ways on are quiet links, the way back to its chapter among them.
  await expect(page.locator(".summary .actions .btn.primary")).toHaveCount(1);
  await expect(page.locator(".result-links").getByRole("link", { name: "Към главата" })).toHaveAttribute(
    "href",
    "/almanac/history",
  );
  // Ten more from a result start at once: the player is ready, no count.
  await page.getByRole("button", { name: "Още десет въпроса" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10");
});

test("„България“: the questions about Bulgaria from every topic, a topic of its own", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/almanac");
  // One of the two ways to play at the book's head, straight to its game.
  const way = page.locator(".way").last();
  await expect(way).toContainText("България");
  await way.click();
  await expect(page).toHaveURL(/\/play\/bulgaria$/);
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await playRun(page);
  await expect(page.locator(".score-leaf .chip")).toHaveText("България");
  // Its ten come from more than one topic, each named in the review by its own.
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(page.locator(".reviewed")).toHaveCount(10);
  const topics = new Set(
    (await page.locator(".reviewed-head .kicker").allTextContents()).map((k) => k.split(" · ")[1]),
  );
  expect(topics.size).toBeGreaterThan(1);
  expect(topics.has("")).toBe(false);
  await expect(page.getByRole("button", { name: "Още десет въпроса" })).toBeVisible();
});

test("„Микс“: every topic at once, the first way to play at the book's head, with „България“ after it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/almanac");
  const ways = page.locator(".way");
  await expect(ways.first()).toContainText("Играй от всички глави");
  await expect(ways.last()).toContainText("България");
  await ways.first().click();
  await expect(page).toHaveURL(/\/play\/mix$/);
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await playRun(page);
  await expect(page.locator(".score-leaf .chip")).toHaveText("Всички глави");
  // Its ten come from more than one topic, each named in the review by its own.
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(page.locator(".reviewed")).toHaveCount(10);
  const topics = new Set(
    (await page.locator(".reviewed-head .kicker").allTextContents()).map((k) => k.split(" · ")[1]),
  );
  expect(topics.size).toBeGreaterThan(1);
});

test("a topic's count can be backed out of, or cut short", async ({ page }) => {
  await page.goto("/almanac/history");
  await page.getByRole("link", { name: "Играй 10 въпроса" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.getByRole("button", { name: "Отказ", exact: true }).click();
  await expect(page).toHaveURL(/\/almanac\/history$/);
  // Nothing started behind it.
  await page.waitForTimeout(3500);
  await expect(page).toHaveURL(/\/almanac\/history$/);

  await page.getByRole("link", { name: "Играй 10 въпроса" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/almanac\/history$/);

  await page.getByRole("link", { name: "Играй 10 въпроса" }).click();
  await page.getByRole("button", { name: "Започни сега" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10", { timeout: 1500 });
});

test("the day's count can be backed out of, and nothing starts; let run, it starts by itself", async ({ page }) => {
  await page.goto("/");
  const day = page.locator(".issue");
  await page.getByRole("button", { name: "Започни", exact: true }).click();
  await expect(page.locator(".get-ready .kicker")).toHaveText("Днешният брой");
  await page.getByRole("button", { name: "Отказ", exact: true }).click();
  await expect(day).toContainText("Десет въпроса за днес");
  // Nothing started behind it: the day is still unplayed, after a reload too.
  await page.waitForTimeout(3500);
  await expect(page.locator(".question-head")).toHaveCount(0);
  await page.reload();
  const go = page.locator(".today").getByRole("button", { name: "Започни", exact: true });
  await expect(go).toBeVisible();

  await go.click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(day).toBeVisible();

  await go.click();
  await expect(page.getByRole("timer")).toHaveAccessibleName(/Започва след [1-3] с/);
  await expect(page.locator(".question-head")).toContainText("1 от 10", { timeout: 6000 });
});

test("the day left after its third question waits on Начало, and goes on from the fourth", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await startDay(page);
  for (let n = 0; n < 3; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    await answer(page);
    if (n < 2) await moveOn(page);
  }
  // The third's answer showing, the arrow goes at once: nothing is lost between two questions.
  await expect(page.locator(".verdict")).toBeVisible();
  await page.getByRole("link", { name: "Към Днес", exact: true }).click();
  const day = page.locator(".issue");
  await expect(day).toContainText("Следва въпрос 4 от 10.");
  await expect(day.locator(".tiles .tile:is(.right, .near, .wrong)")).toHaveCount(3);
  await expect(page.locator(".places-foot")).toBeVisible();
  // The card waits: no question's time starts behind it, a reload included.
  await page.waitForTimeout(4000);
  await page.reload();
  await expect(page.locator(".issue")).toContainText("Следва въпрос 4 от 10.");
  await startDay(page, "Продължи");
  for (let n = 3; n < 10; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    await answer(page);
    await moveOn(page);
  }
  await expect(page.locator(".summary")).toBeVisible({ timeout: 10_000 });
  // Ten answers, each given and counted: the score is the right ones of the ten.
  await expect(page.locator(".summary .tiles .tile:is(.right, .near, .wrong)")).toHaveCount(10);
  const rights = await page.locator(".summary .tiles .tile.right").count();
  await expect(page.locator(".summary .score-n")).toHaveText(String(rights));
  const { run } = await (await page.request.get("/api/day")).json();
  const { questions } = await (await page.request.get(`/api/runs/${run.id}/review`)).json();
  expect(questions.map((q: { n: number }) => q.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(questions.every((q: { given: unknown }) => q.given !== null)).toBe(true);
});

test("a question left while its time runs: asked first, given up, and the topic goes on after it", async ({ page }) => {
  test.setTimeout(60_000);
  await openGame(page, "/play/history");
  await expect(page.locator(".question-head")).toContainText("1 от 10");
  await answer(page);
  await moveOn(page);
  await expect(page.locator(".question-head")).toContainText("2 от 10", { timeout: 10_000 });
  // Leaving would cost the question: the arrow asks first, and „Остани“ plays on.
  // A chapter's game is left to the Алманах, where it's played from.
  const leave = page.getByRole("link", { name: "Към Алманаха", exact: true });
  const asked = page.getByText("Ако излезеш сега, въпросът остава без отговор.");
  await leave.click();
  await expect(asked).toBeVisible();
  await page.getByRole("button", { name: "Остани" }).click();
  await expect(asked).toBeHidden();
  await expect(page.locator(".question-head")).toContainText("2 от 10");
  await leave.click();
  await page.getByRole("button", { name: "Излез" }).click();
  await expect(page).toHaveURL(/\/almanac$/);
  // The book shows the game left half-way, and the way to go on with it: the same game, the question left counted
  // unanswered, the third next.
  const left = page.locator(".book-left");
  await expect(left).toContainText("История");
  await expect(left).toContainText(/Следва въпрос \d+\u00a0от\u00a010\./);
  await left.getByRole("link", { name: "Продължи" }).click();
  await page.getByRole("button", { name: "Започни сега" }).click();
  // First, once, what the question given up was: its answer, without points; then on.
  const missed = page.locator(".given-up");
  await expect(missed).toContainText("Въпрос 2 от 10");
  await expect(missed).toContainText("Излезе, без да отговориш. Ето верния отговор.");
  await expect(missed.locator(".right").first()).toBeVisible();
  await missed.getByRole("button", { name: "Напред" }).click();
  await expect(page.locator(".question-head")).toContainText("3 от 10");
  await expect(page.locator("article.question .trail li:is(.right, .partial, .wrong)")).toHaveCount(2);
  await expect(page.locator("article.question .trail li").nth(1)).toHaveClass("wrong");
});

test("the day left at its last question comes back done, with what it earned told under it, once", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await startDay(page);
  for (let n = 0; n < 9; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    await answer(page);
    await moveOn(page);
  }
  await expect(page.locator(".question-head")).toContainText("10 от 10", { timeout: 10_000 });
  await playedFair(page); // a test answers quicker than a person: its book as a person's
  await page.getByRole("link", { name: "Към Днес", exact: true }).click();
  await page.getByRole("button", { name: "Излез" }).click();
  // Its result was never on screen: Днес has it, its tenth told as given up, the same on every visit.
  await expect(page.locator(".summary")).toBeVisible();
  await expect(page.locator(".summary .tiles .tile")).toHaveCount(10);
  await page.reload();
  await expect(page.locator(".result")).toBeVisible();
  await expect(page.locator(".result .tiles .tile:is(.right, .near, .wrong)")).toHaveCount(10);
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the keys play a topic, and Начало takes the width", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/play/history");
    await page.getByRole("button", { name: "Започни", exact: true }).click();
    // The keys still play, unsaid (no key is drawn on a button): Enter starts at once.
    await expect(page.locator(".key-hint")).toHaveCount(0);
    await page.keyboard.press("Enter");
    // 1–4 answer by the letters' order, and Enter goes on at once.
    let keyed = false;
    for (let n = 0; n < 10; n++) {
      await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
      const options = page.locator("article.question .options:not(.pic-options, .sortable-list) > button.option");
      if (!keyed && (await options.count()) === 4) {
        await expect(options.locator(".letter")).toHaveText(["А", "Б", "В", "Г"]);
        await page.keyboard.press("2");
        await expect(options.nth(1)).toHaveClass(/right|wrong/);
        await page.keyboard.press("Enter");
        keyed = true;
        continue;
      }
      await answer(page);
      await moveOn(page);
    }
    expect(keyed).toBe(true);
    await expect(page.locator(".summary")).toBeVisible({ timeout: 10_000 });
    // A player's Днес is a spread: the issue, and beside it its action, the streak and its contents.
    await page.goto("/");
    const day = await page.locator(".issue").boundingBox();
    const side = await page.locator(".today-side").boundingBox();
    expect(side && day && side.x >= day.x + day.width && Math.abs(side.y - day.y) < 64).toBe(true);
    await expect(page.locator(".contents-issue li")).toHaveCount(10);
  });

  test("Днес: a new visitor's cover, and the day's result a spread at once as after a reload", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    // The cover: the mark in the middle of the bar, the issue on the left page, its action on the right; no places.
    await expect(page.locator(".issue")).toBeVisible();
    await expect(page.locator("nav.places")).toBeHidden();
    const issue = await page.locator(".issue").boundingBox();
    const go = await page.locator(".issue-go").boundingBox();
    expect(issue && go && go.x > issue.x + issue.width).toBe(true);
    await startDay(page);
    await playRun(page);
    await expect(page.locator(".summary")).toBeVisible();
    // Just played, the result is a spread (it's drawn where the game was), as it is after a reload.
    await expect(page.locator(".tomorrow")).toContainText("С него серията ти става 2.");
    // (Few have played in a test: the right page, България's, is empty, and the score has the left one.)
    const box = async () => (await page.locator(".result-main").boundingBox())?.width ?? -1;
    const just = await box();
    expect(just).toBeGreaterThan(0);
    await page.reload();
    await expect(page.locator(".result")).toBeVisible();
    expect(await box()).toBe(just);
  });
});

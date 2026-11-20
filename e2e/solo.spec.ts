import { expect, test } from "@playwright/test";
import { answer, moveOn, openGame, playRun, startDay } from "./play.ts";

test("the day: ten questions, the result, the review, and one try only", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Десет въпроса за днес." })).toBeVisible();
  // A new visitor's cover is the day alone: no places, no streak, no topics.
  await expect(page.locator(".places-foot")).toBeHidden();
  await expect(page.locator(".streak-chip")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /История/ })).toHaveCount(0);
  await startDay(page);
  await playRun(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("от 10");
  // A first result is quiet: what its points are, in a line, said once; no XP, level or goals (the game has none).
  await expect(page.locator(".news-open")).toContainText("Точките са резултатът ти в една игра");
  await expect(page.locator(".screen")).not.toContainText(/XP|[Нн]иво \d|Цели за деня/);
  // One gold way on under the result: sharing it. Topics are played from the Алманах, duels from Приятели.
  await expect(page.locator(".summary .btn.primary")).toHaveText("Сподели резултата");
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(page.locator(".reviewed")).toHaveCount(10);
  await page.reload();
  await expect(page.locator(".result")).toBeVisible();
  await expect(page.getByRole("button", { name: "Започни" })).toHaveCount(0);
  await expect(page.locator(".places-foot")).toBeVisible();
  // The result tells the streak the day made.
  await expect(page.locator(".streak-chip")).toContainText("1");
  // Приятели has the day's board: of friends (none yet), and of all България, the player on it.
  await page.goto("/friends");
  await expect(page.getByRole("tab")).toHaveText(["Приятели", "България"]);
  await page.getByRole("tab", { name: "България" }).click();
  await expect(page.locator(".day-board .rank-row.me")).toContainText(/\d от 10\s*[\d\s]+$/);
  // A row is the place, the name and the score: no level, no title.
  await expect(page.locator(".day-board .lv, .day-board .who-title")).toHaveCount(0);
  await page.goto("/me");
  await expect(page.locator(".streak")).toBeVisible();

  // A second game tells what points are no more: once is enough.
  await openGame(page, "/play/history");
  await playRun(page);
  await expect(page.locator(".mastery-line")).toContainText("История");
  await expect(page.locator(".news-open")).toHaveCount(0);
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
  await expect(says).toHaveText(
    /^([А-Яа-я ]+ (\d+|под 1)% от играчите днес|Днес (само ти го позна|още никой не го е познал))\.$/,
  );
  await moveOn(page);
  for (let n = 1; n < 10; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    await answer(page);
    await moveOn(page);
  }
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(page.locator(".reviewed").first().locator(".crowd-says")).toHaveText(/от играчите днес\.$|^Днес /);
});

test("a topic, ten questions, a question reported, and ten more", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/almanac/history");
  await page.getByRole("link", { name: "Играй главата" }).click();
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
  await expect(page.getByText("Благодарим! Ще го прегледаме.")).toBeVisible();
  // Another topic is a tap away, under the result.
  await expect(page.locator(".other-topics .chip")).toHaveCount(3);
  await expect(page.locator(".other-topics")).not.toContainText("История");
  // Ten more from a result start at once: the player is ready, no count.
  await page.getByRole("button", { name: "Още десет" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10");
});

test("„България“: the questions about Bulgaria from every topic, a topic of its own", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/almanac");
  const chapter = page.locator(".toc-row").last();
  await expect(chapter).toContainText("България");
  await chapter.getByRole("link").click();
  await expect(page).toHaveURL(/\/almanac\/bulgaria$/);
  await page.getByRole("link", { name: "Играй главата" }).click();
  await expect(page).toHaveURL(/\/play\/bulgaria$/);
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await playRun(page);
  await expect(page.locator(".day-line .kicker")).toHaveText("България");
  // Its ten come from more than one topic, each named in the review by its own.
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(page.locator(".reviewed")).toHaveCount(10);
  const topics = new Set(
    (await page.locator(".reviewed-head .kicker").allTextContents()).map((k) => k.split(" · ")[1]),
  );
  expect(topics.size).toBeGreaterThan(1);
  expect(topics.has("")).toBe(false);
  await expect(page.getByRole("button", { name: "Още десет" })).toBeVisible();
  // The player's games name it.
  await page.goto("/me");
  await expect(page.locator(".game-what").filter({ hasText: /^България$/ })).toBeVisible();
});

test("„Микс“: every topic at once, a chapter of its own after the topics, with „България“ after it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/almanac");
  const chapters = page.locator(".toc-row");
  await expect(chapters.nth(10)).toContainText("Микс");
  await expect(chapters.nth(10)).toContainText("всички глави");
  await expect(chapters.nth(11)).toContainText("България");
  await chapters.nth(10).getByRole("link").click();
  await page.getByRole("link", { name: "Играй главата" }).click();
  await expect(page).toHaveURL(/\/play\/mix$/);
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await playRun(page);
  await expect(page.locator(".day-line .kicker")).toHaveText("Микс");
  // Its ten come from more than one topic, each named in the review by its own.
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(page.locator(".reviewed")).toHaveCount(10);
  const topics = new Set(
    (await page.locator(".reviewed-head .kicker").allTextContents()).map((k) => k.split(" · ")[1]),
  );
  expect(topics.size).toBeGreaterThan(1);
  // The player's games name it.
  await page.goto("/me");
  await expect(page.locator(".game-what").filter({ hasText: /^Микс$/ })).toBeVisible();
});

test("a topic's count can be backed out of, or cut short", async ({ page }) => {
  await page.goto("/almanac/history");
  await page.getByRole("link", { name: "Играй главата" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.getByRole("button", { name: "Откажи" }).click();
  await expect(page).toHaveURL(/\/almanac\/history$/);
  // Nothing started behind it.
  await page.waitForTimeout(3500);
  await expect(page).toHaveURL(/\/almanac\/history$/);

  await page.getByRole("link", { name: "Играй главата" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/almanac\/history$/);

  await page.getByRole("link", { name: "Играй главата" }).click();
  await page.getByRole("button", { name: "Започни сега" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10", { timeout: 1500 });
});

test("the day's count can be backed out of, and nothing starts; let run, it starts by itself", async ({ page }) => {
  await page.goto("/");
  const day = page.locator(".issue");
  await page.getByRole("button", { name: "Започни", exact: true }).click();
  await expect(page.locator(".get-ready .kicker")).toHaveText("Въпросите на деня");
  await page.getByRole("button", { name: "Откажи" }).click();
  await expect(day).toContainText("Десет въпроса за днес");
  // Nothing started behind it: the day is still unplayed, after a reload too.
  await page.waitForTimeout(3500);
  await expect(page.locator(".question-head")).toHaveCount(0);
  await page.reload();
  await expect(day.getByRole("button", { name: "Започни", exact: true })).toBeVisible();

  await day.getByRole("button", { name: "Започни", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(day).toBeVisible();

  await day.getByRole("button", { name: "Започни", exact: true }).click();
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
  await page.getByRole("link", { name: "Към Начало", exact: true }).click();
  const day = page.locator(".issue");
  await expect(day).toContainText("Следва въпрос 4 от 10.");
  await expect(day.locator(".trail li:is(.right, .partial, .wrong)")).toHaveCount(3);
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
  await expect(page.locator(".summary .trail li:is(.right, .partial, .wrong)")).toHaveCount(10);
  const rights = await page.locator(".summary .trail li.right").count();
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
  const leave = page.getByRole("link", { name: "Към Начало", exact: true });
  const asked = page.getByText("Ако излезеш сега, въпросът остава без отговор.");
  await leave.click();
  await expect(asked).toBeVisible();
  await page.getByRole("button", { name: "Остани" }).click();
  await expect(asked).toBeHidden();
  await expect(page.locator(".question-head")).toContainText("2 от 10");
  await leave.click();
  await page.getByRole("button", { name: "Излез" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".issue")).toBeVisible();
  // Back to the topic, from its chapter: the same game, the question left counted unanswered, the third next.
  await page.goto("/almanac/history");
  await page.getByRole("link", { name: "Продължи главата" }).click();
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
  await page.getByRole("link", { name: "Към Начало", exact: true }).click();
  await page.getByRole("button", { name: "Излез" }).click();
  // Its result was never on screen: Начало has it, and its news (a first day's: what points are), told now.
  await expect(page.locator(".summary")).toBeVisible();
  await expect(page.locator(".summary .news-open")).toContainText("са резултатът ти в една игра");
  await page.reload();
  await expect(page.locator(".result")).toBeVisible();
  await expect(page.locator(".result .trail")).toBeVisible();
  await expect(page.locator(".news-open")).toHaveCount(0);
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the keys play a topic, and Начало takes the width", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/play/history");
    await page.getByRole("button", { name: "Започни", exact: true }).click();
    // The count says its keys: Enter starts at once.
    await expect(page.getByRole("button", { name: "Започни сега" }).locator(".key-hint")).toHaveText("Enter");
    await page.keyboard.press("Enter");
    // Beside an answer's letter, the key that gives it; the key answers, and Enter goes on at once.
    let keyed = false;
    for (let n = 0; n < 10; n++) {
      await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
      const options = page.locator("article.question .options:not(.pic-options, .sortable-list) > button.option");
      if (!keyed && (await options.count()) === 4) {
        await expect(options.locator(".letter")).toHaveText(["А", "Б", "В", "Г"]);
        await expect(options.locator(".key-hint")).toHaveText(["1", "2", "3", "4"]);
        await page.keyboard.press("2");
        await expect(options.nth(1)).toHaveClass(/right|wrong/);
        await expect(page.locator(".up-next .key-hint")).toHaveText("Enter");
        await page.keyboard.press("Enter");
        keyed = true;
        continue;
      }
      await answer(page);
      await moveOn(page);
    }
    expect(keyed).toBe(true);
    await expect(page.locator(".summary")).toBeVisible({ timeout: 10_000 });
    // A number's name shows what it means while the mouse is on it, in a card under it, and not a moment longer (a
    // click changes nothing).
    const points = page.locator(".points").getByRole("button", { name: "точки" });
    const card = page.locator(".points .explain-pop");
    await page.evaluate(() => scrollTo(0, 0)); // the score at the top, room under it
    await points.hover();
    await expect(card).toBeVisible();
    await page.waitForTimeout(200); // its way in done, it sits where it stays
    const [word, under] = [await points.boundingBox(), await card.boundingBox()];
    expect(word && under && under.y >= word.y + word.height).toBe(true);
    await points.click();
    await expect(card).toBeVisible();
    await page.mouse.move(0, 0);
    expect(await card.isVisible()).toBe(false); // at once: nothing waits
    // A player's Днес is a spread: the issue, and beside it the friends' day and the way to the book.
    await page.goto("/");
    const day = await page.locator(".issue").boundingBox();
    const side = await page.locator(".today-side").boundingBox();
    expect(side && day && side.x >= day.x + day.width && Math.abs(side.y - day.y) < 64).toBe(true);
    await expect(page.locator(".contents-issue li")).toHaveCount(10);
  });

  test("Днес: a new visitor's cover, and the day's result a spread at once as after a reload", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    // The cover: the masthead in the middle, the date on the left page, the issue on the right; no places.
    await expect(page.locator(".issue")).toBeVisible();
    await expect(page.locator("nav.places")).toBeHidden();
    const date = await page.locator(".issue-date").boundingBox();
    const body = await page.locator(".issue-body").boundingBox();
    expect(date && body && body.x > date.x + date.width).toBe(true);
    await startDay(page);
    await playRun(page);
    await expect(page.locator(".summary")).toBeVisible();
    // Just played, the result is a spread (it's drawn where the game was), as it is after a reload.
    await expect(page.locator(".streak-chip")).toContainText("1");
    // (Few have played in a test: the right page, България's, is empty, and the score has the left one.)
    const box = async () => (await page.locator(".result-main").boundingBox())?.width ?? -1;
    const just = await box();
    expect(just).toBeGreaterThan(0);
    await page.reload();
    await expect(page.locator(".result")).toBeVisible();
    expect(await box()).toBe(just);
  });
});

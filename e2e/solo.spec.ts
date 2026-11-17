import { expect, test } from "@playwright/test";
import { answer, moveOn, openGame, playedBefore, playRun, startDay } from "./play.ts";

test("the day: ten questions, the result, the review, and one try only", async ({ page }) => {
  test.setTimeout(120_000);
  // The phone's share sheet, stood in for: what it was given is kept.
  await page.addInitScript(() => {
    navigator.share = async (data?: ShareData) => {
      (window as unknown as { shared: string }).shared = data?.text ?? "";
    };
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Десет въпроса за днес" })).toBeVisible();
  // A new player sees the day and the topics only: playing with others comes after a first game.
  await expect(page.locator(".topics").getByRole("link", { name: /История/ })).toBeVisible();
  await expect(page.locator(".modes")).toHaveCount(0);
  await expect(page.locator(".streak-chip")).toHaveCount(0);
  await startDay(page);
  await playRun(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("от 10");
  // A first result is quiet (play/unfold.go): what its points are, in a line, and what the game earned to wear; no
  // XP, level, goals or league yet.
  await expect(page.locator(".news-open")).toContainText("Точките са резултатът ти в една игра");
  await expect(page.locator(".news-xp, .level-card, .goal, .league-end")).toHaveCount(0);
  // „точки“ is a tap from what they are.
  await page.locator(".points").getByRole("button", { name: "точки" }).click();
  await expect(page.locator(".points .explain-pop")).toBeVisible();
  await page.keyboard.press("Escape");
  // After the day, the other ways to play are right there: with others, and by topic.
  await expect(page.locator(".modes").getByRole("link", { name: /Дуел/ })).toBeVisible();
  await expect(page.locator(".topics").getByRole("link", { name: /История/ })).toBeVisible();
  // Not Роял: no evening before today has had players (a fresh database), and a first week isn't sent to an empty one.
  await expect(page.locator(".modes").getByRole("link", { name: /Роял/ })).toHaveCount(0);
  // The result is shared without its answers: the day's issue and date, the score, a square for each question (and a
  // right answer few of the day's other players got, if there's one: other tests play the same day), and the player's
  // own link to it.
  await page.getByRole("button", { name: "Сподели" }).click();
  // The first share by a player still with the name drawn for them asks for theirs, once: kept as it is here.
  const sheet = page.getByRole("dialog", { name: "Как да те познаят приятелите?" });
  await expect(sheet.getByLabel("Име")).toHaveValue(/ \d{3}$/);
  await sheet.getByRole("button", { name: "Сподели" }).click();
  await expect(sheet).toHaveCount(0);
  const shared = await page.evaluate(() => (window as unknown as { shared: string }).shared);
  expect(shared).toMatch(
    /^АЛМАНАХ · Брой \d+ · \d{1,2} \p{L}+\n\d+ от 10\n[🟩🟨⬜]{10}\n(Познах въпрос \d+, който .+\n)?http:\/\/127\.0\.0\.1:\d+\/f\/[a-z0-9]{8}$/u,
  );
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(page.locator(".reviewed")).toHaveCount(10);
  await page.reload();
  await expect(page.locator(".summary")).toBeVisible();
  await expect(page.getByRole("button", { name: "Започни" })).toHaveCount(0);
  await expect(page.locator(".modes")).toBeVisible();
  // Начало's top tells the streak the day made; the level and the goals come from the second day played.
  await expect(page.locator(".streak-chip")).toContainText("1");
  await expect(page.locator(".level-chip, .card.goals")).toHaveCount(0);
  // Класации opens on the day's board, the player on it; the league and the rating aren't theirs yet.
  await page.goto("/ranks");
  await expect(page.locator(".board .row.me")).toContainText("/10");
  await expect(page.getByRole("tab")).toHaveText(["Днес", "Знания", "Всички", "Приятели"]);
  await page.goto("/me");
  await expect(page.locator(".streak")).toBeVisible();
  await expect(page.locator(".me-level-bar, .league-link")).toHaveCount(0);
  // Награди too: no XP, no goals and no league anywhere on it, folded parts included; points and achievements are
  // what „Как се печели“ tells.
  await page.goto("/rewards");
  await expect(page.getByRole("heading", { name: "Най-близо" })).toBeVisible();
  await expect(page.locator(".screen")).not.toContainText(/XP|лига|Цели за деня/);
  await expect(page.locator(".how")).toContainText("Точки.");

  // A second day: a game tells XP once, with the goals; Начало shows the level and the goals from then on.
  await playedBefore(page, 1);
  await openGame(page, "/play/history");
  await playRun(page);
  await expect(page.locator(".news-open")).toContainText("Ново: XP и цели за деня.");
  await expect(page.locator(".news-xp, .level-card.up").first()).toContainText(/\+\d+ XP/);
  await page.goto("/");
  await expect(page.locator(".level-chip")).toContainText("Ниво");
  // The day's goal is done. (The other two goals are drawn per day, and a run of the day can finish them too.)
  await expect(page.locator(".goal.done").filter({ hasText: "Изиграй въпросите на деня" })).toBeVisible();

  // A third: the league. The day put the player in the week's group, racing on the day's points (a topic's game
  // doesn't); the rating's board waits for a rated game of theirs. The group shows once it has five; until then it's
  // gathering (other tests play the same day, so it may be either).
  await playedBefore(page, 2);
  await page.goto("/ranks");
  await expect(page.getByRole("tab", { name: "Рейтинг" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Лига" }).click();
  await expect(page.locator(".league-card")).toContainText("Странджа");
  await expect(page.locator(".league-card")).toContainText("по точките от въпросите на деня");
  const mine = page.locator(".league-board .row.me, .league-gathering").first();
  await expect(mine).toContainText(/точки|Групата ти още се събира/);
  // Профил shows the league too, in a line that is a tap from the group.
  await page.goto("/me");
  await expect(page.locator(".league-link")).toContainText(/място от|Групата ти още се събира/);
  await page.locator(".league-link").click();
  await expect(page.locator(".league-board .row.me, .league-gathering").first()).toBeVisible();
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
  await page.goto("/");
  await page.locator(".topics").getByRole("link", { name: "История" }).click();
  // A short count first, then the game starts by itself.
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveAccessibleName(/Започва след [1-3] с/);
  await playRun(page);
  // A word about a question waits for the end, in the review.
  await page.getByRole("button", { name: "Прегледай въпросите" }).click();
  await page.getByRole("button", { name: "Нещо не е наред с въпроса?" }).first().click();
  await page.getByLabel("Какво не е наред?").fill("Отговорът е остарял.");
  await page.getByRole("button", { name: "Изпрати" }).click();
  await expect(page.getByText("Благодарим! Ще го прегледаме.")).toBeVisible();
  await page.getByRole("button", { name: "Още десет" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await expect(page.locator(".question-head")).toContainText("1 от 10");
});

test("„България“: the questions about Bulgaria from every topic, a topic of its own", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const tile = page.locator(".topics").getByRole("link", { name: /^България/ });
  await expect(tile).toContainText("Въпроси за България от всяка тема");
  await tile.click();
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

test("a topic's count can be backed out of, or cut short", async ({ page }) => {
  await page.goto("/");
  // All the topics at once is the first tile, where a thumb reaches first: not a topic in the corner.
  await expect(page.locator(".topics li").first()).toHaveText(/Всички теми/);
  await page.getByRole("link", { name: "Всички теми" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.getByRole("button", { name: "Откажи" }).click();
  await expect(page).toHaveURL(/\/$/);
  // Nothing started behind it.
  await page.waitForTimeout(3500);
  await expect(page).toHaveURL(/\/$/);

  await page.locator(".topics").getByRole("link", { name: "История" }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);

  await page.locator(".topics").getByRole("link", { name: "История" }).click();
  await page.getByRole("button", { name: "Започни сега" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10", { timeout: 1500 });
});

test("the day's count can be backed out of, and nothing starts; let run, it starts by itself", async ({ page }) => {
  await page.goto("/");
  const day = page.locator(".card.day");
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
  const day = page.locator(".card.day");
  await expect(day).toContainText("Следва въпрос 4 от 10.");
  await expect(day.locator(".trail li:is(.right, .partial, .wrong)")).toHaveCount(3);
  await expect(page.locator(".tabs")).toBeVisible();
  await expect(page.locator(".topics")).toBeVisible();
  // The card waits: no question's time starts behind it, a reload included.
  await page.waitForTimeout(4000);
  await page.reload();
  await expect(page.locator(".card.day")).toContainText("Следва въпрос 4 от 10.");
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
  await expect(page.locator(".card.day")).toBeVisible();
  // Back to the topic: the same game, the question left counted unanswered, the third next.
  await page.locator(".topics").getByRole("link", { name: "История" }).click();
  await page.getByRole("button", { name: "Започни сега" }).click();
  await expect(page.locator(".question-head")).toContainText("3 от 10");
  await expect(page.locator("article.question .trail li:is(.right, .partial, .wrong)")).toHaveCount(2);
  await expect(page.locator("article.question .trail li").nth(1)).toHaveClass("wrong");
});

test("an old challenge link says where playing with friends went", async ({ page }) => {
  await page.goto("/c/abc234");
  await expect(page.getByRole("heading", { name: "Тази връзка вече не работи" })).toBeVisible();
  await page.getByRole("link", { name: "Към дуелите" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Дуел" })).toBeVisible();
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
    // An answer's mark is the key that gives it; the key answers, and Enter goes on at once.
    let keyed = false;
    for (let n = 0; n < 10; n++) {
      await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
      const options = page.locator("article.question .options:not(.pic-options) .option");
      if (!keyed && (await options.count()) === 4) {
        await expect(options.locator(".letter")).toHaveText(["1", "2", "3", "4"]);
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
    await points.hover();
    await expect(card).toBeVisible();
    await page.waitForTimeout(200); // its way in done, it sits where it stays
    const [word, under] = [await points.boundingBox(), await card.boundingBox()];
    expect(word && under && under.y >= word.y + word.height).toBe(true);
    await points.click();
    await expect(card).toBeVisible();
    await page.mouse.move(0, 0);
    expect(await card.isVisible()).toBe(false); // at once: nothing waits
    // After a first game, Начало is two columns: the day and the topics, and beside them the ways to play.
    await page.goto("/");
    const day = await page.locator(".home-main").boundingBox();
    const side = await page.locator(".home-side .modes").boundingBox();
    const topics = await page.locator(".topics").boundingBox();
    expect(side && day && side.x > day.x + day.width).toBe(true);
    expect(topics && day && topics.y > day.y + day.height && Math.abs(topics.x - day.x) < 1).toBe(true);
    // Ten topics, five to a row: none alone in a row.
    const rows = await page
      .locator(".topics li:not(.topic-all)")
      .evaluateAll((li) => new Set(li.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    expect(rows).toBe(2);
  });
});

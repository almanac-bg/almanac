// Duels on one's own time (play/duels.go): a friend's, played first and sent, played back when the friend can, both
// at the end with the record and a rematch; and one against a recording of a real game.
import { expect, type Page, test } from "@playwright/test";
import { answer, befriend, meetAs, moveOn, playedFair, playRun } from "./play.ts";

/** A game opened by a tap: its count, cut short. */
async function countIn(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.getByRole("button", { name: "Започни сега" }).click();
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
  test.setTimeout(240_000);
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

  // Bo: a dot on Приятели, one line on Начало, the duel his to play, a tap away.
  await b.goto("/");
  await expect(b.locator(".streak-notice")).toContainText("Ана те покани на дуел.");
  await expect(b.locator("nav.places-foot a[href='/friends']")).toHaveClass(/news/);
  await b.locator(".streak-notice").getByRole("link", { name: "Играй" }).click();
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

  // Ana sees it in Приятели, played; his rematch is his to play first.
  await a.reload();
  await expect(a.locator(".duels")).toContainText("Изиграни");
  await expect(a.locator(".duels .duel-row").first()).toHaveClass(/s-(won|lost|draw)/);
  await b.getByRole("button", { name: "Реванш" }).click();
  await meetAs(b);
  await countIn(b);
  await expect(b.locator(".question-head .versus")).toHaveText("Дуел с Ана");
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
  const owner = await a.evaluate(async () => (await (await fetch("/api/me")).json()).user.name as string);

  const c = await (await browser.newContext()).newPage();
  await c.goto("/duel/new");
  await expect(c.getByText("Още нямаш приятели тук.")).toBeVisible();
  await c.getByRole("button", { name: "Играй срещу запис" }).click();
  await countIn(c);
  await expect(c.locator(".question-head .versus")).toContainText(owner);
  await playSecond(c, owner);
  await expect(c.getByRole("heading", { level: 1, name: /^(Победа|Загуба|Равенство)$/ })).toBeVisible({
    timeout: 10_000,
  });
  await c.keyboard.press("Shift");
  await expect(c.locator(".duel-head .kicker")).toHaveText("Дуел срещу запис");
  await expect(c.locator(".duel-meant")).toContainText(`Записът е от истинска игра на ${owner}`);
  await expect(c.getByRole("button", { name: "Още един срещу запис" })).toBeVisible();
});

test("a duel that is gone is said to be gone, to a guest too: not a sign-in", async ({ page }) => {
  await page.goto("/");
  expect((await page.request.post("/api/guest", { data: {} })).ok()).toBe(true);
  await page.goto("/duel/999999");
  await expect(page.getByRole("heading", { name: "Тази страница я няма" })).toBeVisible();
});

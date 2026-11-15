import { expect, test } from "@playwright/test";
import { answer, playRun } from "./play.ts";

// The test server runs a Роял every half minute (playwright.config.ts). The three engines' runs of this test may well
// meet in the same one, as players do. A wrong answer puts nobody out: the game always runs its fifteen questions,
// cut after some of them to those ahead, and those cut play on to the end, off the standings.
test("Роял: in from the lobby, its music, live to the fifteenth question, then the standings", async ({ page }) => {
  test.setTimeout(480_000);
  // The lobby's music, watched: its pad's saws started, and stopped (each is given its latest end as it starts).
  await page.addInitScript(() => {
    const w = window as unknown as { saws: number; stops: number };
    w.saws = 0;
    w.stops = 0;
    const { start, stop } = OscillatorNode.prototype;
    OscillatorNode.prototype.start = function (when?: number) {
      if (this.type === "sawtooth") w.saws++;
      start.call(this, when);
    };
    OscillatorNode.prototype.stop = function (when?: number) {
      if (this.type === "sawtooth") w.stops++;
      stop.call(this, when);
    };
  });
  const pad = () =>
    page.evaluate(() => {
      const w = window as unknown as { saws: number; stops: number };
      return { saws: w.saws, stops: w.stops };
    });
  // „Музика в Роял“ off (as Настройки keeps it, read as the page loads).
  await page.goto("/royal");
  await page.evaluate(() => localStorage.setItem("almanac.music", "off"));
  await page.reload();
  // A game under way (another engine's) ends before the next lobby opens. In by the lobby's „Влез“, not the door of a
  // game under way (which lets one in late), with time before the start for the music's turns.
  await expect(async () => {
    const [m = 0, s = 0] = ((await page.locator(".royal-count").textContent({ timeout: 2_000 })) ?? "").split(":");
    expect(Number(m) * 60 + Number(s)).toBeGreaterThanOrEqual(12);
  }).toPass({ timeout: 300_000 });
  await page.locator(".screen > button", { hasText: "Влез" }).click();
  await expect(page.getByRole("button", { name: "Излез" })).toBeVisible();
  await expect(page.getByText("Вътре си.")).toBeVisible();
  // No music with its switch off, though in and touched; with it on (as by default), none before a touch, and from
  // the first one, the lobby's quiet bed.
  await page.waitForTimeout(1000);
  expect(await pad()).toEqual({ saws: 0, stops: 0 });
  await page.evaluate(() => localStorage.removeItem("almanac.music"));
  await page.reload();
  await expect(page.getByText("Вътре си.")).toBeVisible();
  await page.waitForTimeout(1000);
  expect((await pad()).saws).toBe(0);
  await page.getByRole("heading", { level: 1 }).click();
  await expect.poll(pad).toEqual({ saws: 4, stops: 4 });

  const standings = page.getByRole("heading", { name: "Класиране" });
  // The first answer doesn't get through (the line drops as it's sent): it's sent again, and taken.
  await page.route("**/api/royal/answer", (route) => route.abort("connectionreset"), { times: 1 });
  for (let n = 0; n < 15; n++) {
    const asked = page.locator(".question-head").filter({ hasText: `${n + 1} от 15` });
    await expect(asked).toBeVisible({ timeout: 60_000 });
    if (n === 0) {
      // The first question ends the music.
      expect(await pad()).toEqual({ saws: 4, stops: 8 });
      await expect(page.locator(".royal-left")).toHaveText(/^В играта: \d+ от \d+$|^В турнира си само ти: /);
    }
    await answer(page);
    // The answer shows once everyone still in has answered (or the time is up, for one cut), with the standings.
    await expect(page.locator(".verdict")).toBeVisible({ timeout: 40_000 });
    if (n === 0) await expect(page.locator(".verdict")).not.toContainText("Без отговор");
    await expect(page.locator(".royal-table .row.me")).toBeVisible();
  }
  // The end: the standings of all, after the fifteenth question.
  await expect(page.locator(".intro").getByText(/верни\./)).toBeVisible({ timeout: 360_000 });
  await expect(standings).toBeVisible();
  await expect(page.locator(".royal-table .row.me")).toBeVisible();
  await expect(page.getByText(/Следващият Роял:/)).toBeVisible();
});

test("Роял: „Ще дойда“ before the lobby, and Начало's card while it's open", async ({ page }) => {
  test.setTimeout(360_000);
  // Начало shows the ways to play with others once a first game is finished.
  await page.goto("/play/history");
  await playRun(page);
  await page.goto("/royal");
  // „Ще дойда“ shows until the next lobby opens: before it, and under the standings of an evening over (which show a
  // while, here into the next evenings).
  await expect(async () => {
    await page.reload();
    const come = page.getByRole("button", { name: "Ще дойда" });
    const said = page.getByText(/^Ще дойдеш\./);
    await expect(come.or(said)).toBeVisible({ timeout: 30_000 });
    if (await come.isVisible()) await come.click();
    await expect(said).toBeVisible({ timeout: 2_000 });
    await expect(page.getByText(/^Тази вечер ще дойд(е|ат) \d+\.$/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 240_000 });

  // While the lobby is open, Начало's Роял card says how soon it starts and how many are in.
  await page.goto("/");
  const royal = page.locator(".mode.tone-gold .mode-about");
  await expect(async () => {
    await page.reload();
    await expect(royal).toHaveText(/^Започва след \d+\sмин( · \d+\sвътре)?$/, { timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
});

test("Роял: one who comes late comes in until the third question", async ({ page, browser }) => {
  test.setTimeout(360_000);
  const { baseURL, locale } = test.info().project.use;
  const other = await browser.newContext({ baseURL, locale });
  const early = await other.newPage();
  // Someone is in at the start, so that a game runs.
  await early.goto("/royal");
  await early.locator(".screen > button", { hasText: "Влез" }).click({ timeout: 300_000 });
  await expect(early.getByText("Вътре си.")).toBeVisible();

  await page.goto("/royal");
  const door = page.getByText("Роял вече започна. До 3-тия въпрос още можеш да влезеш.");
  await expect(door).toBeVisible({ timeout: 60_000 });
  await page.locator(".card", { has: door }).getByRole("button", { name: "Влез" }).click();
  await expect(door).toBeHidden();
  await expect(page.locator(".royal-table .row.me").or(page.locator(".question .option").first())).toBeVisible({
    timeout: 30_000,
  });
  await other.close();
});

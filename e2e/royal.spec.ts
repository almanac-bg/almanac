import { expect, test } from "@playwright/test";
import { answer, meetAs, openGame, playRun } from "./play.ts";

// The test server runs a Роял every half minute (playwright.config.ts). The three engines' runs of this test may well
// meet in the same one, as players do. A wrong answer puts nobody out: the game always runs its fifteen questions,
// cut after some of them to those ahead, and those cut play on to the end, off the standings.
//
// One engine's tests here run one after another, in this order: „Ще дойда“ shows only while no evening is under
// way nor its standings showing (some 4½ minutes each), so it's said first, before this file's own evenings.
test.describe.configure({ mode: "default" });

test("Роял: „Ще дойда“ before the lobby, and Начало's card while it's open", async ({ page }) => {
  test.setTimeout(480_000);
  // Before any game, Начало shows Роял alone among the ways to play with others, while its lobby is open.
  await page.goto("/");
  await expect(async () => {
    await page.reload();
    await expect(page.locator(".modes .mode")).toHaveCount(1, { timeout: 3_000 });
    await expect(page.locator(".mode.tone-gold .mode-about")).toHaveText(/^Започва след|^Играе се/);
  }).toPass({ timeout: 60_000 });
  // Роял's card says what it is: its name alone doesn't.
  await expect(page.locator(".mode.tone-gold .mode-kind")).toHaveText("Турнир на живо");
  // Начало shows the ways to play with others once a first game is finished.
  await openGame(page, "/play/history");
  await playRun(page);
  await page.goto("/royal");
  // „Ще дойда“ shows until the next lobby opens. Here, a Роял every half minute, that's the five seconds before each
  // lobby, and only while no evening is under way: under an evening's standings the next lobby is open already (the
  // other engines' evenings, when all three run on one server, may hold it a while).
  await expect(async () => {
    await page.reload();
    const come = page.getByRole("button", { name: "Ще дойда" });
    const said = page.getByText(/^Записа се\./);
    await expect(come.or(said)).toBeVisible({ timeout: 30_000 });
    if (await come.isVisible()) await come.click();
    await expect(said).toBeVisible({ timeout: 2_000 });
    await expect(page.getByText(/^Тази вечер ще дойд(е|ат) \d+\.$/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 360_000 });

  // While the lobby is open, Начало's Роял card says how soon it starts and how many are in.
  await page.goto("/");
  const royal = page.locator(".mode.tone-gold .mode-about");
  await expect(async () => {
    await page.reload();
    await expect(royal).toHaveText(/^Започва след \d+\sмин\.( · \d+\sвътре)?$/, { timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
});

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
    // „2:05 мин.“, or „42 с“ in the last minute.
    const text = (await page.locator(".royal-count").textContent({ timeout: 2_000 })) ?? "";
    const [m = "0", s = "0"] = text.includes(":") ? text.split(":") : ["0", text];
    expect(Number(m) * 60 + Number.parseInt(s, 10)).toBeGreaterThanOrEqual(12);
  }).toPass({ timeout: 300_000 });
  await page.locator(".screen > button", { hasText: "Влез" }).click();
  await meetAs(page);
  await expect(page.getByRole("button", { name: "Излез" })).toBeVisible();
  await expect(page.getByText("Вътре си.")).toBeVisible();
  // Never in a Роял before: how it's played, in a line, in the lobby.
  await expect(page.getByText(/^Грешката не те изважда: след 5\u2011ия/)).toBeVisible();
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
  // On the narrowest phone, the standings under each answer scroll; each question opens at the top all the same.
  await page.setViewportSize({ width: 320, height: 568 });
  for (let n = 0; n < 15; n++) {
    const asked = page.locator(".question-head").filter({ hasText: `${n + 1} от 15` });
    await expect(asked).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => scrollY)).toBe(0);
    if (n === 0) {
      // The first question ends the music.
      expect(await pad()).toEqual({ saws: 4, stops: 8 });
      await expect(page.locator(".royal-left")).toHaveText(/^В играта: \d+ от \d+$|^В турнира си само ти: /);
      // Before the first answer, everyone is level: no place yet.
      await expect(page.locator(".royal-me")).toHaveCount(0);
    }
    await answer(page);
    // The answer shows once everyone playing has answered (or the time is up), with the standings.
    await expect(page.locator(".verdict")).toBeVisible({ timeout: 40_000 });
    if (n === 0) await expect(page.locator(".verdict")).not.toContainText("Времето изтече");
    // Роял counts right answers and their time, not points: the verdict has none.
    await expect(page.locator(".verdict .verdict-pts")).toHaveCount(0);
    await expect(page.locator(".royal-table .row.me")).toBeVisible();
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  }
  // The end: the standings of all, after the fifteenth question (a place on the podium, met with another engine's
  // run, comes first as a sheet over them, with its share).
  await expect(page.locator(".intro").getByText(/ верни/)).toBeVisible({ timeout: 360_000 });
  const podium = page.locator("dialog[open]");
  if (await podium.isVisible()) {
    await expect(podium.getByRole("button", { name: "Сподели" })).toBeVisible();
    await podium.getByRole("button", { name: "Продължи" }).click();
  }
  await expect(standings).toBeVisible();
  await expect(page.locator(".royal-table .row.me")).toBeVisible();
  await expect(page.getByText(/Следващият Роял:/)).toBeVisible();
  // The day's ten haven't been played: they're the gold way on.
  await expect(page.getByRole("link", { name: "Към въпросите на деня" })).toHaveClass(/primary/);
});

test("Роял: one who comes late comes in until the third question", async ({ page, browser }) => {
  test.setTimeout(360_000);
  const { baseURL, locale } = test.info().project.use;
  const other = await browser.newContext({ baseURL, locale });
  const early = await other.newPage();
  // Someone is in at the start, so that a game runs.
  await early.goto("/royal");
  await early.locator(".screen > button", { hasText: "Влез" }).click({ timeout: 300_000 });
  await meetAs(early);
  await expect(early.getByText("Вътре си.")).toBeVisible();

  await page.goto("/royal");
  const door = page.getByText("Роял вече започна. До 3\u2011тия въпрос още можеш да влезеш.");
  await expect(door).toBeVisible({ timeout: 60_000 });
  await page.locator(".card", { has: door }).getByRole("button", { name: "Влез" }).click();
  await meetAs(page);
  await expect(door).toBeHidden();
  await expect(page.locator(".royal-table .row.me").or(page.locator(".question .option").first())).toBeVisible({
    timeout: 30_000,
  });
  // Роял opened as the tab's first page (as from its notification): back asks first, and doesn't leave the site.
  const asked = page.getByText("Излизаш от Роял? Играта продължава без теб");
  await page.goBack();
  await expect(asked).toBeVisible();
  await expect(page).toHaveURL(/\/royal$/);
  await page.getByRole("button", { name: "Остани" }).click();
  await expect(asked).toBeHidden();
  await other.close();
});

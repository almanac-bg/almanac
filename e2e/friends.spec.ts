import { expect, type Locator, test } from "@playwright/test";
import { befriend, linkedNames, playedBefore, playedFair, playRun, readText, startDay } from "./play.ts";

test("friends on the day: who has played it, and how each went", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // Ana plays the day with no friends yet: the day's board on her result opens on all България; among friends it says
  // she has none, with the way to Приятели to add some.
  await a.goto("/");
  await startDay(a);
  await playRun(a);
  await playedFair(a);
  await a.reload();
  const hersBoard = a.locator(".day-board");
  await expect(hersBoard.getByRole("tab", { name: "Всички" })).toHaveAttribute("aria-selected", "true");
  await hersBoard.getByRole("tab", { name: "Приятели" }).click();
  await expect(hersBoard).toContainText("Още нямаш приятели.");
  await expect(hersBoard.getByRole("link", { name: "Добави приятели" })).toHaveAttribute("href", "/friends");
  // Her own day is on the board all the same.
  await expect(hersBoard.locator(".rank-row.me")).toHaveCount(1);
  const ana = await a.evaluate(async () => (await (await fetch("/api/me")).json()).user.name as string);

  // Bo asks her by her username, and she says yes. Днес is the day alone: the day's board comes with his result.
  await befriend(a, b);
  await b.goto("/");
  await expect(b.locator(".day-board")).toHaveCount(0);

  // He plays the day: one gold action, and under his result the day's board, open among friends: both of them, in
  // places, each with their score and squares, his own row marked.
  await startDay(b);
  await playRun(b);
  await expect(b.locator(".tomorrow")).toBeVisible();
  await expect(b.locator(".summary .btn.primary")).toHaveCount(1);
  const friends = b.locator(".day-board");
  await expect(friends.getByRole("heading", { name: "Класация" })).toBeVisible();
  await expect(friends.getByRole("tab", { name: "Приятели" })).toHaveAttribute("aria-selected", "true");
  await expect(friends.locator(".rank-row")).toHaveCount(2);
  await expect(friends.locator(".rank-row .rank-place")).toHaveCount(2);
  await expect(friends.locator(".rank-row .mini")).toHaveCount(2);
  await expect(friends.locator(".rank-row.me .rank-you")).toHaveText(" ти");
  await expect(friends.locator(".rank-row").filter({ hasText: ana }).locator(".rank-score")).toHaveText(
    /^\d+\sот\s10$/,
  );
  // On each avatar's corner, the seal its player wears, as the server says it (none before a rank: her ink is her right
  // answers'), in her chapter's colour; never after the name.
  const seal = await b.evaluate(
    async () =>
      ((await (await fetch("/api/friends")).json()).friends[0].seal ?? null) as {
        chapter: string;
        level: number;
      } | null,
  );
  const row = friends.locator(".rank-row").filter({ hasText: ana });
  const worn = row.locator(".avatar > .seal");
  await expect(worn).toHaveCount(seal ? 1 : 0);
  await expect(row.locator(".friend-name .seal")).toHaveCount(0);
  if (seal) {
    await expect(worn).toHaveClass(new RegExp(`t-${seal.chapter}`));
    // Read out as a seal and its chapter: never the rank's word, which is the Алманах's.
    await expect(worn).toHaveAttribute("aria-label", /^Печат: [^:]+$/);
  }
  // All България a tap away, on the same card, the two of them on it.
  await friends.getByRole("tab", { name: "Всички" }).click();
  await expect(friends.locator(".rank-row").filter({ hasText: ana })).toHaveCount(1);
  await expect(friends.locator(".rank-row.me")).toHaveCount(1);
  // Приятели is the people and the duels: the day's board isn't there.
  await b.goto("/friends");
  await expect(b.locator(".friend")).toHaveCount(1);
  await expect(b.locator(".day-board")).toHaveCount(0);
});

test("friends by tag: a name and a tag of one's own, a request, a yes", async ({ browser }, info) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const tag = `ana.p_${info.project.name.slice(0, 3)}${Date.now() % 100000}`;

  // Ana becomes a player, and takes a full name (anyone's) and a tag (hers alone, with a dot in it).
  await a.goto("/friends");
  await a.locator(".friends").getByRole("button", { name: "Добави приятел" }).click();
  await a.goto("/settings");
  await a.getByLabel("Име", { exact: true }).fill("Ана Петрова");
  await a.getByLabel("Потребителско име", { exact: true }).fill(`@${tag}`);
  await a.getByRole("button", { name: "Запази" }).click();
  await expect(a.getByText("Запазено.")).toBeVisible();
  // A tag the game doesn't take: its rule in the game's words (not the browser's), the last „Запазено.“ gone.
  await a.getByLabel("Потребителско име", { exact: true }).fill("мечка");
  await expect(a.getByText("Запазено.")).toHaveCount(0);
  await a.getByRole("button", { name: "Запази" }).click();
  await expect(a.locator("form .bad")).toHaveText(/^Потребителското име трябва да е от 3 до 20 знака/);
  await a.getByLabel("Потребителско име", { exact: true }).fill(`@${tag}`);
  await a.goto("/me");
  await expect(a.locator(".me-tag")).toHaveText(`@${tag}`);

  // Bo asks her by that tag; an unknown tag is said to be unknown. A guest who hasn't finished a game is told to play
  // one first: a request is a player's.
  await b.goto("/friends");
  await b.locator(".friends").getByRole("button", { name: "Добави приятел" }).click();
  await expect(b.getByText("Още нямаш приятели тук. Добави ги по потребителско име или имейл.")).toBeVisible();
  // The field's hint is whole at every width: the button goes under the field before the hint is cut.
  const field = b.getByLabel("Потребителско име или имейл на приятел");
  for (const width of [320, 390, 430, 1366]) {
    await b.setViewportSize({ width, height: 800 });
    const room = await field.evaluate((el: HTMLInputElement) => {
      const s = getComputedStyle(el);
      const hint = getComputedStyle(el, "::placeholder");
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return 0;
      ctx.font = `${hint.fontWeight} ${hint.fontSize} ${hint.fontFamily}`;
      const inner = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      return inner - ctx.measureText(el.placeholder).width;
    });
    expect(room, `the hint at ${width}px`).toBeGreaterThanOrEqual(0);
  }
  // Nothing typed: said in the game's words, the cursor in the field.
  await b.getByRole("button", { name: "Добави", exact: true }).click();
  await expect(b.getByRole("alert")).toHaveText("Въведи потребителско име или имейл.");
  await expect(b.getByLabel("Потребителско име или имейл на приятел")).toBeFocused();
  await b.getByLabel("Потребителско име или имейл на приятел").fill(`@${tag}`);
  await b.getByRole("button", { name: "Добави", exact: true }).click();
  await expect(b.getByText("Първо изиграй една игра, после добавяй приятели.")).toBeVisible();
  await playedBefore(b, 1);
  await b.getByLabel("Потребителско име или имейл на приятел").fill("@nosuch_player_here");
  await b.getByRole("button", { name: "Добави", exact: true }).click();
  await expect(b.getByText("Няма играч с такова потребителско име.")).toBeVisible();
  await b.getByLabel("Потребителско име или имейл на приятел").fill(`@${tag.toUpperCase()}`);
  await b.getByRole("button", { name: "Добави", exact: true }).click();
  await expect(b.getByText("Поканата до Ана Петрова е изпратена.")).toBeVisible();
  await expect(b.locator(".waiting")).toContainText("Ана Петрова");
  // Its name a link as every player's name is: one rule for all of them, never underlined only in part.
  expect(await linkedNames(b)).toEqual([]);

  // Ana sees the dot on Приятели in the bar and the request there, and says yes.
  await a.goto("/");
  const bar = a.getByRole("navigation", { name: "Основна навигация" });
  await expect(bar.getByRole("link", { name: /Приятели/ })).toHaveClass(/news/);
  await bar.getByRole("link", { name: /Приятели/ }).click();
  await expect(a).toHaveURL(/\/friends$/);
  // Opened: the dot goes at once, though the request still waits for her answer.
  await expect(bar.getByRole("link", { name: /Приятели/ })).not.toHaveClass(/news/);
  // Who asks, as every row of players has them: the avatar, the name (a way to their profile), and the ask under it.
  await expect(a.locator(".invitation a.who .avatar")).toHaveCount(1);
  await expect(a.locator(".invitation .invitation-line")).toHaveText("Иска да сте приятели.");
  await a.locator(".invitation").getByRole("button", { name: "Приеми" }).click();
  await expect(a.locator(".friend")).toHaveCount(1);
  await b.reload();
  // One friend of that name: the name alone, the @username left to her profile.
  await expect.poll(() => readText(b.locator(".friend .friend-name"))).toMatch(/^Ана Петрова/);
  await expect(b.locator(".friend .friend-tag")).toBeHidden();

  // Bo hears of her yes in Приятели, once, over his friends; nothing over the day (Днес is the issue and the streak).
  const yes = b.locator(".friends .accepted-notice");
  await expect(yes).toHaveText("Ана Петрова прие поканата ти за приятелство.");
  await b.reload();
  await expect(b.locator(".friend")).toHaveCount(1);
  await expect(yes).toHaveCount(0);
  await b.goto("/");
  await expect(b.locator(".day")).toBeVisible();
  await expect(b.locator(".notices")).toBeEmpty();

  // Her name in Приятели takes him to her page, by her tag, dot and all; and the page opens by it at once too.
  await b.goto("/friends");
  await b.locator(".friend a.friend-name").click();
  await expect(b).toHaveURL(new RegExp(`/players/${tag.replace(".", "\\.")}$`));
  await expect(b.locator(".me-tag")).toHaveText(`@${tag}`);
  await b.reload();
  await expect(b.locator(".me-tag")).toHaveText(`@${tag}`);
});

test("a request turned down, a friend removed", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const p of [a, b]) {
    await p.goto("/friends");
    await p.locator(".friends").getByRole("button", { name: "Добави приятел" }).click();
  }
  await playedBefore(b, 1);
  const tag = await a.evaluate(async () => (await (await fetch("/api/me")).json()).user.tag as string);
  const ask = async () => {
    await b.goto("/friends");
    await b.getByLabel("Потребителско име или имейл на приятел").fill(`@${tag}`);
    await b.getByRole("button", { name: "Добави", exact: true }).click();
    await expect(b.getByText(/^Поканата до .+ е изпратена\.$/)).toBeVisible();
  };
  await ask();

  // Ana says no: the request is gone from both.
  await a.reload();
  await a.locator(".invitation").getByRole("button", { name: "Откажи" }).click();
  await expect(a.locator(".invitation")).toHaveCount(0);
  await b.reload();
  await expect(b.locator(".waiting")).toHaveCount(0);

  // He asks again, she says yes; then she removes him, and they're friends no more on either side.
  await ask();
  await a.reload();
  await a.locator(".invitation").getByRole("button", { name: "Приеми" }).click();
  await expect(a.locator(".friend")).toHaveCount(1);
  await a.getByRole("button", { name: "Премахни приятел" }).click();
  // Asked first: „Отказ“ leaves him there.
  await a.locator(".friend").getByRole("button", { name: "Премахни" }).click();
  const sure = a.getByRole("dialog");
  await expect(sure.getByRole("heading")).toHaveText(/^Премахваш ли .+ от приятелите си\?$/);
  await sure.getByRole("button", { name: "Отказ" }).click();
  await expect(a.getByRole("dialog")).toHaveCount(0);
  await expect(a.locator(".friend")).toHaveCount(1);
  // Said yes to, it's done at once.
  await a.locator(".friend").getByRole("button", { name: "Премахни" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "Премахни" }).click();
  await expect(a.locator(".friend")).toHaveCount(0);
  await b.reload();
  await expect(b.getByText("Още нямаш приятели тук. Добави ги по потребителско име или имейл.")).toBeVisible();
});

test("a friend just accepted is on the day's board at once", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const p of [a, b]) {
    await p.goto("/");
    await startDay(p);
    await playRun(p);
    await playedFair(p);
  }
  const bo = await b.evaluate(async () => (await (await fetch("/api/me")).json()).user.name as string);
  // Ana says yes in Приятели (befriend), and the day's board on her result is among the two of them, Bo on it.
  await befriend(a, b);
  await a.goto("/");
  const board = a.locator(".day-board");
  await expect(board.getByRole("tab", { name: "Приятели" })).toHaveAttribute("aria-selected", "true");
  await expect(board.locator(".rank-row").filter({ hasText: bo })).toHaveCount(1);
  await expect(board.locator(".rank-row")).toHaveCount(2);
});

// On the narrowest phone, at the usual text and at twice it, the day played: the day's board's rows hold their score
// and small squares on both its tabs, nothing goes sideways, and in Приятели „Дуели“ with „Нов дуел“ is there without
// a friend.
test("the day's board at 320 px, the day played: the rows hold their squares, and a duel is a tap away", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext({ viewport: { width: 320, height: 568 }, bypassCSP: true })).newPage();
  await page.goto("/");
  await startDay(page);
  await playRun(page);
  for (const percent of [100, 200]) {
    // Twice the text from the page's start, as a phone set to large text gives it (CSP lets the test add a style).
    if (percent !== 100)
      await page.addInitScript((p) => {
        const style = document.createElement("style");
        style.textContent = `html { font-size: ${p}% !important; }`;
        new MutationObserver(() => document.head && !style.isConnected && document.head.append(style)).observe(
          document,
          { childList: true, subtree: true },
        );
      }, percent);
    await page.goto("/friends");
    if (percent !== 100) {
      await expect(page.locator("html")).toHaveCSS("font-size", `${(16 * percent) / 100}px`);
      await expect(page.locator("html")).toHaveClass(/\btight\b/);
    }
    await expect(page.locator(".duels").getByRole("link", { name: "Нов дуел" })).toBeVisible();
    await page.goto("/");
    for (const tab of ["Приятели", "Всички"]) {
      await page.locator(".day-board").getByRole("tab", { name: tab }).click();
      const rows = page.locator(".day-board .rank-row");
      await expect(rows.first().locator(".mini")).toBeVisible();
      const flaws = await page.evaluate(() => {
        const out: string[] = [];
        if (document.documentElement.scrollWidth > innerWidth)
          out.push(`the page ${document.documentElement.scrollWidth}px`);
        for (const row of document.querySelectorAll(".day-board .rank-row")) {
          const edge = row.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(row).paddingRight);
          for (const el of row.querySelectorAll("*"))
            if (el.getBoundingClientRect().right > edge + 1) out.push(`${el.className} past its row`);
        }
        return out;
      });
      expect(flaws, `${tab} at ${percent} %`).toEqual([]);
    }
  }
});

test("a day of none right isn't rubbed in: no place on the board of all България, only how many played", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await startDay(page);
  await playRun(page);
  // The day as the server says it, its board as 53 played it, the player's own row with 3 right or none; Днес opened
  // again from another place, so that it asks for the day.
  const row = (name: string, rights: number, me = false) => ({ name, rights, of: 10, me });
  for (const rights of [3, 0]) {
    await page.route("**/api/day", async (route) => {
      const day = await (await route.fetch()).json();
      day.friends = [];
      day.befriended = false;
      day.board = {
        ...day.board,
        players: 53,
        place: rights ? 20 : 53,
        top: [row("Ана", 9), row("Бо", 8)],
        mine: row("Аз", rights, true),
      };
      await route.fulfill({ json: day });
    });
    await page.locator("nav.places-foot").getByRole("link", { name: "Алманах" }).click();
    await page.locator("nav.places-foot").getByRole("link", { name: "Днес" }).click();
    // No friends: the board opens on all България.
    const board = page.locator(".day-board");
    await expect(board.getByRole("tab", { name: "Всички" })).toHaveAttribute("aria-selected", "true");
    await expect(board.locator(".board-note")).toHaveText(
      rights ? /^В България си на 20\S* място от 53\.$/ : "Днес играха 53 души.",
    );
    await page.unroute("**/api/day");
  }
});

test.describe("on a 320 × 568 phone", () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true });

  test("what a tap brings up shows above the places at the foot, never behind them", async ({ page }) => {
    test.setTimeout(90_000);
    // What came up, scrolled into sight by the one helper (ui.ts, inSight), whose margin keeps it clear of the places
    // wherever it is on the page: its foot over theirs once it has scrolled there.
    const clear = (what: string) =>
      expect
        .poll(
          () =>
            page
              .locator(what)
              .last()
              .evaluate((el) => {
                const places = document.querySelector(".places-foot")?.getBoundingClientRect();
                const top = places?.top ?? innerHeight;
                const room = Number.parseFloat(getComputedStyle(el.closest(".in-sight") ?? el).scrollMarginBottom);
                return el.getBoundingClientRect().bottom <= top && room >= (places?.height ?? 0);
              }),
          { message: what },
        )
        .toBe(true);
    // A tap as a thumb makes it: on what it taps, just over the places, where what it brings up has no room below.
    const tap = async (what: Locator) => {
      await what.evaluate((el) => {
        const foot = document.querySelector(".places-foot")?.getBoundingClientRect().top ?? innerHeight;
        scrollBy(0, el.getBoundingClientRect().bottom - foot + 4);
      });
      await what.click();
    };
    await page.goto("/friends");
    await page.locator(".friends").getByRole("button", { name: "Добави приятел" }).click();
    await playedBefore(page, 1);
    await page.reload();
    // „Добави“'s answer, under the field.
    await page.getByLabel("Потребителско име или имейл на приятел").fill("@nobody_here_at_all");
    await tap(page.getByRole("button", { name: "Добави", exact: true }));
    await clear(".add-friend .bad");
    // „Изтрий профила“'s ask, at Настройки' foot.
    await page.goto("/settings");
    await tap(page.getByRole("button", { name: "Изтрий профила" }));
    await clear(".settings .btn.danger");
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { answer, moveOn, openGame, playRun, startDay } from "./play.ts";

/** Text on a chapter's sheet (`.leaf`) in anything but the sheet's own ink: the page's greys (--ink-2, --ink-3,
 * --grey) are made for the page, and on a chapter's colour they fall as low as 1.05:1 by night. Text on a ground of its
 * own inside the sheet (a chip, the issue's pill) is that ground's, and not judged here. */
async function greyOnSheets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const sheet of document.querySelectorAll<HTMLElement>(".leaf")) {
      const ink = getComputedStyle(sheet).color;
      for (const el of sheet.querySelectorAll<HTMLElement>("*")) {
        const words = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
        if (!words || !el.getClientRects().length) continue;
        let ground: HTMLElement | null = el;
        while (ground && ground !== sheet && getComputedStyle(ground).backgroundColor === "rgba(0, 0, 0, 0)")
          ground = ground.parentElement;
        if (ground !== sheet) continue;
        const color = getComputedStyle(el).color;
        if (color !== ink) out.push(`${el.className}: ${el.textContent?.trim().slice(0, 24)} (${color})`);
      }
    }
    return out;
  });
}

// The main screens, light and dark: nothing axe finds (contrast, names, roles, structure).
for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    for (const path of [
      "/",
      "/duel/new",
      "/me",
      "/friends",
      "/settings",
      "/almanac",
      "/almanac/history",
      "/privacy",
      "/play/geography",
    ]) {
      test(`${path} is accessible`, async ({ page }) => {
        const check = async () => {
          const { violations } = await new AxeBuilder({ page }).analyze();
          expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
        };
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await check();
        expect(await greyOnSheets(page)).toEqual([]);
        // A topic opened by its address: „Започни“ first, its count, then a question.
        if (path === "/play/geography") {
          await page.getByRole("button", { name: "Започни", exact: true }).click();
          await page.getByRole("button", { name: "Започни сега" }).click();
          await expect(page.locator(".split, .options, .keypad, .tf-options, .match").first()).toBeVisible();
          await check();
        }
      });
    }
  });
}

// A run as a screen reader has it: each question takes the focus as it opens, and its answer's verdict is said once,
// in plain words, in the run's one live region; the answer shown passes axe too.
for (const scheme of ["light", "dark"] as const) {
  test(`a run is read out: the question takes the focus, the verdict is said (${scheme})`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ colorScheme: scheme });
    await openGame(page, "/play/history");
    const region = page.locator(".run > [role=status]");
    await expect(region).toHaveCount(1);
    for (let n = 0; n < 2; n++) {
      await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`);
      await expect(page.locator("h1.ask")).toBeFocused();
      await answer(page);
      await expect(region).toHaveText(/^(Точно!|Вярно!|Близо, но не се брои\.|Не е това\.|Времето изтече\.)/);
      // The verdict on the screen says nothing by itself: the region says it.
      await expect(page.locator(".after .verdict")).not.toHaveAttribute("role");
      if (n === 0) {
        await expect(page.locator(".after .up-next-go")).toBeVisible();
        // Once what fades in has (a colour mid-fade isn't one to judge).
        await page.waitForFunction(() =>
          document.getAnimations().every((a) => !(a instanceof CSSAnimation) || a.playState !== "running"),
        );
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      }
      await moveOn(page);
    }
  });
}

// The day played: its result, the news it brought and the way on.
for (const scheme of ["light", "dark"] as const) {
  test(`the day's result is accessible (${scheme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await startDay(page);
    await playRun(page);
    await expect(page.locator(".result-share")).toBeVisible();
    // The day's board in, on its first tab (all България: no friends yet), then on the other.
    await expect(page.locator(".day-board .rank-row").first()).toBeVisible();
    // The result's moment over (feel.ts: the tiles, the score), every part as it stays.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    for (const tab of ["България", "Приятели"]) {
      await page.locator(".day-board").getByRole("tab", { name: tab }).click();
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        tab,
      ).toEqual([]);
    }
    // The score's sheet and the day's entry (its question, „Невярно:“) in the sheet's ink.
    expect(await greyOnSheets(page)).toEqual([]);
  });
}

// A duel's result, as one won against a friend has it (the server's answer for it made here): the two face to face,
// the duel question by question, and the record.
for (const scheme of ["light", "dark"] as const) {
  test(`a duel's result is accessible (${scheme})`, async ({ page }) => {
    const mark = (right: number) => ({ right: right > 0 });
    const side = (name: string, tag: string, rights: number[]) => ({
      name,
      tag,
      rights: rights.filter((p) => p > 0).length,
      done: true,
      look: { avatar: "hare" },
      marks: rights.map((p) => mark(p)),
    });
    const duel = {
      id: 1,
      state: "won",
      you: side("Заек 817", "", [1, 1, 0, 1, 1, 0, 1, 1, 1, 1]),
      opponent: side("Мария", "maria", [1, 0, 1, 1, 1, 0, 1, 0, 1, 0]),
      runId: 1,
      first: true,
      createdAt: Date.now(),
      endedAt: Date.now(),
      record: { won: 3, lost: 2, drawn: 1 },
      friend: true,
      them: 2,
    };
    await page.emulateMedia({ colorScheme: scheme });
    await page.route("**/api/duels/1", (r) => r.fulfill({ json: { duel } }));
    await page.goto("/duel/1");
    await expect(page.getByRole("heading", { name: "Победа" })).toBeVisible();
    // Whatever moves, at its end. Waited for, not cut short by a key: a key would be the page's first touch, which
    // starts the audio and sends for the game's feel (lib/sound.ts) just as axe reads the page, and Firefox on CI's
    // Linux crashed under that now and then. (A page's first result has no moment anyway: the feel isn't in yet.)
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    await expect(page.locator(".duel-record")).toBeVisible();
    await expect(page.locator(".duel-pip.partial, .duel-pip.right")).not.toHaveCount(0);
    await expect(page.locator(".duel-pip.fast, .duel-key")).toHaveCount(0); // speed only breaks a tie: no rings
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

    // On the day it was played, its questions are rows under it, in place of the marks: one right for both, one that
    // parted them, the first opened.
    const asked = (n: number, right: boolean) => ({
      n,
      category: "history",
      view: { type: "truefalse", text: "София е столица на България от 1879 г." },
      reveal: { id: `q${n}`, truth: true, fact: "София става столица на 3 април 1879 г." },
      given: { truth: right },
      right,
    });
    await page.route("**/api/duels/1", (r) => r.fulfill({ json: { duel: { ...duel, review: true } } }));
    await page.route("**/api/runs/1/review", (r) =>
      r.fulfill({ json: { questions: [asked(0, true), asked(1, false)] } }),
    );
    await page.reload();
    await expect(page.locator(".duel-q")).toHaveCount(2);
    await expect(page.locator(".duel-pip")).toHaveCount(0);
    await page.locator(".duel-q-more").first().click();
    await expect(page.locator(".duel-q-body")).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    const rows = await new AxeBuilder({ page }).analyze();
    expect(rows.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

// Another player's profile: someone made for it, seen by a stranger.
for (const scheme of ["light", "dark"] as const) {
  test(`a player's profile is accessible (${scheme})`, async ({ page, playwright }) => {
    const other = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
    const { user } = await (await other.post("/api/guest", { data: {} })).json();
    await other.dispose();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/players/${user.tag}`);
    // A stranger with no game yet: asked to play one first (or sign in) to add friends.
    await expect(page.getByRole("link", { name: "Към днешния брой" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

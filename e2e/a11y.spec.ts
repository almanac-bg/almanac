import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { answer, moveOn, openGame, playRun, startDay } from "./play.ts";

// The main screens, light and dark: nothing axe finds (contrast, names, roles, structure).
for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    for (const path of [
      "/",
      "/duel",
      "/ranks",
      "/rewards",
      "/wardrobe",
      "/me",
      "/friends",
      "/settings",
      "/almanac",
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
      await expect(region).toHaveText(/^(Точно!|Вярно!|Близо\.|Не е това\.|Времето изтече\.)( \+[\d ]+ точк[аи]\.)?/);
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
    await expect(page.getByRole("link", { name: "Още десет" })).toBeVisible();
    // A first day's news: what points are, in a line (play/unfold.go).
    await expect(page.locator(".news-open")).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

// A duel's result, as one won live against a person has it (the server's answer for it made here): the two face to face, the
// duel question by question with the quicker answers ringed and the deciding one marked, the rating and the record.
for (const scheme of ["light", "dark"] as const) {
  test(`a duel's result is accessible (${scheme})`, async ({ page }) => {
    const mark = (points: number, ms: number) => ({ points, right: points > 0, ms });
    const side = (name: string, tag: string, points: number[], slower = 0) => ({
      name,
      tag,
      points: points.reduce((a, p) => a + p, 0),
      rights: points.filter((p) => p > 0).length,
      ms: 40_000,
      done: true,
      look: { avatar: "hare-gold/double/", title: "Познавач", titleTier: "rare", level: 7 },
      marks: points.map((p, i) => mark(p, 3000 + 300 * i + slower)),
    });
    const duel = {
      id: 1,
      state: "won",
      you: side("Заек 817", "", [1300, 1100, 0, 1500, 1200, 0, 1400, 1250, 1100, 1000]),
      opponent: { ...side("Мария", "maria", [1200, 0, 1500, 1600, 1300, 0, 1500, 0, 1000, 0], 500), ms: 50_000 },
      delta: 18,
      runId: 1,
      createdAt: Date.now(),
      endedAt: Date.now(),
      decided: 8,
      rating: {
        before: 1062,
        after: 1080,
        division: { id: "silver", name: "Сребро", from: 1050 },
        next: { id: "gold", name: "Злато", from: 1150 },
      },
      record: { won: 3, lost: 2, drawn: 1 },
    };
    await page.emulateMedia({ colorScheme: scheme });
    await page.route("**/api/duels/1", (r) => r.fulfill({ json: { duel } }));
    await page.goto("/duel/1");
    await expect(page.getByRole("heading", { name: "Победа" })).toBeVisible();
    await page.keyboard.press("Shift"); // the moment, to its end
    await expect(page.locator(".duel-record")).toBeVisible();
    await expect(page.locator(".duel-pip.fast")).not.toHaveCount(0);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
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
    await expect(page.getByRole("link", { name: "Към играта" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

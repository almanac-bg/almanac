import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { playRun, startDay } from "./play.ts";

// The main screens, light and dark: nothing axe finds (contrast, names, roles, structure).
for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    for (const path of [
      "/",
      "/duel",
      "/royal",
      "/room",
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
        // A topic: its count first, then a question.
        if (path === "/play/geography") {
          await page.getByRole("button", { name: "Започни сега" }).click();
          await expect(page.locator(".split, .options, .keypad, .tf-options, .match").first()).toBeVisible();
          await check();
        }
      });
    }
  });
}

// The day played: its result, the news it brought and the way to share it.
for (const scheme of ["light", "dark"] as const) {
  test(`the day's result is accessible (${scheme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await startDay(page);
    await playRun(page);
    await expect(page.getByRole("button", { name: "Сподели" })).toBeVisible();
    // A first day's news: what points are, in a line (play/unfold.go).
    await expect(page.locator(".news-open")).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

// A duel's result, as one won against a friend has it (the server's answer for it made here): the two face to face, the
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
      kind: "friend",
      state: "won",
      friend: 2,
      you: side("Заек 817", "", [1300, 1100, 0, 1500, 1200, 0, 1400, 1250, 1100, 1000]),
      opponent: { ...side("Мария", "maria", [1200, 0, 1500, 1600, 1300, 0, 1500, 0, 1000, 0], 500), ms: 50_000 },
      delta: 18,
      runId: 1,
      createdAt: Date.now(),
      expiresAt: Date.now(),
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
    await expect(page.getByRole("button", { name: "Добави приятел" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

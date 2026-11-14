import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { playRun } from "./play.ts";

// The main screens, light and dark: nothing axe finds (contrast, names, roles, structure).
for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    for (const path of [
      "/",
      "/duel",
      "/arena",
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
    await page.getByRole("button", { name: "Започни" }).click();
    await playRun(page);
    await expect(page.getByRole("button", { name: "Сподели" })).toBeVisible();
    await expect(page.locator(".news-xp, .level-card").first()).toBeVisible();
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

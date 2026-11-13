import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The main screens, light and dark: nothing axe finds (contrast, names, roles, structure).
for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    for (const path of [
      "/",
      "/play",
      "/duel",
      "/royal",
      "/room",
      "/ranks",
      "/rewards",
      "/me",
      "/friends",
      "/settings",
      "/almanac",
      "/privacy",
      "/play/geography",
    ]) {
      test(`${path} is accessible`, async ({ page }) => {
        await page.goto(path);
        if (path === "/play/geography")
          await expect(page.locator(".options, .keypad, .tf-options, .match").first()).toBeVisible();
        else await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      });
    }
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

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
        // The game's settings, open.
        if (path === "/play") await page.getByRole("button", { name: "Промени" }).click();
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      });
    }
  });
}

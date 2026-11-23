import { expect, type Page, test } from "@playwright/test";
import { playRun, startDay } from "./play.ts";

/** Where each of the three places' links sits and how wide it is, in the bar on a big screen or at the foot on a
 * phone. */
async function placeBoxes(page: Page, bar: string): Promise<string[]> {
  return page.locator(`${bar} a`).evaluateAll((links) =>
    links.map((a) => {
      const r = a.getBoundingClientRect();
      return `${Math.round(r.left)}:${Math.round(r.width)}`;
    }),
  );
}

// On a slow line a place come back to is drawn at once from what it showed last, and asked again behind it: never a
// blank page while it comes, nor the page left held on the screen.
test("a place come back to is drawn at once from what it showed last, on a slow line", async ({ page }) => {
  await page.goto("/");
  await startDay(page);
  await playRun(page);
  await expect(page.locator(".summary")).toBeVisible();
  const tab = (href: string) => page.locator(`nav.places-foot a[href='${href}']`).click();
  for (const [href, drawn] of [
    ["/almanac", ".chapters"],
    ["/", ".summary"],
  ] as const) {
    await tab(href);
    await expect(page.locator(drawn).first()).toBeVisible();
  }
  // From here every answer of the server's takes two seconds.
  await page.route("**/api/**", async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue().catch(() => {});
  });
  for (const [href, drawn] of [
    ["/almanac", ".chapters"],
    ["/", ".summary"],
  ] as const) {
    await tab(href);
    await expect(page.locator(drawn).first()).toBeVisible({ timeout: 600 });
  }
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// Moving between the places never moves the places: the one here is marked by its well and its ink, never by a
// heavier weight, which made its name wider and nudged its neighbours (seen on a laptop, 21 Nov).
for (const [name, size, bar] of [
  ["a laptop", { width: 1366, height: 900 }, ".places"],
  ["a phone", { width: 390, height: 664 }, ".places-foot"],
] as const) {
  test(`the places stay put as the player moves between them, on ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    const seen: string[][] = [];
    for (const path of ["/almanac", "/friends", "/almanac"]) {
      await page.goto(path);
      await expect(page.locator(`${bar} a[aria-current="page"]`)).toHaveCount(1);
      seen.push(await placeBoxes(page, bar));
    }
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
  });
}

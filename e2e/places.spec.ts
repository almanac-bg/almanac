import { expect, type Page, test } from "@playwright/test";

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

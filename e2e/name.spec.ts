// A name of the player's own, asked the first time others will see them (screens/name.ts): saved before the game goes
// on, however slow the line, and one refused said in the sheet; one ask for a double tap.

import { befriend } from "./play.ts";
import { type Browser, expect, type Page, test } from "./test.ts";

/** The name's saving held back `ms`, as on a slow line, then sent on to the server. */
async function slowName(page: Page, ms: number): Promise<void> {
  await page.route("**/api/me", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await new Promise((r) => setTimeout(r, ms));
    await route.fallback();
  });
}

/** Two friends, as Приятели makes them (play.ts), and the first one's duel with the other a tap away there: „Дуел“ on
 * the friend's row. */
async function friends(browser: Browser): Promise<Page> {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await befriend(a, b);
  await a.goto("/friends");
  return a;
}

test("before a first duel sent to a friend: a slow save is waited for, a refused name said in the sheet", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const page = await friends(browser);
  await slowName(page, 1500);
  await page.getByRole("button", { name: /^Дуел/ }).click();
  const sheet = page.getByRole("dialog", { name: "Как да те виждат останалите?" });
  const field = sheet.getByRole("textbox", { name: "Име" });
  // Refused (a web address), however slow: said in the sheet, and the duel waits.
  await field.fill("ana.bg");
  await sheet.getByRole("button", { name: "Готово" }).click();
  await expect(sheet.getByRole("alert")).toHaveText(/След точка в името трябва да има интервал/, { timeout: 5_000 });
  await expect(page).toHaveURL(/\/friends$/);
  // A good one, as slow: the duel starts once it's saved, the name the player's.
  await field.fill("Ана Слаба");
  await sheet.getByRole("button", { name: "Готово" }).click();
  await expect(sheet).toBeHidden({ timeout: 5_000 });
  await expect(page).toHaveURL(/\/duel\/\d+$/);
  const me = await page.evaluate(() => fetch("/api/me").then((r) => r.json()));
  expect(me.user?.name ?? me.name).toBe("Ана Слаба");
});

// The second tap lands where the first did. On a tall phone (the Pixel's) that's beside the sheet the first one opened:
// „Не сега“, and on into the duel. On a shorter one (the iPhone's) the sheet rises over the button, and the second tap
// is on the sheet, which waits for its answer. Either way: one sheet, and one duel.
test("a double tap on a first duel is one duel", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await friends(browser);
  let duels = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/duels") duels++;
  });
  await page.getByRole("button", { name: /^Дуел/ }).dblclick();
  const sheet = page.getByRole("dialog");
  expect(await sheet.count()).toBeLessThanOrEqual(1);
  if (await sheet.isVisible()) await sheet.getByRole("button", { name: "Не сега" }).click();
  await expect(page).toHaveURL(/\/duel\/\d+$/);
  await expect(sheet).toHaveCount(0);
  expect(duels).toBe(1);
});

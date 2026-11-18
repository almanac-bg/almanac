// A name of the player's own, asked the first time others will see them (screens/name.ts): saved before the game goes
// on, however slow the line, and one refused said in the sheet; one ask for a double tap; before a share, a name
// refused after the share went is said then. And the wardrobe tells a title not chosen yet from „Без титла“.
import { expect, type Page, test } from "@playwright/test";
import { openGame, playRun } from "./play.ts";

/** The name's saving held back `ms`, as on a slow line, then sent on to the server. */
async function slowName(page: Page, ms: number): Promise<void> {
  await page.route("**/api/me", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await new Promise((r) => setTimeout(r, ms));
    await route.fallback();
  });
}

test("before a first live duel: a slow save is waited for, a refused name said in the sheet", async ({ page }) => {
  await slowName(page, 1500);
  await page.goto("/duel");
  await page.getByRole("button", { name: "Намери съперник" }).click();
  const sheet = page.getByRole("dialog", { name: "Как да те виждат останалите?" });
  const field = sheet.getByRole("textbox", { name: "Име" });
  // Refused (a web address), past the second a share would wait: said in the sheet, and the search waits.
  await field.fill("ana.bg");
  await sheet.getByRole("button", { name: "Готово" }).click();
  await expect(sheet.getByRole("alert")).toHaveText(/След точка в името трябва да има интервал/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Търсим съперник" })).toHaveCount(0);
  // A good one, as slow: the search starts once it's saved, the name the player's.
  await field.fill("Ана Слаба");
  await sheet.getByRole("button", { name: "Готово" }).click();
  await expect(sheet).toBeHidden({ timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Търсим съперник" })).toBeVisible();
  const me = await page.evaluate(() => fetch("/api/me").then((r) => r.json()));
  expect(me.user?.name ?? me.name).toBe("Ана Слаба");

  // Гардероб: no title chosen yet, so „Без титла“ (a choice of its own) isn't the one pressed.
  await page.goto("/wardrobe");
  await page.getByRole("tab", { name: "Титла" }).click();
  const none = page.getByRole("button", { name: "Без титла" });
  await expect(none).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".worn-text")).toContainText("Още без титла");
  await none.click();
  await expect(none).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".worn-text")).not.toContainText("Още");
});

test("a challenge: a double tap is one guest and one ask; a name refused after a share is said then", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const a = await (await browser.newContext()).newPage();
  await a.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (d: ShareData) => {
        (window as unknown as { shared: ShareData }).shared = d;
      },
    });
  });
  await openGame(a, "/play/history");
  await playRun(a);
  // Before the share, a name: refused by the server only after the share has gone (it waits a second at most), so
  // said then, in the sheet again, to change.
  await slowName(a, 1500);
  await a.getByRole("button", { name: "Предизвикай" }).click();
  const ask = a.getByRole("dialog", { name: "Как да те познаят приятелите?" });
  await ask.getByRole("textbox", { name: "Име" }).fill("ana.bg");
  await ask.getByRole("button", { name: "Сподели" }).click();
  await expect
    .poll(() => a.evaluate(() => (window as unknown as { shared?: ShareData }).shared?.url ?? ""))
    .toMatch(/\/c\/[a-z0-9]{8}$/);
  const late = a.getByRole("dialog", { name: "Името не е запазено" });
  await expect(late).toBeVisible({ timeout: 5_000 });
  await expect(late.getByRole("alert")).toHaveText(/След точка в името трябва да има интервал/);
  await expect(late.getByRole("textbox", { name: "Име" })).toHaveValue("ana.bg");
  await late.getByRole("textbox", { name: "Име" }).fill("Ана");
  await late.getByRole("button", { name: "Запази" }).click();
  await expect(late).toBeHidden({ timeout: 5_000 });
  const path = new URL(await a.evaluate(() => (window as unknown as { shared: ShareData }).shared.url ?? "")).pathname;

  // Bo, new, taps „Започни“ twice: one guest made, one sheet.
  const b = await (await browser.newContext()).newPage();
  let guests = 0;
  b.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/guest") guests++;
  });
  await b.goto(path);
  await b.getByRole("button", { name: "Започни", exact: true }).dblclick();
  const sheet = b.getByRole("dialog", { name: "Как да те виждат останалите?" });
  await expect(sheet).toBeVisible();
  await expect(b.getByRole("dialog")).toHaveCount(1);
  await sheet.getByRole("button", { name: "Не сега" }).click();
  await expect(b.getByRole("dialog")).toHaveCount(0);
  await expect(b.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  expect(guests).toBe(1);
  await a.context().close();
  await b.context().close();
});

// A name of the player's own, asked the first time others will see them (screens/name.ts): saved before the game goes
// on, however slow the line, and one refused said in the sheet; one ask for a double tap. And the wardrobe tells a
// title not chosen yet from „Без титла“.
import { expect, type Page, test } from "@playwright/test";

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
  // Refused (a web address), however slow: said in the sheet, and the search waits.
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

test("a double tap on a first live duel is one guest and one ask", async ({ page }) => {
  let guests = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/guest") guests++;
  });
  await page.goto("/duel");
  await page.getByRole("button", { name: "Намери съперник" }).dblclick();
  const sheet = page.getByRole("dialog", { name: "Как да те виждат останалите?" });
  await expect(sheet).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await sheet.getByRole("button", { name: "Не сега" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Търсим съперник" })).toBeVisible();
  expect(guests).toBe(1);
});

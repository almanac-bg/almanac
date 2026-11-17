// Keeping a guest's game: asked in the day's „Утре“ card from the second day, at once in an app's own browser (with
// the way out to the phone's browser, the game with it); and the way in for a player with a profile elsewhere.
import { expect, test } from "@playwright/test";
import { daysPlayed, playRun, startDay } from "./play.ts";

test("from the second day a guest is asked, in one line under the result, to keep the game", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await daysPlayed(page, 1);
  await page.reload();
  await startDay(page);
  await playRun(page);
  const tomorrow = page.locator(".tomorrow");
  await expect(tomorrow).toContainText("Серията ти от 2 дни е само на това устройство. Запази я с имейл.");
  await tomorrow.getByRole("button", { name: "Запази я с имейл" }).click();
  await expect(tomorrow.getByLabel("Имейл")).toBeVisible();
});

test("a first day asks nothing", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await startDay(page);
  await playRun(page);
  await expect(page.locator(".tomorrow")).toBeVisible();
  await expect(page.locator(".tomorrow")).not.toContainText("само на това устройство");
});

test.describe("in Messenger's own browser", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0.0.0;]",
  });

  test("the first day asks at once, and the game goes to the phone's browser with its link", async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await startDay(page);
    await playRun(page);
    const tomorrow = page.locator(".tomorrow");
    await expect(tomorrow).toContainText("Играта ти е само тук, в Messenger.");
    await expect(tomorrow.getByRole("button", { name: "Отвори в браузъра" })).toBeVisible();
    const rights = await page.locator(".summary .score-n").textContent();
    // The link the button opens, as the phone's browser gets it: the game is there, and the link works once.
    const url = await page.evaluate(async () => {
      const r = await fetch("/api/auth/handoff", { method: "POST", body: "{}" });
      return ((await r.json()) as { url: string }).url;
    });
    const phone = await browser.newPage();
    await phone.goto(url);
    await expect(phone.getByRole("status").filter({ hasText: "Готово: играта ти е тук." })).toBeVisible();
    await expect(phone).toHaveURL(/\/$/);
    await expect(phone.locator(".summary .score-n")).toHaveText(rights ?? "");
    const late = await browser.newPage();
    await late.goto(url);
    await expect(late.getByRole("status")).toContainText("Тази връзка вече не работи");
    await phone.close();
    await late.close();
  });
});

test("a guest's Профил has the way in for a profile from elsewhere", async ({ page }) => {
  await page.goto("/");
  await daysPlayed(page, 1);
  await page.goto("/me");
  await page.getByRole("button", { name: "Играеш и на друго устройство? Влез с имейла си" }).click();
  await expect(page.getByRole("heading", { name: "Влез в профила си" })).toBeVisible();
  await expect(page.getByLabel("Имейл")).toBeVisible();
});

test("come from the streak's mail, signed out: the way in comes first", async ({ page }) => {
  await page.goto("/?from=mail");
  await expect(page.getByRole("heading", { name: "Влез в профила си" })).toBeVisible();
  await expect(page.getByLabel("Имейл")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  // Without the mail, the quiet line only.
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Имаш профил? Влез" })).toBeVisible();
});

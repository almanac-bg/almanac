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
    // Nothing is taken until the player taps for it: a link that opens by itself, or someone else's, brings nothing.
    await expect(phone.getByText("ще продължи тук. Там вече няма да я има.")).toBeVisible();
    await phone.getByRole("button", { name: "Продължи тук" }).click();
    await expect(phone.getByRole("status").filter({ hasText: "Готово: играта ти е тук." })).toBeVisible();
    await expect(phone).toHaveURL(/\/$/);
    await expect(phone.locator(".summary .score-n")).toHaveText(rights ?? "");
    // The game moved: Messenger's browser is signed out of it.
    const left = await page.evaluate(async () => ((await (await fetch("/api/me")).json()) as { user: unknown }).user);
    expect(left).toBeNull();
    const late = await browser.newPage();
    await late.goto(url);
    await late.getByRole("button", { name: "Продължи тук" }).click();
    await expect(late.getByRole("status")).toContainText("Тази връзка вече не работи");
    await phone.close();
    await late.close();
  });
});

test.describe("in Messenger's own browser on an older iPhone, with no clipboard to write to", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 13_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/300.0.0.0]",
  });

  test("„Копирай връзката“ shows the link to copy by hand", async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      Object.defineProperty(window, "ClipboardItem", { configurable: true, value: undefined });
    });
    await page.goto("/");
    await startDay(page);
    await playRun(page);
    const tomorrow = page.locator(".tomorrow");
    await expect(tomorrow).toContainText("Играта ти е само тук, в Messenger.");
    await tomorrow.getByRole("button", { name: "Копирай връзката" }).click();
    await expect(tomorrow.locator(".keep-said")).toContainText("/hand/");
  });
});

test("a first invite asks for a name the friends would know, once", async ({ page }) => {
  // What the page shares, counted instead of the phone's sheet.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        const w = window as unknown as { shares?: number };
        w.shares = (w.shares ?? 0) + 1;
      },
    });
  });
  const shares = () => page.evaluate(() => (window as unknown as { shares?: number }).shares ?? 0);
  await page.goto("/friends");
  await page.locator(".friends").getByRole("button", { name: "Покани приятел" }).click();
  const invite = page.getByRole("button", { name: "Покани с връзка" });
  await invite.click();
  const sheet = page.getByRole("dialog", { name: "Как да те познаят приятелите?" });
  await expect(sheet.getByLabel("Име")).toHaveValue(/ \d{3}$/);
  // Esc (or a tap beside the sheet) is no answer: nothing shared, and asked again next time.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  expect(await shares()).toBe(0);
  await invite.click();
  // „Не сега“: the invite goes as it is, with the drawn name, and this device isn't asked again.
  await sheet.getByRole("button", { name: "Не сега" }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(shares).toBe(1);
  await invite.click();
  await expect.poll(shares).toBe(2);
  await expect(sheet).toHaveCount(0);

  // Asked again (as on another device): a name chosen goes with the invite.
  await page.evaluate(() => localStorage.removeItem("almanac.nameAsked"));
  await invite.click();
  await sheet.getByLabel("Име").fill("Х");
  await sheet.getByRole("button", { name: "Сподели" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Името е от 2 до 30 букви, цифри или интервали.");
  await sheet.getByLabel("Име").fill("Светулка");
  await sheet.getByRole("button", { name: "Сподели" }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(shares).toBe(3);
  await expect
    .poll(() => page.evaluate(async () => (await (await fetch("/api/me")).json()).user.name))
    .toBe("Светулка");
  // Named: the next invite goes at once.
  await invite.click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(shares).toBe(4);
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

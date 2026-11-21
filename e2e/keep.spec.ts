// Keeping a guest's game: asked in the day's „Утре“ card from the second day, at once in an app's own browser (with
// the way out to the phone's browser, the game with it); where no notification can come (as in these tests: the
// test server has no keys for them), by the reminder by mail, which asks for the email from the first day; on
// Профил from the first game; and the way in for a player with a profile elsewhere.
import { expect, test } from "@playwright/test";
import { daysPlayed, mailedCode, playRun, startDay } from "./play.ts";

test("from the second day, where no notification comes, the reminder by mail asks for the email and keeps the game", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const email = `remind-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/");
  await daysPlayed(page, 1);
  await page.reload();
  await startDay(page);
  await playRun(page);
  const tomorrow = page.locator(".tomorrow");
  await expect(tomorrow).toContainText("Серията ти от 2 дни е само на това устройство.");
  await expect(tomorrow).toContainText("Да ти пишем, ако въпросите още те чакат?");
  // One ask for the email, not two.
  await expect(tomorrow.getByRole("button", { name: "Запази я с имейл" })).toHaveCount(0);
  await tomorrow.getByLabel("Имейл").fill(email);
  await tomorrow.getByRole("button", { name: "Напомняй ми по имейл" }).click();
  await expect.poll(() => mailedCode(email)).not.toBe("");
  await tomorrow.getByLabel("Код").fill(mailedCode(email));
  await tomorrow.getByRole("button", { name: "Потвърди" }).click();
  await expect(tomorrow.getByRole("status")).toHaveText(
    `Готово. Играта ти е запазена с имейла ${email}. Влизай с него от всяко устройство. Ще ти напомняме по имейл, ако въпросите още те чакат.`,
  );
  await expect(tomorrow).not.toContainText("само на това устройство");
  // Asked and on: not asked again.
  await page.reload();
  await expect(page.locator(".tomorrow")).toBeVisible();
  await expect(page.locator(".summary")).not.toContainText("Да ти пишем");
  // Настройки has it on, the player's to switch off.
  await page.goto("/settings");
  await expect(page.getByRole("switch", { name: "Напомняне по имейл" })).toHaveAttribute("aria-checked", "true");
});

test("a player with a profile is asked in „Утре“ to be reminded while it's off, never as a second action", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const email = `profile-remind-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/");
  await daysPlayed(page, 1);
  // The game kept with an email in Настройки, no reminder asked for.
  await page.goto("/settings");
  await page.getByLabel("Имейл").fill(email);
  await page.getByRole("button", { name: "Прати ми код" }).click();
  await expect.poll(() => mailedCode(email)).not.toBe("");
  await page.getByLabel("Код").fill(mailedCode(email));
  await page.getByRole("button", { name: "Потвърди" }).click();
  await expect(page.getByText(`Играта ти е запазена с имейла ${email}`)).toBeVisible();
  await page.goto("/");
  await startDay(page);
  await playRun(page);
  const tomorrow = page.locator(".tomorrow");
  await expect(tomorrow).toContainText(`Да ти пишем на ${email}, ако въпросите още те чакат?`);
  // The result's one action is „Сподели“; the ask is a plain button under „Утре“.
  await expect(page.locator(".result-first")).toHaveCount(0);
  await expect(tomorrow.getByRole("button", { name: "Напомняй ми по имейл" })).not.toHaveClass(/primary/);
  await tomorrow.getByRole("button", { name: "Не сега" }).click();
  await expect(page.locator(".summary")).not.toContainText("Да ти пишем");
  // Once a day: not again today.
  await page.reload();
  await expect(page.locator(".tomorrow")).toBeVisible();
  await expect(page.locator(".summary")).not.toContainText("Да ти пишем");
});

test("a first day asks for the reminder only, not yet to keep the game; „Не сега“ holds for the day", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await startDay(page);
  await playRun(page);
  // The first result's action, right under the score.
  const ask = page.locator(".result-share.result-first");
  await expect(ask).toContainText("Да ти пишем, ако въпросите още те чакат?");
  await expect(ask).not.toContainText("само на това устройство");
  // Sharing stays, a quiet link beside the tiles.
  await expect(page.locator(".score-leaf .result-share-link")).toBeVisible();
  await ask.getByRole("button", { name: "Не сега" }).click();
  await expect(page.locator(".summary")).not.toContainText("Да ти пишем");
  await page.reload();
  await expect(page.locator(".tomorrow")).toBeVisible();
  await expect(page.locator(".summary")).not.toContainText("Да ти пишем");
});

test("„Не сега“ to the reminder by mail is one to the email: the line to keep the game waits for another day", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await daysPlayed(page, 1);
  await page.reload();
  await startDay(page);
  await playRun(page);
  const tomorrow = page.locator(".tomorrow");
  await expect(tomorrow).toContainText("Да ти пишем, ако въпросите още те чакат?");
  await tomorrow.getByRole("button", { name: "Не сега" }).click();
  await expect(tomorrow).not.toContainText("Да ти пишем");
  await expect(tomorrow.getByRole("button", { name: "Запази я с имейл" })).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".tomorrow")).toBeVisible();
  await expect(page.locator(".tomorrow").getByRole("button", { name: "Запази я с имейл" })).toHaveCount(0);
});

test("the reminder by mail turned on from Настройки says the game is kept, and its switch is on", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const email = `settings-remind-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/");
  await page.evaluate(() => fetch("/api/guest", { method: "POST", body: "{}" }));
  // The reminder turned on a moment after the email is in: what Настройки asks of the mail meanwhile is older.
  await page.route("**/api/mail/prefs", async (r) => {
    if (r.request().method() === "PATCH") await new Promise((done) => setTimeout(done, 800));
    await r.continue();
  });
  await page.goto("/settings");
  const mail = page.locator("section:has(> h2:text-is('Известия'))");
  await mail.getByRole("button", { name: "Напомняй ми по имейл" }).click();
  await mail.getByLabel("Имейл").fill(email);
  await mail.getByRole("button", { name: "Напомняй ми по имейл" }).click();
  await expect.poll(() => mailedCode(email)).not.toBe("");
  await mail.getByLabel("Код").fill(mailedCode(email));
  await mail.getByRole("button", { name: "Потвърди" }).click();
  await expect(mail.getByRole("status")).toHaveText(
    `Готово. Играта ти е запазена с имейла ${email}. Влизай с него от всяко устройство. Ще ти напомняме по имейл, ако въпросите още те чакат.`,
  );
  await expect(mail.getByRole("switch", { name: "Напомняне по имейл" })).toHaveAttribute("aria-checked", "true");
});

const messengerOnAndroid =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0.0.0;]";
const safariOnIPhone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 13_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.2 Mobile/15E148 Safari/604.1";
const chromeOnAndroid =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

test.describe("in Messenger's own browser", () => {
  test.use({ userAgent: messengerOnAndroid });

  test("the cover has a line for a game kept in the phone's browser", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".issue-exit")).toHaveText("Имаш игра в браузъра? Отвори там");
  });

  test("the result's action takes the game to the phone's browser; both keep it", async ({ page, browser }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await startDay(page);
    await playRun(page);
    const action = page.locator(".result-share");
    await expect(action).toContainText("Играта ти е само тук, в Messenger.");
    await expect(action.getByRole("button", { name: "Отвори в браузъра" })).toBeVisible();
    // No email or code is asked for in Meta's browsers, here nor on Профил.
    await expect(action.getByRole("button", { name: "Или я запази с имейл" })).toHaveCount(0);
    await expect(action.locator(".exit-number")).toHaveText(/^Ако браузърът поиска число, въведи \d\d\.$/);
    // The link's token is in the address, its fragment, while the way out is offered: the app's „Open in browser“
    // takes it along. Nothing else in the page says it.
    await expect(page).toHaveURL(/\/#hand=[A-Za-z0-9_-]{43}$/);
    const url = page.url();
    const number = ((await action.locator(".exit-number").textContent()) ?? "").replace(/\D/g, "");
    const rights = await page.locator(".summary .score-n").textContent();
    const name = await page.evaluate(
      async () => ((await (await fetch("/api/me")).json()) as { user: { name: string } }).user.name,
    );

    // The phone's browser, on the same phone: one tap that names the game, then the day's result, whose action is the
    // ask.
    const phone = await browser.newContext({ userAgent: chromeOnAndroid });
    const there = await phone.newPage();
    await there.goto(url);
    await expect(there.locator(".hand-number")).toContainText(`Връзката носи играта на ${name}.`);
    await there.getByRole("button", { name: "Продължи тук" }).click();
    await expect(there.getByRole("status").filter({ hasText: "Готово: играта ти е тук." })).toBeVisible();
    await expect(there).toHaveURL(/\/$/);
    await expect(there.locator(".score-n")).toHaveText(rights ?? "");
    await expect(there.locator(".result-share")).toContainText("Да ти пишем, ако въпросите още те чакат?");
    // Messenger's browser keeps the game too: the same player.
    const still = await page.evaluate(
      async () => ((await (await fetch("/api/me")).json()) as { user: { name: string } | null }).user?.name,
    );
    expect(still).toBe(name);
    // Used once.
    const late = await (await browser.newContext({ userAgent: chromeOnAndroid })).newPage();
    await late.goto(url);
    await expect(late.locator(".notice")).toContainText("Тази връзка вече не работи");
    await late.context().close();

    // Another link, opened somewhere else (a computer): asked for the number first.
    await page.reload();
    await expect(page).toHaveURL(/\/#hand=[A-Za-z0-9_-]{43}$/);
    const other = page.url();
    const now = ((await page.locator(".exit-number").textContent()) ?? "").replace(/\D/g, "");
    const laptop = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    });
    const desk = await laptop.newPage();
    await desk.goto(other);
    await expect(desk.locator(".hand-number")).toContainText(`Играта на ${name} идва от друго място.`);
    await desk.getByLabel("Число").fill(now === "10" ? "11" : "10");
    await desk.getByRole("button", { name: "Продължи тук" }).click();
    await expect(desk.getByRole("alert")).toContainText("Грешно число.");
    await desk.getByLabel("Число").fill(now);
    await desk.getByRole("button", { name: "Продължи тук" }).click();
    await expect(desk.getByRole("status").filter({ hasText: "Готово: играта ти е тук." })).toBeVisible();
    await expect(desk.locator(".score-n")).toHaveText(rights ?? "");
    expect(number).toMatch(/^\d\d$/);
    await phone.close();
    await laptop.close();
  });

  test("Профил asks for no email here: the way is the phone's browser", async ({ page }) => {
    await page.goto("/");
    await daysPlayed(page, 1);
    await page.goto("/me");
    await page.getByRole("button", { name: "Запази я с имейл" }).click();
    await expect(page.getByText("Тук не питаме за имейл")).toBeVisible();
    await expect(page.getByLabel("Имейл")).toHaveCount(0);
  });
});

test.describe("in Messenger's own browser on an older iPhone, with no clipboard to write to", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 13_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/300.0.0.0]",
  });

  test("the action names the app's menu, and „Копирай връзката“ shows the link to copy by hand", async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      Object.defineProperty(window, "ClipboardItem", { configurable: true, value: undefined });
    });
    await page.goto("/");
    await startDay(page);
    await playRun(page);
    const action = page.locator(".result-share");
    await expect(action.locator(".exit-menu")).toHaveText("··· → Отвори в Safari");
    await expect(page).toHaveURL(/\/#hand=[A-Za-z0-9_-]{43}$/);
    await action.getByRole("button", { name: "Копирай връзката" }).click();
    await expect(action.locator(".keep-said")).toContainText("/#hand=");
    // A link copied asks every browser for the number, the same phone's too.
    const url = page.url();
    const safari = await browser.newContext({ userAgent: safariOnIPhone });
    const there = await safari.newPage();
    await there.goto(url);
    await expect(there.getByLabel("Число")).toBeVisible();
    await safari.close();
  });
});

test("a guest's Профил asks to keep the game and says it's kept; the way in for a profile from elsewhere is apart", async ({
  page,
}, info) => {
  const email = `keep-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/");
  await daysPlayed(page, 1);
  await page.goto("/me");
  await page.getByRole("button", { name: "Имаш профил? Влез" }).click();
  await expect(page.getByRole("heading", { name: "Влез в профила си" })).toBeVisible();
  await page.goto("/me");
  await expect(page.getByText("Играта ти е само на това устройство.")).toBeVisible();
  await page.getByRole("button", { name: "Запази я с имейл" }).click();
  await expect(page.getByRole("heading", { name: "Запази играта си" })).toBeVisible();
  await page.getByLabel("Имейл").fill(email);
  await page.getByRole("button", { name: "Прати ми код" }).click();
  await expect.poll(() => mailedCode(email)).not.toBe("");
  await page.getByLabel("Код").fill(mailedCode(email));
  await page.getByRole("button", { name: "Потвърди" }).click();
  await expect(page.getByRole("status")).toHaveText(
    `Готово. Играта ти е запазена с имейла ${email}. Влизай с него от всяко устройство.`,
  );
  await expect(page.getByRole("button", { name: "Запази я с имейл" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Имаш профил? Влез" })).toHaveCount(0);
});

test("Профил names Настройки in words, and a name still drawn leads to the field to change it", async ({ page }) => {
  await page.goto("/");
  await daysPlayed(page, 1);
  await page.goto("/me");
  await expect(page.getByText("Това име е избрано наслуки.")).toBeVisible();
  await expect(page.locator(".me-settings strong")).toHaveText("Настройки");
  await expect(page.locator(".me-settings")).toHaveAttribute("href", "/settings");
  await page.getByRole("link", { name: "Смени го" }).click();
  await expect(page.getByLabel("Име", { exact: true })).toBeFocused();
  // Известия are there wherever notifications can't come, and say why.
  await expect(page.locator("section.stack", { has: page.getByRole("heading", { name: "Известия" }) })).toContainText(
    /Този браузър не поддържа известия\.|към началния екран/,
  );
});

test("come from the streak's mail, signed out: the way in comes first", async ({ page }) => {
  await page.goto("/?from=mail");
  await expect(page.getByRole("heading", { name: "Влез в профила си" })).toBeVisible();
  await expect(page.getByLabel("Имейл")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  // Without the mail, the way in is the cover's „Вход“ only.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Влез в профила си" })).toHaveCount(0);
  await expect(page.locator(".bar-in")).toHaveText("Вход");
});

import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { mailedCode, openGame } from "./play.ts";

/** Plays a topic's first question in, which makes the page a guest. */
async function becomeGuest(page: Page) {
  await openGame(page, "/play/music");
  await expect(page.locator(".question-head")).toContainText("1 от 10"); // playing made a guest
}

test("a guest keeps their game with a code by email, and can sign out", async ({ page }, info) => {
  const email = `player-${info.project.name}-${Date.now()}@example.com`;
  await becomeGuest(page);
  await page.goto("/settings");
  // Nothing typed: said in the game's words (never the browser's bubble), the cursor in the field.
  await page.getByRole("button", { name: "Прати ми код" }).click();
  await expect(page.getByRole("alert")).toHaveText("Напиши имейла си.");
  await expect(page.getByLabel("Имейл")).toBeFocused();
  await page.getByLabel("Имейл").fill(email);
  await page.getByRole("button", { name: "Прати ми код" }).click();
  await expect(page.getByText(`Пратихме код на ${email}`)).toBeVisible();
  // A reload comes back to the step that takes the code.
  await page.reload();
  await expect(page.getByText(`Пратихме код на ${email}`)).toBeVisible();
  // Another code waits a minute, and the wait is said.
  await expect(page.getByRole("button", { name: "поискай нов код" })).toBeDisabled();
  await expect(page.getByText(/поискай нов код след \d+\sс/)).toBeVisible();
  // A code too short is said so; a wrong code says so, and counts.
  await page.getByLabel("Код").fill("123");
  await page.getByRole("button", { name: "Потвърди" }).click();
  await expect(page.getByRole("alert")).toHaveText("Кодът е от 6 цифри.");
  await page.getByLabel("Код").fill("000000");
  await page.getByRole("button", { name: "Потвърди" }).click();
  await expect(page.getByRole("alert")).toHaveText(/^Грешен код\./);
  await page.getByLabel("Код").fill(mailedCode(email));
  await page.getByRole("button", { name: "Потвърди" }).click();
  await expect(page.getByText(`Влизаш с ${email}`)).toBeVisible();
  // What came of it is said: the guest's game is kept.
  await expect(page.getByRole("status")).toHaveText(
    `Готово. Играта ти е запазена с имейла ${email}. Влизай с него на всяко устройство.`,
  );
  // With an email and notifications on no device, mail: the day's reminder only if asked for, a streak's end on, and
  // both the player's to switch.
  await expect(page.getByRole("switch", { name: "Напомняне по имейл" })).toHaveAttribute("aria-checked", "false");
  const mail = page.getByRole("switch", { name: "Писмо, когато серията ти прекъсне" });
  await expect(mail).toHaveAttribute("aria-checked", "true");
  await mail.click();
  await expect(mail).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(mail).toHaveAttribute("aria-checked", "false");
  // Out of the profile everywhere else; still in here.
  await page.getByRole("button", { name: "Излез от другите устройства" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Профилът ти вече" })).toHaveText(
    "Готово. Профилът ти вече е отворен само на това устройство.",
  );
  await expect(page.getByText(`Влизаш с ${email}`)).toBeVisible();
  await page.getByRole("button", { name: "Излез", exact: true }).click();
  // Signed out: said so, the way back in, and this device's own settings still here.
  await expect(page.getByText("Излезе от профила си.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Прати ми код" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Звуци" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "По-малко движение" })).toBeVisible();
  // Said there, once: Днес, next, doesn't say it again.
  await page.locator("nav.places-foot").getByRole("link", { name: "Днес" }).click();
  await expect(page.locator(".issue")).toBeVisible();
  await expect(page.getByText("Излезе от профила си.")).toHaveCount(0);
});

test("a code tried too often is dead, and a new one goes at once", async ({ page }, info) => {
  const email = `tries-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/settings");
  await page.getByLabel("Имейл").fill(email);
  await page.getByRole("button", { name: "Прати ми код" }).click();
  await expect(page.getByText(`Пратихме код на ${email}`)).toBeVisible();
  await expect.poll(() => mailedCode(email)).not.toBe("");
  const first = mailedCode(email);
  const wrong = first === "000000" ? "111111" : "000000";
  for (const said of [/^Грешен код\.$/, /^Грешен код\.$/, /Остават ти още 2 опита/, /Остава ти още 1 опит/]) {
    await page.getByLabel("Код").fill(wrong);
    await page.getByRole("button", { name: "Потвърди" }).click();
    await expect(page.getByRole("alert")).toHaveText(said);
  }
  await page.getByLabel("Код").fill(wrong);
  await page.getByRole("button", { name: "Потвърди" }).click();
  await expect(page.getByRole("alert")).toHaveText("Твърде много опити. Поискай нов код.");
  // The way on is a new code, not a minute's wait.
  await page.getByRole("button", { name: "Прати нов код" }).click();
  await expect(page.getByRole("button", { name: "Потвърди" })).toBeVisible();
  await expect.poll(() => mailedCode(email)).not.toBe(first);
  await page.getByLabel("Код").fill(mailedCode(email));
  await page.getByRole("button", { name: "Потвърди" }).click();
  await expect(page.getByText(`Влизаш с ${email}`)).toBeVisible();
});

/** The last long code mailed to `email`, as the mail has it (in fours). */
function longCode(email: string): string {
  try {
    return /\b(\d{4} \d{4} \d{4})\b/.exec(readFileSync(`test-results/mail/${email}.txt`, "utf8"))?.[1] ?? "";
  } catch {
    return "";
  }
}

test("past ten wrong codes for an address its code is longer, and still signs in", async ({ page }, info) => {
  const email = `long-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/settings");
  await page.getByLabel("Имейл").fill(email);
  await page.getByRole("button", { name: "Прати ми код" }).click();
  // Two codes' tries, all wrong: ten for the address (account.Misses), whoever gave them.
  let last = "";
  for (const _ of [1, 2]) {
    await expect.poll(() => mailedCode(email)).not.toBe(last);
    last = mailedCode(email);
    for (let i = 0; i < 5; i++) {
      await page.getByLabel("Код").fill(last === "000000" ? "111111" : "000000");
      await page.getByRole("button", { name: "Потвърди" }).click();
      await expect(page.getByRole("alert")).toHaveText(/Грешен код|Твърде много опити/);
    }
    await expect(page.getByRole("alert")).toHaveText("Твърде много опити. Поискай нов код.");
    await page.getByRole("button", { name: "Прати нов код" }).click();
    await expect(page.getByRole("button", { name: "Потвърди" })).toBeVisible(); // sent: the field is cleared for it
  }
  // The next is twelve digits, in fours in the mail: pasted as it is, it signs in.
  await expect.poll(() => longCode(email)).not.toBe("");
  await page.getByLabel("Код").fill(longCode(email));
  await expect(page.getByLabel("Код")).toHaveValue(longCode(email).replaceAll(" ", ""));
  await page.getByRole("button", { name: "Потвърди" }).click();
  await expect(page.getByText(`Влизаш с ${email}`)).toBeVisible();
});

test("a name changed in Настройки is kept on leaving, and a deleted profile ends on Начало", async ({ page }) => {
  await becomeGuest(page);
  await page.goto("/settings");
  await page.getByLabel("Име", { exact: true }).fill("Светулка");
  // Left without „Запази“: kept all the same.
  await page.getByRole("link", { name: "Профил" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Светулка" })).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Изтрий профила" }).click();
  await page.getByRole("button", { name: "Изтрий профила" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("status").filter({ hasText: "Профилът е изтрит." })).toBeVisible();
});

test("a name longer than the rule is refused in words, never cut short and saved", async ({ page }) => {
  await becomeGuest(page);
  const was = await page.evaluate(async () => (await (await fetch("/api/me")).json()).user.name as string);
  await page.goto("/settings");
  const long = "Константинова Христозова Петрова"; // 32 letters and spaces
  await page.getByLabel("Име", { exact: true }).fill(long);
  await expect(page.getByLabel("Име", { exact: true })).toHaveValue(long);
  await page.getByRole("button", { name: "Запази" }).click();
  await expect(page.getByRole("alert")).toContainText("от 2 до 30 знака");
  const now = await page.evaluate(async () => (await (await fetch("/api/me")).json()).user.name as string);
  expect(now).toBe(was);
});

// The browser's notifications go with a deleted profile: kept, they'd come back to whoever plays here next, unasked
// (push.ts: a subscription the browser has is told to the server again).
test("a deleted profile lets go of the browser's notifications", async ({ page }) => {
  // Notifications on, as far as the page can tell: a key in the page (the test server has none), and a browser
  // subscribed. The emulated iPhone is a browser tab, where an iPhone has no notifications at all: here it's as on one
  // with the game on its home screen, the push manager and notifications there.
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace('"push":""', '"push":"BKey"') });
  });
  await page.addInitScript(() => {
    const endpoint = "https://push.example/subscription";
    const sub = {
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: "key", auth: "auth" } }),
      unsubscribe: async () => {
        localStorage.setItem("unsubscribed", "1");
        return true;
      },
    };
    const reg = {
      active: {},
      pushManager: { getSubscription: async () => (localStorage.getItem("unsubscribed") ? null : sub) },
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg) },
    });
    for (const api of ["PushManager", "Notification"])
      if (!(api in window)) Object.defineProperty(window, api, { configurable: true, value: class {} });
  });
  await becomeGuest(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Изтрий профила" }).click();
  await page.getByRole("button", { name: "Изтрий профила" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Профилът е изтрит." })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("unsubscribed"))).toBe("1");
});

test("„Вход“ in the bar is the sign-in form, at once", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Вход", exact: true }).click();
  await expect(page).toHaveURL(/\/me#signin$/);
  await expect(page.getByLabel("Имейл")).toBeVisible();
  await expect(page.getByRole("button", { name: "Прати ми код" })).toBeVisible();
});

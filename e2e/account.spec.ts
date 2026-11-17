import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { openGame } from "./play.ts";

/** The last sign-in code mailed to `email` (the dev server writes its mail to files). */
function mailedCode(email: string): string {
  try {
    return /\b(\d{6})\b/.exec(readFileSync(`test-results/mail/${email}.txt`, "utf8"))?.[1] ?? "";
  } catch {
    return ""; // not sent yet
  }
}

/** Plays a topic's first question in, which makes the page a guest. */
async function becomeGuest(page: Page) {
  await openGame(page, "/play/music");
  await expect(page.locator(".question-head")).toContainText("1 от 10"); // playing made a guest
}

test("a guest keeps their game with a code by email, and can sign out", async ({ page }, info) => {
  const email = `player-${info.project.name}-${Date.now()}@example.com`;
  await becomeGuest(page);
  await page.goto("/settings");
  await page.getByLabel("Имейл").fill(email);
  await page.getByRole("button", { name: "Прати ми код" }).click();
  await expect(page.getByText(`Пратихме код на ${email}`)).toBeVisible();
  // Another code waits a minute, and the wait is said.
  await expect(page.getByRole("button", { name: "прати нов код" })).toBeDisabled();
  await expect(page.getByText(/прати нов код след \d+ с/)).toBeVisible();
  // A wrong code says so, and counts.
  await page.getByLabel("Код").fill("000000");
  await page.getByRole("button", { name: "Влез" }).click();
  await expect(page.getByRole("alert")).toHaveText(/^Грешен код\./);
  await page.getByLabel("Код").fill(mailedCode(email));
  await page.getByRole("button", { name: "Влез" }).click();
  await expect(page.getByText(`Влизаш с ${email}`)).toBeVisible();
  // With an email and notifications on no device, a streak's end may come by mail: on, and the player's to stop.
  const mail = page.getByRole("switch", { name: "По имейл, когато серията ми прекъсне" });
  await expect(mail).toHaveAttribute("aria-checked", "true");
  await mail.click();
  await expect(mail).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(mail).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Излез" }).click();
  // Signed out: said so, the way back in, and this device's own settings still here.
  await expect(page.getByText("Излезе от профила.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Прати ми код" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Звуци" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "По-малко движение" })).toBeVisible();
  // Said there, once: Начало, next, doesn't say it again.
  await page.locator("nav.tabs").getByRole("link", { name: "Начало" }).click();
  await expect(page.locator(".card.day")).toBeVisible();
  await expect(page.getByText("Излезе от профила.")).toHaveCount(0);
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
    await page.getByRole("button", { name: "Влез" }).click();
    await expect(page.getByRole("alert")).toHaveText(said);
  }
  await page.getByLabel("Код").fill(wrong);
  await page.getByRole("button", { name: "Влез" }).click();
  await expect(page.getByRole("alert")).toHaveText("Твърде много опити. Поискай нов код.");
  // The way on is a new code, not a minute's wait.
  await page.getByRole("button", { name: "Прати нов код" }).click();
  await expect(page.getByRole("button", { name: "Влез" })).toBeVisible();
  await expect.poll(() => mailedCode(email)).not.toBe(first);
  await page.getByLabel("Код").fill(mailedCode(email));
  await page.getByRole("button", { name: "Влез" }).click();
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

import { expect, test } from "@playwright/test";
import { openGame, playedBefore, playRun, startDay } from "./play.ts";

test("a topic's game tells how well the topic is known, and the avatar is anyone's to choose", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await playedBefore(page, 1);
  await openGame(page, "/play/history");
  await playRun(page);
  // Ten answers in a topic are its first estimate: told under the result, quietly. Nothing about XP, levels or
  // achievements: the game has none (DECISIONS.md, „The redesign“).
  await expect(page.locator(".mastery-line")).toContainText("История");
  await expect(page.locator(".mastery-line")).toContainText("Първа оценка");
  await expect(page.locator(".screen")).not.toContainText(/XP|[Нн]иво \d|[Пп]остижени/);

  // The avatar, on Профил: every animal, none locked.
  await page.goto("/me");
  await expect(page.locator(".pick")).toHaveCount(15);
  await page.getByRole("button", { name: "Рис", exact: true }).click();
  await expect(page.getByRole("button", { name: "Рис", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Avatars are pictures (art/pictures.ts), loaded after the first screen: the lynx is drawn on its tile.
  await expect(page.locator('.pick[aria-pressed="true"] .avatar-pic path').first()).toBeAttached();
  // Kept: Профил shows it.
  await page.goto("/me");
  await expect(page.locator(".me-head .avatar.sh-lynx")).toBeVisible();
  await expect(page.locator(".bar-me .avatar.sh-lynx")).toBeVisible();

  // Sounds are on until turned off, and stay off on this device.
  await page.goto("/settings");
  await expect(page.getByRole("switch", { name: "Звуци" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: "Звуци" }).click();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Звуци" })).toHaveAttribute("aria-checked", "false");

  // Достъпност: less motion and the text's size stay on this device too (the sizes: text.spec.ts).
  await page.getByRole("switch", { name: "По-малко движение" }).click();
  await page.getByRole("radio", { name: "Едър", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/calm/);
  await expect(page.getByRole("radio", { name: "Едър", exact: true })).toHaveAttribute("aria-checked", "true");
});

// The day as the server would have it, the entry its right answers wrote told (as the server does) only once the day
// is played: with others playing, the right answer a tenth of them got; with too few, the hardest, nothing of others.
for (const { crowd, head, kicker } of [
  { crowd: true, head: "Най-рядкото ти попадение", kicker: "История · знаят го 10\u00a0%" },
  { crowd: false, head: "Днес в Алманаха ти", kicker: "История · въпрос 8" },
]) {
  test(`just played, an entry of the day is told as the book has it (${crowd ? "a crowd" : "no crowd"})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.route("**/api/day", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const t = await res.json();
      if (t.run?.done)
        t.entry = {
          n: 7,
          crowd,
          right: crowd ? 0.1 : 0,
          fact: { category: "history", question: "Кой въпрос?", answer: "Този отговор", fact: "Ето защо." },
        };
      await route.fulfill({ response: res, json: t });
    });
    await page.goto("/");
    await startDay(page);
    await playRun(page);
    const entry = page.locator(".summary .rarest");
    await expect(entry.locator("h2")).toHaveText(head);
    await expect(entry.locator(".rarest-kicker")).toHaveText(kicker);
    await expect(entry.locator(".entry-word")).toHaveText("Този отговор");
    await expect(entry.locator(".entry-q")).toHaveText("Кой въпрос?");
    await expect(entry.locator(".filed")).toHaveText("Записано в Алманаха, глава „История“");
    await expect(page.locator(".summary .btn.primary")).toHaveCount(1);
  });
}

test("after the day: one gold thing to do next, and Профил leading back to play", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await playedBefore(page, 1);
  await page.reload();
  await startDay(page);
  await playRun(page);
  // One gold action: sharing the day.
  const gold = page.locator(".btn.primary");
  await expect(gold).toHaveCount(1);
  await expect(gold).toHaveText("Сподели резултата");
  await expect(page.locator(".open-goals, .goal")).toHaveCount(0);

  // A topic, then Профил: its games, each of today's a way to go over it.
  await openGame(page, "/play/history");
  await playRun(page);
  await page.goto("/me");
  await page.getByRole("link", { name: "Всички игри" }).click();
  await page.locator("a.game").first().click();
  await expect(page).toHaveURL(/\/games\/\d+$/);
  await expect(page.locator(".day-line")).toContainText("История");
  await expect(page.locator(".reviewed")).toHaveCount(10);
  await page.getByRole("link", { name: "Профил" }).first().click();
  await expect(page).toHaveURL(/\/me$/);
});

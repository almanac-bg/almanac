import { expect, test } from "@playwright/test";
import { openGame, playedBefore, playRun, startDay } from "./play.ts";

test("a topic's game never tells how well the topic is known, and the avatar is anyone's to choose", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await playedBefore(page, 1);
  await openGame(page, "/play/history");
  await playRun(page);
  // How well the topic is known is the game's own (play/mastery.go): never told. Nothing about XP, levels or
  // achievements: the game has none (DECISIONS.md, „The direction“).
  await expect(page.locator(".summary")).toBeVisible();
  await expect(page.locator(".summary")).not.toContainText(/XP|[Нн]иво \d|[Пп]остижени|оценка|Познавач|Новак/);

  // The avatar, on its sheet over Профил: every animal, none locked, and nothing else (a seal is worn on it, never as
  // it).
  await page.goto("/me");
  await page.getByRole("button", { name: "Смени аватара" }).click();
  const sheet = page.getByRole("dialog", { name: "Аватар" });
  await expect(sheet.locator(".pick")).toHaveCount(15);
  await expect(sheet.locator(".pick:disabled")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Рис", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  // Avatars are pictures (art/pictures.ts), loaded after the first screen: the lynx is drawn on its tile.
  await expect(page.locator(".me-head .avatar.sh-lynx .avatar-pic path").first()).toBeAttached();
  // Kept: Профил shows it.
  await page.goto("/me");
  await expect(page.locator(".me-head .avatar.sh-lynx")).toBeVisible();
  // The frame's way to Профил wears it too, everywhere but on Профил itself (its head shows it there).
  await expect(page.locator(".bar-me")).toBeHidden();
  await page.goto("/almanac");
  await expect(page.locator(".bar-me .avatar.sh-lynx")).toBeVisible();

  // Sounds are on until turned off, and stay off on this device.
  await page.goto("/settings");
  await expect(page.getByRole("switch", { name: "Звуци" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: "Звуци" }).click();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Звуци" })).toHaveAttribute("aria-checked", "false");

  // Достъпност has no switches of the game's own: the text's size and less motion are the device's.
  await expect(page.getByRole("switch", { name: "По-малко движение" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Размер на текста" })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveClass(/calm/);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).not.toHaveClass(/calm/);
});

// The day as the server would have it, the entry its right answers wrote told (as the server does) only once the day
// is played: with others playing, the right answer a tenth of them got; with too few, the hardest, nothing of others.
for (const { crowd, head, kicker } of [
  { crowd: true, head: "Най-рядкото ти попадение", kicker: "вярно отговарят 10\u00a0%" },
  { crowd: false, head: "Днес в Алманаха", kicker: "въпрос 8" },
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
    const entry = page.locator(".summary .day-entry");
    await expect(entry.locator("h2")).toHaveText(head);
    await expect(entry.locator(".chip")).toHaveText("История");
    await expect(entry.locator(".entry-kicker")).toHaveText(kicker);
    await expect(entry.locator(".entry-word")).toHaveText("Този отговор");
    await expect(entry.locator(".entry-q")).toHaveText("Кой въпрос?");
    await expect(page.locator(".summary .btn.primary")).toHaveCount(1);
  });
}

test("after the day: one gold thing to do next", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await playedBefore(page, 1);
  await page.reload();
  await startDay(page);
  await playRun(page);
  // One gold action: sharing the day.
  const gold = page.locator(".btn.primary");
  await expect(gold).toHaveCount(1);
  await expect(gold).toHaveText("Сподели");
  await expect(page.locator(".open-goals, .goal")).toHaveCount(0);
});

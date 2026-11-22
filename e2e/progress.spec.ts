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

// What the day wrote, as the server would have it: the whole of its ink at a glance, its chapters each with its own,
// in the order the issue asked them, and the facts met before; no single question picked out of the ten, and no
// one chapter's bar beside the day's whole ink.
test("just played, the day's ink is told whole, by its chapters", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("**/api/me/news", (route) =>
    route.fulfill({
      json: {
        ink: 3,
        chapters: [
          { chapter: "history", ink: 2, facts: ["his-002", "his-960"] },
          { chapter: "geography", ink: 1, facts: ["geo-961"] },
        ],
        metBefore: 1,
      },
    }),
  );
  await page.goto("/");
  await startDay(page);
  await playRun(page);
  const news = page.locator(".summary .day-news");
  await expect(news.locator("h2")).toHaveText("Днес в Алманаха");
  await expect(news.locator(".ink-row")).toHaveText("+3 с\u00a0мастило");
  await expect(news.locator(".ink-chapters a")).toHaveCount(2);
  // Each chapter a tap from the facts the day wrote in it, named in the address.
  await expect(news.getByRole("link", { name: "История: +2" })).toHaveAttribute(
    "href",
    "/almanac/history?fact=his-002&fact=his-960",
  );
  await expect(news.getByRole("link", { name: "География: +1" })).toHaveAttribute(
    "href",
    "/almanac/geography?fact=geo-961",
  );
  await expect(news.locator(".news-met")).toHaveText("Един от въпросите вече беше в твоя Алманах и остава в сиво.");
  await expect(page.locator(".summary .day-entry, .summary .entry-q, .summary .standing")).toHaveCount(0);
  await expect(page.locator(".summary .btn.primary")).toHaveCount(1);
});

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

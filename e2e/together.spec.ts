import { expect, test } from "@playwright/test";
import { answer } from "./play.ts";

test("a room for two: lobby, its questions together, the standings, a game kept", async ({ browser }) => {
  // Five easy questions with the room's 6-second pause after each, in two browsers at once.
  test.setTimeout(180_000);
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await host.goto("/room");
  await host.getByRole("radio", { name: "5", exact: true }).click();
  await host.getByRole("radio", { name: "Лесни" }).click();
  await host.getByRole("button", { name: "История" }).click();
  await expect(host).toHaveURL(/\/r\/\d{6}$/);
  const code = host.url().slice(-6);
  // A new player has a drawn name: the room asks for one first (kept as it is here).
  await expect(host.getByRole("heading", { name: "Как да те виждат в стаята?" })).toBeVisible();
  await host.getByRole("button", { name: "Влез" }).click();
  await guest.goto("/room");
  await guest.getByLabel("Код на стаята").fill(code);
  await guest.getByRole("button", { name: "Влез" }).click();
  await guest.getByLabel("Име").fill("Бояна");
  await guest.getByRole("button", { name: "Влез" }).click();
  await expect(host.locator(".players li")).toHaveCount(2);
  await expect(host.locator(".players li").last()).toContainText("Бояна");
  await expect(guest.getByText(/Чакаме .* да започне/)).toBeVisible();
  await expect(guest.getByText("История · 5 въпроса · Лесни")).toBeVisible();
  await host.getByRole("button", { name: "Започни" }).click();
  for (let n = 0; n < 5; n++) {
    for (const p of [host, guest])
      await expect(p.locator(".question-head")).toContainText(`${n + 1} от 5`, { timeout: 15_000 });
    await answer(host);
    await answer(guest);
    for (const p of [host, guest]) await expect(p.locator(".verdict")).toBeVisible();
  }
  // The room moves on by itself, to the standings; the questions and their facts are there at the end.
  for (const p of [host, guest])
    await expect(p.getByRole("heading", { name: /печели/ })).toBeVisible({ timeout: 15_000 });
  await expect(host.getByRole("button", { name: "Нова игра" })).toBeVisible();
  await guest.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(guest.locator(".reviewed")).toHaveCount(5);
  // Each player's game is kept as a game of theirs.
  await expect
    .poll(() =>
      guest.evaluate(async () => {
        const s = await (await fetch("/api/me/stats")).json();
        return s.recent?.[0]?.kind;
      }),
    )
    .toBe("room");
});

test("the host sends a player out of a room, and they stay out", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await host.goto("/room");
  await host.getByRole("button", { name: "Всички теми" }).click();
  await expect(host).toHaveURL(/\/r\/\d{6}$/);
  await host.getByLabel("Име").fill("Учител");
  await host.getByRole("button", { name: "Влез" }).click();
  await guest.goto(host.url());
  await guest.getByLabel("Име").fill("Шегаджия");
  await guest.getByRole("button", { name: "Влез" }).click();
  await expect(guest.getByText("Чакаме Учител да започне.")).toBeVisible();
  // Only the host has „Махни“, and it asks twice.
  await expect(guest.getByRole("button", { name: /Махни/ })).toHaveCount(0);
  await host.getByRole("button", { name: "Махни Шегаджия" }).click();
  await host.getByRole("button", { name: "Да, махни Шегаджия" }).click();
  await expect(guest.getByRole("heading", { name: "Водещият те махна от стаята" })).toBeVisible();
  await expect(host.locator(".players li")).toHaveCount(1);
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Водещият те махна от стаята" })).toBeVisible();
});

test("two people asking for a duel play it live", async ({ browser }, info) => {
  // Matching is the server's, the same for every engine; and duels in two engines at once would match across them.
  test.skip(info.project.name !== "chromium", "one engine is enough");
  test.setTimeout(240_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  // Ana asks first and waits; Bo asks, and they meet.
  await a.goto("/duel");
  await a.getByRole("button", { name: "Намери съперник" }).click();
  await expect(a.getByRole("heading", { name: "Търсим съперник" })).toBeVisible();
  await b.goto("/duel");
  await b.getByRole("button", { name: "Намери съперник" }).click();
  for (const p of [a, b]) await expect(p.getByRole("heading", { name: "Съперникът е тук" })).toBeVisible();
  for (let n = 0; n < 10; n++) {
    for (const p of [a, b])
      await expect(p.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 15_000 });
    // Ana answers: Bo sees that she has, not what; then both answers show, side by side.
    await answer(a);
    await expect(b.locator(".live-doing")).toContainText("Отговори за");
    await answer(b);
    for (const p of [a, b]) {
      await expect(p.locator(".verdict")).toBeVisible();
      await expect(p.locator(".live-theirs")).toBeVisible();
    }
  }
  for (const p of [a, b])
    await expect(p.getByRole("heading", { name: /Победа|Загуба|Равенство/ })).toBeVisible({ timeout: 20_000 });
  await expect(a.getByRole("button", { name: "Още един дуел" })).toBeVisible();
  await a.goto("/duel");
  await expect(a.locator(".duel-row").first()).toContainText(/Победа|Загуба|Равенство/);
});

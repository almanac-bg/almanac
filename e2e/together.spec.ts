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
  await expect(host.getByRole("heading", { name: "С какво име влизаш?" })).toBeVisible();
  await host.getByRole("button", { name: "Влез" }).click();
  await guest.goto("/room");
  // A wrong code is said at once, in place, before anything is asked.
  await guest.getByLabel("Код на стаята").fill("000000");
  await guest.getByRole("button", { name: "Влез" }).click();
  await expect(guest.getByText("Няма отворена стая с този код. Провери цифрите.")).toBeVisible();
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
  await expect(host.getByRole("button", { name: "Започни нова игра" })).toBeVisible();
  // Each can add the other as a friend, a tap beside their name; the day's ten wait for both.
  await expect(guest.getByRole("link", { name: "Към въпросите на деня" })).toBeVisible();
  await guest.getByRole("button", { name: /^Добави .+ в приятели$/ }).click();
  await expect(guest.getByText("Поканата е изпратена.")).toBeVisible();
  await expect(host.getByRole("button", { name: "Добави Бояна в приятели" })).toBeVisible();
  // Between games the host changes what the room plays: the code and the players stay.
  await expect(guest.getByRole("button", { name: "Промени играта" })).toHaveCount(0);
  await host.getByText("Промени играта").click();
  const change = host.locator("details.more", { hasText: "Промени играта" });
  await change.getByRole("radio", { name: "10", exact: true }).click();
  await expect(change.getByRole("button", { name: "История" })).toHaveAttribute("aria-pressed", "true");
  await change.getByRole("button", { name: "Всички теми" }).click();
  await expect(change.getByRole("button", { name: "Всички теми" })).toHaveAttribute("aria-pressed", "true");
  await expect(change.getByRole("button", { name: "История" })).toHaveAttribute("aria-pressed", "false");
  await expect(guest.locator(".intro .kicker")).toHaveText(`Стая ${code.slice(0, 3)} ${code.slice(3)} · Всички теми`);
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

test("a room's link with a wrong code says so before asking for a name", async ({ page }) => {
  await page.goto("/r/000000");
  await expect(page.getByRole("heading", { name: "Няма такава стая" })).toBeVisible();
  await expect(page.getByLabel("Име")).toHaveCount(0);
  await page.getByRole("link", { name: "Опитай друг код" }).click();
  await expect(page.getByLabel("Код на стаята")).toBeVisible();
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
  for (const p of [a, b]) {
    await expect(p.getByRole("heading", { name: "Съперникът е тук" })).toBeVisible();
    // The seconds to the first question, seen as they're heard: big, in the screen, above the tabs.
    await expect(p.getByRole("timer")).toBeInViewport();
  }
  // Ana's first answer doesn't get through (the line drops as it's sent): it's sent again, and Bo sees it come.
  await a.route("**/api/duels/live/*/answer", (route) => route.abort("connectionreset"), { times: 1 });
  for (let n = 0; n < 10; n++) {
    for (const p of [a, b])
      await expect(p.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 15_000 });
    // Leaving costs the duel: the arrow (and back) asks first, saying so; „Остани“ plays on.
    const asked = a.getByText("Излизаш от дуела? Той продължава без теб");
    if (n === 1) {
      await a.goBack();
      await expect(asked).toBeVisible();
      await expect(a).toHaveURL(/\/duel\/live$/);
      await a.getByRole("button", { name: "Остани" }).click();
      await expect(asked).toBeHidden();
    }
    // Left all the same: Начало says the duel goes on, and „Върни се“ is back in it, on the same question.
    if (n === 2) {
      await a.getByRole("link", { name: "Към Начало", exact: true }).click();
      await expect(asked).toBeVisible();
      await a.getByRole("button", { name: "Излез" }).click();
      await expect(a).toHaveURL(/\/$/);
      // Bo is told at once, not after the half minute a dropped line is waited for.
      await expect(b.locator(".live-doing")).toHaveText("Излезе от дуела.", { timeout: 5_000 });
      await a
        .getByRole("status")
        .filter({ hasText: "Дуелът ти продължава" })
        .getByRole("link", { name: "Върни се" })
        .click();
      await expect(a.locator(".question-head")).toContainText("3 от 10", { timeout: 15_000 });
      await expect(b.locator(".live-doing")).toHaveText("Мисли…"); // and back, to Bo too
    }
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
  // Against a person, the gold button is a rematch with them; another duel with whoever comes is beside it.
  await expect(a.getByRole("button", { name: "Реванш" })).toHaveClass(/primary/);
  await expect(a.getByRole("button", { name: "Още един дуел" })).not.toHaveClass(/primary/);
  // Face to face and question by question, the same duel from both sides: what one won, the other lost.
  for (const p of [a, b]) {
    await expect(p.locator(".duel-head .kicker")).toHaveText(/^Дуел на живо (с|със) \S/);
    await expect(p.locator(".duel-marks .duel-pip:is(.right, .partial, .wrong)")).toHaveCount(20);
    await expect(p.locator(".duel-record")).toBeVisible();
  }
  const verdicts = [await a.locator(".duel-verdict").textContent(), await b.locator(".duel-verdict").textContent()];
  expect(verdicts.sort()).toEqual(verdicts.includes("Равенство") ? ["Равенство", "Равенство"] : ["Загуба", "Победа"]);
  // Met by chance: a tap under the other asks them to be friends.
  await a
    .locator(".duel-add")
    .getByRole("button", { name: /^Добави .+ в приятели$/ })
    .click();
  await expect(a.locator(".duel-add")).toHaveText("Поканата е изпратена.");
  // Ana asks for a rematch: Bo sees it, asks too, and they're face to face again.
  await a.getByRole("button", { name: "Реванш" }).click();
  await expect(a.getByRole("heading", { name: "Реванш" })).toBeVisible();
  await expect(b.locator(".rematch-asks")).toHaveText(/иска реванш\.$/);
  await b.getByRole("button", { name: "Реванш" }).click();
  for (const p of [a, b]) await expect(p.getByRole("heading", { name: "Съперникът е тук" })).toBeVisible();
  await a.goto("/duel");
  await expect(a.locator(".duel-row").first()).toContainText(/Победа|Загуба|Равенство/);
  // Opened again from the duels, it's the same result, standing still (the moment was once), with no live duel's
  // „Още един дуел“: the way back is the gold one.
  await a.locator(".duel-row").first().click();
  await expect(a.locator(".duel-verdict")).toHaveText(verdicts.includes("Равенство") ? "Равенство" : /Победа|Загуба/);
  await expect(a.locator(".duel-marks .duel-pip:is(.right, .partial, .wrong)")).toHaveCount(20);
  await expect(a.getByRole("link", { name: "Към дуелите" })).toHaveClass(/primary/);
});

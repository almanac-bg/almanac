import { expect, test } from "@playwright/test";
import { answer, meetAs } from "./play.ts";

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
  // That name is the room's alone: her own (on the boards, her profile) stays the one she had.
  expect(await guest.evaluate(async () => (await (await fetch("/api/me")).json()).user.name)).not.toBe("Бояна");
  await expect(guest.getByText(/Чакаме .* да започне/)).toBeVisible();
  await expect(guest.getByText("История · 5 въпроса · Лесни")).toBeVisible();
  await host.getByRole("button", { name: "Започни" }).click();
  // Бояна's first answer doesn't get through (the line drops as it's sent): it's sent again, and taken.
  await guest.route("**/api/rooms/*/answer", (route) => route.abort("connectionreset"), { times: 1 });
  for (let n = 0; n < 5; n++) {
    for (const p of [host, guest])
      await expect(p.locator(".question-head")).toContainText(`${n + 1} от 5`, { timeout: 15_000 });
    await answer(guest);
    if (n === 0) await expect(guest.getByText(/^Отговорът ти е приет\./)).toBeVisible();
    await answer(host);
    for (const p of [host, guest]) await expect(p.locator(".verdict")).toBeVisible();
  }
  // The room moves on by itself, to the standings; the questions and their facts are there at the end.
  for (const p of [host, guest])
    await expect(p.getByRole("heading", { name: /печели/ })).toBeVisible({ timeout: 15_000 });
  await expect(host.getByRole("button", { name: "Започни нова игра" })).toBeVisible();
  // How many each got right, by the place and in every row.
  await expect(guest.getByText(/^Позна \d от 5 и си на \d-(во|ро) място от 2\.$/)).toBeVisible();
  await expect(guest.locator(".board .row").first()).toContainText(/\d\/5 ·/);
  // Each can add the other as a friend, folded under the standings; the day's ten wait for both.
  await expect(guest.getByRole("link", { name: "Към въпросите на деня" })).toBeVisible();
  await guest.getByText("Добави в приятели").click();
  await guest.getByRole("button", { name: /^Добави .+ в приятели$/ }).click();
  await expect(guest.getByText("Поканата е изпратена.")).toBeVisible();
  await host.getByText("Добави в приятели").click();
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

test("someone new comes into a game under way by the room's link, not by its code alone", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  const opened = host.waitForResponse((r) => r.url().endsWith("/api/rooms") && r.request().method() === "POST");
  await host.goto("/room");
  await host.getByRole("button", { name: "Всички теми" }).click();
  const { url } = await (await opened).json();
  await host.getByRole("button", { name: "Влез" }).click();
  await host.getByRole("button", { name: "Започни" }).click();
  await expect(host.locator(".question")).toBeVisible();
  const late = await (await browser.newContext()).newPage();
  await late.goto(host.url()); // the code alone
  await expect(late.getByRole("heading", { name: "Играта вече започна" })).toBeVisible();
  await expect(late.getByLabel("Име")).toHaveCount(0);
  await late.goto(new URL(url).pathname + new URL(url).hash); // the room's link
  await late.reload();
  await late.getByLabel("Име").fill("Закъснял");
  await late.getByRole("button", { name: "Влез" }).click();
  await expect(late.locator(".question, .reveal, .board").first()).toBeVisible();
  // The host's screen counts them in: of two now, or by name on the board once the answer shows.
  await expect(host.getByText(/от 2\.|Закъснял/).first()).toBeVisible();
});

test("a room's link opened from a chat: its host is waited for, and back mid-game asks, then leaves for Начало", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await host.goto("/room");
  await host.getByRole("button", { name: "Всички теми" }).click();
  await expect(host.getByRole("heading", { name: "С какво име влизаш?" })).toBeVisible();
  // The guest is in first, the room's link the first page of a new tab, while the host still chooses a name: the host
  // shows as there, and the start stays the host's.
  await guest.goto(host.url());
  await guest.getByLabel("Име").fill("Бояна");
  await guest.getByRole("button", { name: "Влез" }).click();
  await expect(guest.getByText(/^Чакаме .+ да започне\.$/)).toBeVisible();
  await expect(guest.getByRole("button", { name: "Започни" })).toHaveCount(0);
  await expect(guest.getByText("извън стаята")).toHaveCount(0);
  await host.getByLabel("Име").fill("Водещ");
  await host.getByRole("button", { name: "Влез" }).click();
  await host.getByRole("button", { name: "Започни" }).click();
  await expect(guest.locator(".question-head")).toContainText("1 от 10", { timeout: 15_000 });
  // Back mid-game asks first, and „Остани“ plays on; then „Излез“ leaves the game for Начало, not into it again.
  const asked = guest.getByText("Излизаш от стаята? Играта продължава без теб");
  await guest.goBack();
  await expect(asked).toBeVisible();
  await expect(guest).toHaveURL(/\/r\/\d{6}$/);
  await guest.getByRole("button", { name: "Остани" }).click();
  await expect(asked).toBeHidden();
  await guest.goBack();
  await guest.getByRole("button", { name: "Излез" }).click();
  await expect(guest).toHaveURL(/\/$/);
  await expect(guest.locator(".card.day")).toBeVisible();
});

test("a room's link with a wrong code says so before asking for a name", async ({ page }) => {
  await page.goto("/r/000000");
  await expect(page.getByRole("heading", { name: "Няма такава стая" })).toBeVisible();
  await expect(page.getByLabel("Име")).toHaveCount(0);
  await page.getByRole("link", { name: "Опитай друг код" }).click();
  await expect(page.getByLabel("Код на стаята")).toBeVisible();
});

test("the host sends a player out of a room, brings them back, asks for another name, and locks it", async ({
  browser,
}) => {
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
  await expect(host.locator(".players li:not(.out)")).toHaveCount(1);
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Водещият те махна от стаята" })).toBeVisible();
  await expect(host.getByText("Всеки с кода може да влезе.")).toBeVisible();
  // A slip undone: „Върни“, and they come in again, as they were.
  await host.getByRole("button", { name: "Върни Шегаджия в стаята" }).click();
  await guest.getByRole("button", { name: "Влез пак" }).click();
  await expect(guest.getByText("Чакаме Учител да започне.")).toBeVisible();
  await expect(host.locator(".players li")).toHaveCount(2);
  // The host asks for another name: theirs is drawn meanwhile, and the old one isn't taken back.
  await host.getByRole("button", { name: "Поискай друго име от Шегаджия" }).click();
  await expect(guest.getByRole("heading", { name: "Водещият помоли за друго име" })).toBeVisible();
  await expect(host.locator(".players li").last()).not.toContainText("Шегаджия");
  await guest.getByLabel("Име").fill("шегаджия");
  await guest.getByRole("button", { name: "Готово" }).click();
  await expect(guest.getByText("Водещият помоли за друго име. Избери ново.")).toBeVisible();
  await guest.getByLabel("Име").fill("Ванко");
  await guest.getByRole("button", { name: "Готово" }).click();
  await expect(guest.getByText("Чакаме Учител да започне.")).toBeVisible();
  await expect(host.locator(".players li").last()).toContainText("Ванко");
  // The host locks the room, everyone in: nobody new comes in until it's open again.
  await expect(host.getByText("Всички ли са вътре? Заключи стаята и никой нов няма да влезе.")).toBeVisible();
  await host.getByRole("button", { name: "Заключи стаята" }).click();
  await expect(host.getByText("Стаята е заключена: нови играчи не могат да влязат.")).toBeVisible();
  const late = await (await browser.newContext()).newPage();
  await late.goto(host.url());
  // Said at once, before a name is asked.
  await expect(late.getByRole("heading", { name: "Стаята е заключена" })).toBeVisible();
  await host.getByRole("button", { name: "Отключи" }).click();
  await late.getByRole("button", { name: "Опитай пак" }).click();
  await late.getByLabel("Име").fill("Закъснял");
  await late.getByRole("button", { name: "Влез" }).click();
  await expect(late.getByText("Чакаме Учител да започне.")).toBeVisible();
  await expect(host.locator(".players li")).toHaveCount(3);
});

test("on a narrow phone, a long name stays beside its avatar and the host's buttons go under it", async ({
  browser,
}) => {
  const host = await (await browser.newContext({ viewport: { width: 320, height: 640 } })).newPage();
  const guest = await (await browser.newContext()).newPage();
  await host.goto("/room");
  await host.getByRole("button", { name: "Всички теми" }).click();
  await expect(host).toHaveURL(/\/r\/\d{6}$/);
  await host.getByLabel("Име").fill("Учител");
  await host.getByRole("button", { name: "Влез" }).click();
  await guest.goto(host.url());
  await guest.getByLabel("Име").fill("Александра-Магдалена Петрова");
  await guest.getByRole("button", { name: "Влез" }).click();
  const chip = host.locator(".players li").last();
  await expect(chip).toContainText("Александра-Магдалена Петрова");
  const [avatar, name, acts, list] = await Promise.all([
    chip.locator(".avatar").boundingBox(),
    chip.locator(".player-name").boundingBox(),
    chip.locator(".player-acts").boundingBox(),
    host.locator(".players").boundingBox(),
  ]);
  if (!avatar || !name || !acts || !list) throw new Error("the chip isn't on the screen");
  expect(name.x).toBeGreaterThanOrEqual(avatar.x + avatar.width);
  expect(name.y).toBeLessThan(avatar.y + avatar.height);
  expect(acts.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(acts.x + acts.width).toBeLessThanOrEqual(list.x + list.width + 0.5);
});

test("two people asking for a duel play it live", async ({ browser }, info) => {
  // Matching is the server's, the same for every engine; and duels in two engines at once would match across them.
  test.skip(info.project.name !== "chromium", "one engine is enough");
  test.setTimeout(240_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  // Ana asks first and waits; Bo asks, from a link to live duels opened in a new tab, and they meet. Each, the first
  // time, is asked for a name of their own first: Ana gives hers, Bo keeps his drawn one.
  await a.goto("/duel");
  await a.getByRole("button", { name: "Намери съперник" }).click();
  await meetAs(a, "Ана");
  await expect(a.getByRole("heading", { name: "Търсим съперник" })).toBeVisible();
  await b.goto("/duel/live");
  await b.getByRole("button", { name: "Намери съперник" }).click();
  await meetAs(b);
  await expect(b.locator(".live-face .live-name", { hasText: "Ана" })).toBeVisible();
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
    // Bo, his page the tab's first, is asked by back too: it doesn't leave the site under him.
    if (n === 3) {
      const his = b.getByText("Излизаш от дуела? Той продължава без теб");
      await b.goBack();
      await expect(his).toBeVisible();
      await expect(b).toHaveURL(/\/duel\/live$/);
      await b.getByRole("button", { name: "Остани" }).click();
      await expect(his).toBeHidden();
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

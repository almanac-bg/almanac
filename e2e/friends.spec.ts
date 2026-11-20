import { expect, test } from "@playwright/test";
import { befriend, playedBefore, playedFair, playRun, startDay } from "./play.ts";

test("friends on the day: who has played it, and how each went", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // Ana plays the day with no friends yet: one quiet line, a way to add someone.
  await a.goto("/");
  await startDay(a);
  await playRun(a);
  await playedFair(a);
  const add = a.getByRole("link", { name: /^Добави приятел и сравнявайте резултатите си всеки ден/ });
  await expect(add).toHaveAttribute("href", "/friends");
  const ana = await a.evaluate(async () => (await (await fetch("/api/me")).json()).user.name as string);

  // Bo asks her by her username, and she says yes. Before he plays, Начало names her, without her score.
  await befriend(a, b);
  await b.goto("/");
  await expect(b.locator(".day-meta").last()).toHaveText(`${ana} вече изигра днешните въпроси.`);

  // He plays the day: one gold action under the result, and both on the friends' day, his own row marked, each with
  // how their ten went.
  await startDay(b);
  await playRun(b);
  await expect(b.locator(".tomorrow")).toBeVisible();
  await expect(b.locator(".summary .btn.primary")).toHaveCount(1);
  await b.goto("/");
  const friends = b.locator(".board", { has: b.getByRole("heading", { name: "Приятелите ти днес" }) });
  await expect(friends.locator(".row")).toHaveCount(2);
  await expect(friends.locator(".row.me .you")).toHaveText("ти");
  await expect(friends.locator(".row").filter({ hasText: ana }).locator(".pts")).toHaveText(/^\d+ от 10$/);
  await expect(friends.locator(".row .trail li")).toHaveCount(20);
});

test("friends by tag: a name and a tag of one's own, a request, a yes", async ({ browser }, info) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const tag = `ana_${info.project.name.slice(0, 3)}${Date.now() % 100000}`;

  // Ana becomes a player, and takes a full name (anyone's) and a tag (hers alone).
  await a.goto("/friends");
  await a.locator(".friends").getByRole("button", { name: "Добави приятел" }).click();
  await a.goto("/settings");
  await a.getByLabel("Име", { exact: true }).fill("Ана Петрова");
  await a.getByLabel("Потребителско име", { exact: true }).fill(`@${tag}`);
  await a.getByRole("button", { name: "Запази" }).click();
  await expect(a.getByText("Запазено.")).toBeVisible();
  // A tag the game doesn't take: its rule in the game's words (not the browser's), the last „Запазено.“ gone.
  await a.getByLabel("Потребителско име", { exact: true }).fill("мечка");
  await expect(a.getByText("Запазено.")).toHaveCount(0);
  await a.getByRole("button", { name: "Запази" }).click();
  await expect(a.locator("form .bad")).toHaveText(/^Потребителското име трябва да е от 3 до 20 знака/);
  await a.getByLabel("Потребителско име", { exact: true }).fill(`@${tag}`);
  await a.goto("/me");
  await expect(a.locator(".me-tag")).toHaveText(`@${tag}`);

  // Bo asks her by that tag; an unknown tag is said to be unknown. A guest who hasn't finished a game is told to play
  // one first: a request is a player's.
  await b.goto("/friends");
  await b.locator(".friends").getByRole("button", { name: "Добави приятел" }).click();
  await expect(b.getByText("Още нямаш приятели тук. Добави ги по потребителско име или имейл.")).toBeVisible();
  // Nothing typed: said in the game's words, the cursor in the field.
  await b.getByRole("button", { name: "Добави", exact: true }).click();
  await expect(b.getByRole("alert")).toHaveText("Напиши потребителското име или имейла на приятеля си.");
  await expect(b.getByLabel("Потребителско име или имейл на приятел")).toBeFocused();
  await b.getByLabel("Потребителско име или имейл на приятел").fill(`@${tag}`);
  await b.getByRole("button", { name: "Добави", exact: true }).click();
  await expect(b.getByText("Първо изиграй една игра, после добавяй приятели.")).toBeVisible();
  await playedBefore(b, 1);
  await b.getByLabel("Потребителско име или имейл на приятел").fill("@nosuch_player_here");
  await b.getByRole("button", { name: "Добави", exact: true }).click();
  await expect(b.getByText("Няма играч с такова потребителско име.")).toBeVisible();
  await b.getByLabel("Потребителско име или имейл на приятел").fill(`@${tag.toUpperCase()}`);
  await b.getByRole("button", { name: "Добави", exact: true }).click();
  await expect(b.getByText("Поканата до Ана Петрова е изпратена.")).toBeVisible();
  await expect(b.locator(".waiting")).toContainText(`@${tag}`);

  // Ana sees the dot on Приятели in the bar and the request there, and says yes.
  await a.goto("/");
  const bar = a.getByRole("navigation", { name: "Основно" });
  await expect(bar.getByRole("link", { name: /Приятели/ })).toHaveClass(/news/);
  await bar.getByRole("link", { name: /Приятели/ }).click();
  await expect(a).toHaveURL(/\/friends$/);
  await expect(a.locator(".invitation")).toContainText("иска да сте приятели");
  await a.locator(".invitation").getByRole("button", { name: "Приеми" }).click();
  await expect(a.locator(".friend")).toHaveCount(1);
  await b.reload();
  await expect(b.locator(".friend .friend-tag")).toHaveText(` @${tag}`);

  // Bo hears of her yes on Начало, once, a tap from his friends.
  await b.goto("/");
  const yes = b.locator(".streak-notice", { hasText: "Ана Петрова прие поканата ти за приятелство." });
  await expect(yes.getByRole("link", { name: "Приятели" })).toHaveAttribute("href", "/friends");
  await b.reload();
  await expect(b.locator(".day")).toBeVisible();
  await expect(yes).toHaveCount(0);
});

test("a request turned down, a friend removed", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const p of [a, b]) {
    await p.goto("/friends");
    await p.locator(".friends").getByRole("button", { name: "Добави приятел" }).click();
  }
  await playedBefore(b, 1);
  const tag = await a.evaluate(async () => (await (await fetch("/api/me")).json()).user.tag as string);
  const ask = async () => {
    await b.goto("/friends");
    await b.getByLabel("Потребителско име или имейл на приятел").fill(`@${tag}`);
    await b.getByRole("button", { name: "Добави", exact: true }).click();
    await expect(b.getByText(/^Поканата до .+ е изпратена\.$/)).toBeVisible();
  };
  await ask();

  // Ana says no: the request is gone from both.
  await a.reload();
  await a.locator(".invitation").getByRole("button", { name: "Откажи" }).click();
  await expect(a.locator(".invitation")).toHaveCount(0);
  await b.reload();
  await expect(b.locator(".waiting")).toHaveCount(0);

  // He asks again, she says yes; then she removes him, and they're friends no more on either side.
  await ask();
  await a.reload();
  await a.locator(".invitation").getByRole("button", { name: "Приеми" }).click();
  await expect(a.locator(".friend")).toHaveCount(1);
  await a.getByRole("button", { name: "Промени" }).click();
  await a.locator(".friend").getByRole("button", { name: "Премахни" }).click();
  await expect(a.locator(".friend")).toHaveCount(0);
  await b.reload();
  await expect(b.getByText("Още нямаш приятели тук. Добави ги по потребителско име или имейл.")).toBeVisible();
});

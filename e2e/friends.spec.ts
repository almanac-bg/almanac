import { expect, test } from "@playwright/test";
import { playedFair, playRun } from "./play.ts";

test("friends: an invite link, then a duel between the two", async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // Ana's link: a player is made for her the first time she asks for it.
  await a.goto("/friends");
  await a.locator(".friends").getByRole("button", { name: "Покани приятел" }).click();
  const link = await a.locator(".invite-link").getAttribute("href");
  expect(link).toMatch(/^\/f\/[a-z0-9]{8}$/);

  // Bo opens it and accepts: they're friends, both ways.
  await b.goto(link ?? "");
  await expect(b.getByRole("heading", { name: /иска да сте приятели/ })).toBeVisible();
  await b.getByRole("button", { name: /^Добави .+ в приятели$/ }).click();
  await expect(b.getByRole("heading", { name: /Вече сте приятели/ })).toBeVisible();
  await a.reload();
  await expect(a.locator(".friend")).toHaveCount(1);

  // Ana challenges Bo and plays hers now; once she has, Bo is told wherever he is, and plays from there.
  await a.locator(".friend").getByRole("button", { name: "Дуел" }).click();
  // Each question says whom it's a duel with.
  await expect(a.locator(".question-head .versus")).toHaveText(/^Дуел (с|със) \S/);
  await playRun(a);
  await expect(a.getByRole("heading", { name: "Изигра своя дуел" })).toBeVisible({ timeout: 10_000 });
  await b.goto("/");
  const notice = b.locator(".challenge-notice");
  await expect(notice).toContainText("те предизвика на дуел");
  await notice.getByRole("button", { name: "Играй" }).click();
  await expect(b.locator(".question-head .versus")).toHaveText(/^Дуел (с|със) \S/);
  await playRun(b);
  await expect(b.locator(".challenge-notice")).toHaveCount(0);
  await expect(b.getByRole("heading", { name: /Победа|Загуба|Равенство/ })).toBeVisible({ timeout: 10_000 });
  // Played: the notice doesn't come back on the way out (no reload), nor its dot on Начало.
  await b.locator('nav.tabs a[href="/"]').click();
  await expect(b.locator("nav.tabs a.news")).toHaveCount(0);
  await expect(b.locator(".challenge-notice")).toHaveCount(0);
  await a.goto("/duel");
  await expect(a.locator(".duel-row").first()).toContainText(/Победа|Загуба|Равенство/);

  // The duel counts in their record.
  await a.goto("/friends");
  await expect(a.locator(".friend .record")).toBeVisible();
});

test("friends on the day: a shared link to it, who has played it, and how each went", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // Ana plays the day with no friends yet: one quiet line asks her to invite someone.
  await a.goto("/");
  await a.getByRole("button", { name: "Започни" }).click();
  await playRun(a);
  await playedFair(a);
  await expect(a.getByRole("link", { name: /^Покани някого/ })).toBeVisible();

  // Her link (the one her shared result ends with) brings Cy to the day, with her score; Cy adds her before playing,
  // and the day's ten stay the gold action. Начало then names her, without her score.
  const ana = await a.evaluate(async () => (await (await fetch("/api/me")).json()).user.name as string);
  const right = Number(await a.locator(".score-n").textContent());
  await a.goto("/friends");
  const link = (await a.locator(".invite-link").getAttribute("href")) ?? "";
  const c = await (await browser.newContext()).newPage();
  await c.goto(link);
  await expect(c.getByRole("heading", { name: `${ana} има ${right} от 10 днес. А ти?` })).toBeVisible();
  await c.getByRole("button", { name: `Добави ${ana} в приятели` }).click();
  await expect(c.getByText("Вече сте приятели.")).toBeVisible();
  await expect(c.getByRole("button", { name: "Играй днешните 10" })).toHaveClass(/primary/);
  await expect(c.getByRole("button", { name: "Покани на дуел" })).toBeVisible();
  await c.goto("/");
  await expect(c.locator(".day-meta").last()).toHaveText(`${ana} вече изигра днешните въпроси.`);

  // Bo plays the day right there, sees the two results side by side, and adds her: a tap, never by itself.
  await b.goto(link);
  await b.getByRole("button", { name: "Играй днешните 10" }).click();
  await playRun(b);
  await expect(b.locator(".place-line")).toHaveText(new RegExp(`^Ти: \\d+\\sот\\s10 · ${ana}: ${right}\\sот\\s10$`));
  await b.getByRole("button", { name: `Добави ${ana} в приятели` }).click();
  await expect(b.getByText("Вече сте приятели.")).toBeVisible();

  // Then, on Начало: both on the friends' day, his own row marked, each with how their ten went.
  await b.goto("/");
  const friends = b.locator(".board", { has: b.getByRole("heading", { name: "Приятелите ти днес" }) });
  await expect(friends.locator(".row")).toHaveCount(2);
  await expect(friends.locator(".row.me .you")).toHaveText("ти");
  await expect(friends.locator(".row").filter({ hasText: ana }).locator(".pts")).toHaveText(/^\d+ от 10$/);
  await expect(friends.locator(".row .trail li")).toHaveCount(20);
});

test("a friend can turn a duel down", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto("/friends");
  await a.locator(".friends").getByRole("button", { name: "Покани приятел" }).click();
  const link = await a.locator(".invite-link").getAttribute("href");
  await b.goto(link ?? "");
  await b.getByRole("button", { name: /^Добави .+ в приятели$/ }).click();
  await expect(b.getByRole("heading", { name: /Вече сте приятели/ })).toBeVisible();
  await a.reload();
  await a.locator(".friend").getByRole("button", { name: "Дуел" }).click();
  await playRun(a);
  // From its own screen…
  await b.goto("/duel");
  await b.locator(".duel-row.s-play").click();
  await b.getByRole("button", { name: "Откажи" }).click();
  await expect(b.getByRole("heading", { name: "Дуелът е отказан" })).toBeVisible();
  // …or from the notice, wherever Bo is.
  await a.goto("/friends");
  await a.locator(".friend").getByRole("button", { name: "Дуел" }).click();
  await playRun(a);
  await b.goto("/");
  await b.locator(".challenge-notice").getByRole("button", { name: "Откажи" }).click();
  await expect(b.locator(".challenge-notice")).toHaveCount(0);
  await a.goto("/duel");
  await expect(a.locator(".duel-row").first()).toContainText("Отказан");
});

test("friends by tag: a name and a tag of one's own, a request, a yes", async ({ browser }, info) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const tag = `ana_${info.project.name.slice(0, 3)}${Date.now() % 100000}`;

  // Ana becomes a player, and takes a full name (anyone's) and a tag (hers alone).
  await a.goto("/friends");
  await a.locator(".friends").getByRole("button", { name: "Покани приятел" }).click();
  await a.goto("/settings");
  await a.getByLabel("Име", { exact: true }).fill("Ана Петрова");
  await a.getByLabel("Потребителско име", { exact: true }).fill(`@${tag}`);
  await a.getByRole("button", { name: "Запази" }).click();
  await expect(a.getByText("Запазено.")).toBeVisible();
  await a.goto("/me");
  await expect(a.locator(".me-tag")).toHaveText(`@${tag}`);

  // Bo asks her by that tag; an unknown tag is said to be unknown.
  await b.goto("/friends");
  await b.locator(".friends").getByRole("button", { name: "Покани приятел" }).click();
  await b.getByLabel("Потребителско име или имейл на приятел").fill("@nosuch_player_here");
  await b.getByRole("button", { name: "Покани", exact: true }).click();
  await expect(b.getByText("Няма играч с такова потребителско име.")).toBeVisible();
  await b.getByLabel("Потребителско име или имейл на приятел").fill(`@${tag.toUpperCase()}`);
  await b.getByRole("button", { name: "Покани", exact: true }).click();
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
});

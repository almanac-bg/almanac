import { expect, test } from "@playwright/test";
import { befriendByLink, meetAs, playedFair, playRun, startDay } from "./play.ts";

test("friends: an invite link, then a challenge between the two", async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // Ana's link: a player is made for her the first time she asks for it.
  await a.goto("/friends");
  await a.locator(".friends").getByRole("button", { name: "Покани приятел" }).click();
  const link = await a.locator("[data-invite]").first().getAttribute("data-invite");
  expect(link).toMatch(/^\/f\/[a-z0-9]{8}$/);

  // Bo opens it and asks: a request, Ana's to accept (a link alone makes nobody a friend).
  await b.goto(link ?? "");
  // Ana hasn't played today: her link is to the day's ten (a link may go to a whole group), with being friends under.
  await expect(b.getByRole("heading", { name: /те кани на въпросите на деня$/ })).toBeVisible();
  await b.getByRole("button", { name: /^Добави .+ в приятели$/ }).click();
  // The request carries his name: one of his own first, never the one drawn for him unasked.
  await meetAs(b, "Борис");
  await expect(b.getByText(/^Поканата е изпратена\. Щом .+ я приеме, ставате приятели\.$/)).toBeVisible();
  // Back at the link once he has played the day, nothing to set side by side: one heading, that he waits for her,
  // and a way on.
  await b.route("**/api/invites/*", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), mine: 7 } });
  });
  await b.reload();
  await expect(b.getByRole("heading", { level: 1 })).toHaveText(/^Чакаш .+ да приеме$/);
  await expect(b.getByRole("link", { name: "Към Начало" })).toHaveClass(/primary/);
  await b.unroute("**/api/invites/*");
  await a.reload();
  await expect(a.locator(".friend")).toHaveCount(0);
  await expect(a.locator(".invitation")).toContainText("Борис");
  await a.locator(".invitation").getByRole("button", { name: "Приеми" }).click();
  await expect(a.locator(".friend")).toHaveCount(1);
  // Bo hears of her yes on Начало, once, a tap from challenging Ana.
  await b.goto("/");
  const yes = b.locator(".streak-notice", { hasText: "прие поканата ти." });
  await expect(yes.getByRole("link", { name: "Предизвикай" })).toHaveAttribute("href", /^\/challenge\/\d+$/);
  await b.reload();
  await expect(b.locator(".day")).toBeVisible();
  await expect(yes).toHaveCount(0);
  await a.goto("/friends");

  // A tap by mistake costs nothing: the count-in comes first (after her name, asked the first time she meets
  // others), and „Откажи“ goes back with nothing made.
  await a.locator(".friend").getByRole("button", { name: "Предизвикай" }).click();
  await meetAs(a);
  await expect(a.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await a.getByRole("button", { name: "Откажи" }).click();
  await expect(a.locator(".friend")).toHaveCount(1);
  expect((await (await a.request.get("/api/duels")).json()).duels).toHaveLength(0);

  // Ana challenges Bo and plays hers now; once she has, Bo is told wherever he is, and plays from there.
  await a.locator(".friend").getByRole("button", { name: "Предизвикай" }).click();
  await a.getByRole("button", { name: "Започни сега" }).click();
  // Each question says whom it's a duel with.
  await expect(a.locator(".question-head .versus")).toHaveText(/^Дуел (с|със) \S/);
  await playRun(a);
  await expect(a.getByRole("heading", { name: "Твоите десет са изиграни" })).toBeVisible({ timeout: 10_000 });
  // Sent already, in the game, and until when, in one sentence that ends once („… 13:39 ч. Ще ти кажем …“).
  await expect(a.locator(".duel-line")).toContainText(/^Изпратено на .+ в играта\. Има време до .+\sч\. Ще ти кажем/);
  // Her side, face to face with Bo's still to come: her score and her ten marks; his row empty, and no result yet.
  await expect(a.locator(".duel-face").first().locator(".duel-points")).toHaveText(/^\d[\d\s]*$/);
  await expect(a.locator(".duel-face").last()).toContainText("Тепърва ще играе");
  await expect(a.locator(".duel-marks .duel-pip:is(.right, .partial, .wrong)")).toHaveCount(10);
  await expect(a.locator(".duel-meant")).toHaveCount(0);
  // Nothing's left to do: the gold way is back to the duels, and the challenge's link (it brings him to his turn) is
  // there to send too, plain.
  await expect(a.getByRole("link", { name: "Към дуелите" })).toHaveClass(/primary/);
  await expect(a.getByRole("button", { name: "Прати и връзката" })).not.toHaveClass(/primary/);
  // Until Bo has played it, its link is his alone: anyone else who opens it is told to wait, so that nobody learns
  // the answers of a rated duel first (not even Bo in another window).
  const sent = (await (await a.request.get("/api/duels")).json()).duels as { challenge?: string }[];
  const other = await (await browser.newContext()).newPage();
  await other.goto(`/c/${sent[0]?.challenge}`);
  await expect(other.getByRole("heading", { name: "Още не е твой ред" })).toBeVisible();
  await other.context().close();
  await b.goto("/");
  const notice = b.locator(".challenge-notice");
  await expect(notice).toContainText("те предизвика");
  await notice.getByRole("button", { name: "Играй" }).click();
  // Named already, as he asked Ana: no sheet now.
  await expect(b.locator(".question-head .versus")).toHaveText(/^Дуел (с|със) \S/);
  await playRun(b);
  await expect(b.locator(".challenge-notice")).toHaveCount(0);
  await expect(b.getByRole("heading", { name: /Победа|Загуба|Равенство/ })).toBeVisible({ timeout: 10_000 });
  await expect(b.locator(".duel-head .kicker")).toHaveText(/^Предизвикателство от \S/);
  // The duel question by question, both rows; the first rated duel moves the rating, said with how far its setting has
  // come (no division yet); and the record between the two, this duel in it.
  await expect(b.locator(".duel-marks .duel-pip:is(.right, .partial, .wrong)")).toHaveCount(20);
  await expect(b.locator(".duel-face .duel-points")).toHaveCount(2);
  const state = (await b.locator(".duel-verdict").textContent()) ?? "";
  if (state !== "Равенство") await expect(b.locator(".duel-rating-line")).toContainText(/ \d+ → \d+ · /);
  await expect(b.locator(".duel-record")).toContainText(/^Срещу .+\d+\s:\s\d+/);
  // Played: the notice doesn't come back on the way out (no reload), nor its dot on Начало.
  await b.locator('nav.tabs a[href="/"]').click();
  await expect(b.locator("nav.tabs a.news")).toHaveCount(0);
  await expect(b.locator(".challenge-notice")).toHaveCount(0);
  // Bo has played it, and Ana hears of it on Начало, once, above the day: how it ended, a tap from the result.
  await a.goto("/");
  const played = a.locator(".streak-notice", { hasText: "изигра предизвикателството ти" });
  await expect(played).toContainText(
    /изигра предизвикателството ти: (ти печелиш|победата е за .+|равенство), [\d\s]+\s:\s[\d\s]+\./,
  );
  await played.getByRole("link", { name: "Виж" }).click();
  await expect(a.getByRole("heading", { name: /Победа|Загуба|Равенство/ })).toBeVisible();
  await expect(a.locator(".duel-head .kicker")).toHaveText(/^Предизвикателство към \S/);
  await expect(a.locator(".duel-face .duel-points")).toHaveCount(2);
  // Her way on is to challenge Bo back.
  await expect(a.getByRole("button", { name: "Предизвикай отново" })).toHaveClass(/primary/);
  await a.goto("/");
  await expect(a.locator(".day")).toBeVisible();
  await expect(played).toHaveCount(0);
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
  await startDay(a);
  await playRun(a);
  await playedFair(a);
  await expect(a.getByRole("link", { name: /^Покани приятел и сравнявайте резултатите си всеки ден/ })).toBeVisible();

  // Her link (the one her shared result ends with) brings Cy to the day, with her score; Cy adds her before playing,
  // and the day's ten stay the gold action. Начало then names her, without her score.
  const ana = await a.evaluate(async () => (await (await fetch("/api/me")).json()).user.name as string);
  const right = Number(await a.locator(".score-n").textContent());
  await a.goto("/friends");
  const link = (await a.locator("[data-invite]").first().getAttribute("data-invite")) ?? "";
  const c = await (await browser.newContext()).newPage();
  await c.goto(link);
  await expect(c.getByRole("heading", { name: `${ana} има ${right} от 10 днес. А ти?` })).toBeVisible();
  await c.getByRole("button", { name: `Добави ${ana} в приятели` }).click();
  await meetAs(c);
  await expect(c.getByText(`Поканата е изпратена. Щом ${ana} я приеме, ставате приятели.`)).toBeVisible();
  await expect(c.getByRole("button", { name: "Играй въпросите на деня" })).toHaveClass(/primary/);
  await a.reload();
  await a.locator(".invitation").getByRole("button", { name: "Приеми" }).click();
  await expect(a.locator(".friend")).toHaveCount(1);
  await c.goto("/");
  await expect(c.locator(".day-meta").last()).toHaveText(`${ana} вече изигра днешните въпроси.`);

  // Bo plays the day right there: its result as on Начало (tomorrow, „Сподели“, one gold action: game/gold.ts), and
  // one card more, the two results side by side and Ana a tap from being his friend, never by itself.
  await b.goto(link);
  await b.getByRole("button", { name: "Играй въпросите на деня" }).click();
  await playRun(b);
  await expect(b.locator(".tomorrow")).toBeVisible();
  await expect(b.getByRole("button", { name: "Сподели" })).toBeVisible();
  await expect(b.locator(".summary .btn.primary")).toHaveCount(1);
  const card = b.locator(".invite-card");
  await expect(card.locator(".invite-both")).toHaveText(
    new RegExp(`^Ти: \\d+\\sот\\s10 · ${ana}: ${right}\\sот\\s10$`),
  );
  await card.getByRole("button", { name: `Добави ${ana} в приятели` }).click();
  await meetAs(b);
  await expect(card.getByText(`Поканата е изпратена. Щом ${ana} я приеме, ставате приятели.`)).toBeVisible();
  await a.reload();
  await a.locator(".invitation").getByRole("button", { name: "Приеми" }).click();
  await expect(a.locator(".friend")).toHaveCount(2);

  // Then, on Начало: both on the friends' day, his own row marked, each with how their ten went.
  await b.goto("/");
  const friends = b.locator(".board", { has: b.getByRole("heading", { name: "Приятелите ти днес" }) });
  await expect(friends.locator(".row")).toHaveCount(2);
  await expect(friends.locator(".row.me .you")).toHaveText("ти");
  await expect(friends.locator(".row").filter({ hasText: ana }).locator(".pts")).toHaveText(/^\d+ от 10$/);
  await expect(friends.locator(".row .trail li")).toHaveCount(20);
});

test("a challenge back from a friend's result", async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await befriendByLink(a, b);
  await a.locator(".friend").getByRole("button", { name: "Предизвикай" }).click();
  await meetAs(a);
  await playRun(a);
  await b.goto("/");
  await b.locator(".challenge-notice").getByRole("button", { name: "Играй" }).click();
  await playRun(b); // asked for his name already, as he asked Ana to be friends
  await expect(b.getByRole("heading", { name: /Победа|Загуба|Равенство/ })).toBeVisible({ timeout: 10_000 });

  // The gold button challenges Ana back; the way back to the duels is plain.
  const rematch = b.getByRole("button", { name: "Предизвикай отново" });
  await expect(rematch).toHaveClass(/primary/);
  await expect(b.getByRole("link", { name: "Към дуелите" })).not.toHaveClass(/primary/);
  // Bo plays his side of the new challenge at once, on its own screen; Ana is challenged once he has.
  await rematch.click();
  await expect(b.locator(".question-head .versus")).toHaveText(/^Дуел (с|със) \S/);
  await expect(b).toHaveURL(/\/duel\/\d+$/);
  await playRun(b);
  await expect(b.getByRole("heading", { name: "Твоите десет са изиграни" })).toBeVisible({ timeout: 10_000 });
  await a.goto("/");
  await expect(a.locator(".challenge-notice")).toContainText("те предизвика");
});

test("a friend can turn a challenge down", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await befriendByLink(a, b);
  await a.locator(".friend").getByRole("button", { name: "Предизвикай" }).click();
  await meetAs(a);
  await playRun(a);
  // From its own screen…
  await b.goto("/duel");
  await b.locator(".duel-row.s-play").click();
  await b.getByRole("button", { name: "Откажи" }).click();
  await expect(b.getByRole("heading", { name: "Предизвикателството е отказано" })).toBeVisible();
  // …or from the notice, wherever Bo is.
  await a.goto("/friends");
  await a.locator(".friend").getByRole("button", { name: "Предизвикай" }).click();
  await playRun(a);
  await b.goto("/");
  await b.locator(".challenge-notice").getByRole("button", { name: "Откажи" }).click();
  await expect(b.locator(".challenge-notice")).toHaveCount(0);
  await a.goto("/duel");
  await expect(a.locator(".duel-row").first()).toContainText("Отказано");
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
});

test("a block keeps someone away; a new link leaves the old one nobody's", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto("/friends");
  await a.locator(".friends").getByRole("button", { name: "Покани приятел" }).click();
  const link = (await a.locator("[data-invite]").first().getAttribute("data-invite")) ?? "";
  const ask = async (first = false) => {
    await b.goto(link);
    await b.getByRole("button", { name: /^Добави .+ в приятели$/ }).click();
    if (first) await meetAs(b); // his name, the first time only
    await expect(b.getByText(/^Поканата е изпратена\./)).toBeVisible();
  };
  await ask(true);

  // Ana blocks Bo from his request: it's gone, and he's on her list of the blocked.
  await a.reload();
  await a.locator(".invitation").getByRole("button", { name: "Блокирай" }).click();
  await expect(a.locator(".invitation")).toHaveCount(0);
  const blocked = a.locator(".stack", { has: a.getByText("Блокирани", { exact: true }) });
  await expect(blocked.locator("li")).toHaveCount(1);
  // Bo asks again: he's told it went, as anyone is; nothing reaches Ana.
  await ask();
  await a.reload();
  await expect(a.locator(".invitation")).toHaveCount(0);
  // Lifted from her list.
  await blocked.getByRole("button", { name: "Отблокирай" }).click();
  await expect(a.getByText("Блокирани", { exact: true })).toHaveCount(0);

  // A new link, asked once more first: the old one is nobody's.
  await a.getByRole("button", { name: "Нова връзка за покана" }).click();
  await a.getByRole("button", { name: "Направи нова" }).click();
  await expect(a.locator("[data-invite]").first()).not.toHaveAttribute("data-invite", link);
  await b.goto(link);
  await expect(b.getByRole("heading", { name: "Тази покана я няма" })).toBeVisible();
});

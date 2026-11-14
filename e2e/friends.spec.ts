import { expect, test } from "@playwright/test";
import { playRun } from "./play.ts";

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
  await b.getByRole("button", { name: "Приеми" }).click();
  await expect(b.getByRole("heading", { name: /Вече сте приятели/ })).toBeVisible();
  await a.reload();
  await expect(a.locator(".friend")).toHaveCount(1);

  // Ana challenges Bo and plays hers now; once she has, Bo is told wherever he is, and plays from there.
  await a.locator(".friend").getByRole("button", { name: "Дуел" }).click();
  await playRun(a);
  await expect(a.getByRole("heading", { name: "Изигра своя дуел" })).toBeVisible({ timeout: 10_000 });
  await b.goto("/");
  const notice = b.locator(".challenge-notice");
  await expect(notice).toContainText("те предизвика на дуел");
  await notice.getByRole("button", { name: "Играй" }).click();
  await playRun(b);
  await expect(b.locator(".challenge-notice")).toHaveCount(0);
  await expect(b.getByRole("heading", { name: /Победа|Загуба|Равенство/ })).toBeVisible({ timeout: 10_000 });
  await a.goto("/duel");
  await expect(a.locator(".duel-row").first()).toContainText(/Победа|Загуба|Равенство/);

  // The duel counts in their record.
  await a.goto("/friends");
  await expect(a.locator(".friend .record")).toBeVisible();
});

test("a friend can turn a duel down", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto("/friends");
  await a.locator(".friends").getByRole("button", { name: "Покани приятел" }).click();
  const link = await a.locator(".invite-link").getAttribute("href");
  await b.goto(link ?? "");
  await b.getByRole("button", { name: "Приеми" }).click();
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

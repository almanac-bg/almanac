import { expect, type Page, test } from "@playwright/test";
import { openGame, playRun, startDay } from "./play.ts";

// A player's invite link: sent from Приятели by the phone's share sheet, or copied on a big screen („Добави ме в
// АЛМАНАХ: <link>“); opened by a stranger, it's the day's cover with the invite over it, the address the link's until
// it's answered; a tap before any game waits for the first one, and as it ends the two are friends, each in the
// other's Приятели. One who has played already is a friend at once.
test("an invite link: sent, opened by a stranger, the day played, and friends both ways", async ({ browser }) => {
  test.setTimeout(180_000);
  const ana = await (await browser.newContext()).newPage();
  // The share sheet (a phone's) and the clipboard (a big screen's) stood in for: what either was given.
  await ana.addInitScript(() => {
    const w = window as unknown as { sent: string[] };
    w.sent = [];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (d: ShareData) => void w.sent.push(d.text ?? ""),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void w.sent.push(text) },
    });
  });
  await ana.goto("/");
  await startDay(ana);
  await playRun(ana);
  const name = await ana.evaluate(async () => (await (await fetch("/api/me")).json()).user.name as string);

  await ana.goto("/friends");
  await ana.getByRole("button", { name: "Покани приятел" }).click();
  await expect
    .poll(() => ana.evaluate(() => (window as unknown as { sent: string[] }).sent))
    .toEqual([expect.stringMatching(/^Добави ме в АЛМАНАХ: https?:\/\/\S+\/f\/[a-z2-9]{10}$/)]);
  const [text] = await ana.evaluate(() => (window as unknown as { sent: string[] }).sent);
  const link = new URL(text.slice(text.indexOf("http"))).pathname;

  // Bo, a stranger: the day's cover, the invite over it, and the address still the link's (an app's browser opens it
  // in the phone's as it is).
  const bo = await (await browser.newContext()).newPage();
  await bo.goto(link);
  await expect(bo.locator("html")).toHaveClass(/cover/);
  await expect(bo).toHaveURL(new RegExp(`${link}$`));
  const card = bo.locator(".invite-card");
  await expect(card).toContainText(name);
  await expect(card).toContainText("те кани да сте приятели в АЛМАНАХ.");
  await expect(bo.locator(".issue")).toBeVisible();
  // A tap before his first game: the add waits for it.
  await card.getByRole("button", { name: "Добави като приятел" }).click();
  await expect(card).toContainText("Първо изиграй днешния брой.");
  await expect(card.getByRole("button", { name: "Добави като приятел" })).toHaveCount(0);
  await expect(bo).toHaveURL(new RegExp(`${link}$`));

  // He plays the day: as it ends, friends, said over the result.
  await startDay(bo);
  await playRun(bo);
  await expect(bo.locator(".notice").filter({ hasText: /^Вече сте приятели (с|със) / })).toContainText(name);
  // Answered, the address is Днес's.
  await expect(bo).toHaveURL(/\/$/);
  await bo.goto("/friends");
  await expect(bo.locator(".friend-list .friend")).toHaveCount(1);
  await expect(bo.locator(".friend-list .friend")).toContainText(name);

  // Ana has him in hers, told once that he said yes.
  const his = await bo.evaluate(async () => (await (await fetch("/api/me")).json()).user.name as string);
  await ana.goto("/friends");
  await expect(ana.locator(".accepted-notice")).toContainText(his);
  await expect(ana.locator(".friend-list .friend")).toContainText(his);

  // Opened again by him, the link says they're friends; a new link ends the old one.
  await bo.goto(link);
  await expect(bo.locator(".invite-card")).toContainText("Вече сте приятели");
  await ana.getByRole("button", { name: "Нова връзка" }).click();
  await ana.getByRole("button", { name: "Направи нова" }).click();
  await expect(ana.getByText("Готово. Старата връзка вече не работи.")).toBeVisible();
  await bo.goto(link);
  await expect(bo.getByText("Тази връзка вече не важи. Поискай нова.")).toBeVisible();

  // Cy has played already: one tap, and they're friends at once.
  const fresh = new URL(
    await ana.evaluate(async () => (await (await fetch("/api/invite", { method: "POST" })).json()).url as string),
  ).pathname;
  const cy = await (await browser.newContext()).newPage();
  await cy.goto("/");
  await startDay(cy);
  await playRun(cy);
  await cy.goto(fresh);
  const theirs = cy.locator(".invite-card");
  await expect(theirs).toContainText(name);
  await theirs.getByRole("button", { name: "Добави като приятел" }).click();
  await expect(theirs).toContainText("Вече сте приятели");
  await expect(cy).toHaveURL(/\/$/);
  await cy.goto("/friends");
  await expect(cy.locator(".friend-list .friend")).toContainText(name);
});

// A tap kept for the first game outlasts the server down for a moment as that game ends: kept on the device, and
// taken as the page is opened again. A profile deleted takes its kept tap with it.
test("a kept tap: kept through a server error at the game's end and taken on a reload, gone with the profile", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ana = await (await browser.newContext()).newPage();
  await ana.goto("/");
  await startDay(ana);
  await playRun(ana);
  const name = await ana.evaluate(async () => (await (await fetch("/api/me")).json()).user.name as string);
  const link = new URL(
    await ana.evaluate(async () => (await (await fetch("/api/invite", { method: "POST" })).json()).url as string),
  ).pathname;
  const code = link.slice("/f/".length);
  const kept = (p: Page) => p.evaluate(() => localStorage.getItem("almanac.invite"));

  // Bo taps before his first game; as it ends the server is down for a moment.
  const bo = await (await browser.newContext()).newPage();
  await bo.route(`**/api/invites/${code}`, (r) =>
    r.request().method() === "POST"
      ? r.fulfill({ status: 503, json: { error: "busy", message: "Сървърът е зает. Опитай пак." } })
      : r.continue(),
  );
  await bo.goto(link);
  await bo.locator(".invite-card").getByRole("button", { name: "Добави като приятел" }).click();
  await expect(bo.locator(".invite-card")).toContainText("Първо изиграй днешния брой.");
  expect(await kept(bo)).toContain(code);
  await startDay(bo);
  await playRun(bo);
  await expect(bo.locator(".notice").filter({ hasText: "Сървърът е зает." })).toBeVisible();
  expect(await kept(bo)).toContain(code);
  await expect(bo).toHaveURL(new RegExp(`${link}$`));
  // The server back, the page opened again: friends, said over the result, not the invite again.
  await bo.unroute(`**/api/invites/${code}`);
  await bo.reload();
  await expect(bo.locator(".notice").filter({ hasText: /^Вече сте приятели (с|със) / })).toContainText(name);
  await expect(bo.locator(".invite-card")).toHaveCount(0);
  await expect(bo).toHaveURL(/\/$/);
  expect(await kept(bo)).toBeNull();

  // Cy has a profile, but no game finished: the tap waits for it; her profile deleted, it goes with it.
  const cy = await (await browser.newContext()).newPage();
  await openGame(cy, "/play/music");
  await expect(cy.locator(".question-head")).toContainText("1 от 10");
  await cy.goto(link);
  await cy.locator(".invite-card").getByRole("button", { name: "Добави като приятел" }).click();
  await expect(cy.locator(".invite-card")).toContainText("Първо изиграй днешния брой.");
  expect(await kept(cy)).toContain(code);
  await cy.goto("/settings");
  await cy.getByRole("button", { name: "Изтрий профила" }).click();
  await cy.getByRole("button", { name: "Изтрий профила" }).click();
  await expect(cy.getByRole("status").filter({ hasText: "Профилът е изтрит." })).toBeVisible();
  expect(await kept(cy)).toBeNull();
});

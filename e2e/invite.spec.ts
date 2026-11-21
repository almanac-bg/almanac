import { expect, test } from "@playwright/test";
import { playRun, startDay } from "./play.ts";

// A player's invite link: sent from Приятели by the phone's share sheet („Добави ме в АЛМАНАХ: <link>“); opened by a
// stranger, it's the day's cover with the invite over it; a tap before any game waits for the first one, and as it
// ends the two are friends, each in the other's Приятели.
test("an invite link: sent, opened by a stranger, the day played, and friends both ways", async ({ browser }) => {
  test.setTimeout(180_000);
  const ana = await (await browser.newContext()).newPage();
  // The share sheet stood in for: what it was given.
  await ana.addInitScript(() => {
    const w = window as unknown as { sent: string[] };
    w.sent = [];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (d: ShareData) => void w.sent.push(d.text ?? ""),
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

  // Bo, a stranger: the day's cover, the invite over it, and the address Днес's.
  const bo = await (await browser.newContext()).newPage();
  await bo.goto(link);
  await expect(bo).toHaveURL(/\/$/);
  await expect(bo.locator("html")).toHaveClass(/cover/);
  const card = bo.locator(".invite-card");
  await expect(card).toContainText(name);
  await expect(card).toContainText("те кани да сте приятели в АЛМАНАХ.");
  await expect(bo.locator(".issue")).toBeVisible();
  // A tap before his first game: the add waits for it.
  await card.getByRole("button", { name: "Добави като приятел" }).click();
  await expect(card).toContainText("Първо изиграй днешния брой.");
  await expect(card.getByRole("button", { name: "Добави като приятел" })).toHaveCount(0);

  // He plays the day: as it ends, friends, said over the result.
  await startDay(bo);
  await playRun(bo);
  await expect(bo.locator(".notice").filter({ hasText: /^Вече сте приятели (с|със) / })).toContainText(name);
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
  await expect(bo.getByText("Тази покана вече не важи. Поискай нова връзка.")).toBeVisible();
});

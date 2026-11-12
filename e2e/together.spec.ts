import { expect, type Page, test } from "@playwright/test";
import { answer } from "./play.ts";

test("a room for two: lobby, ten questions together, the standings", async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await host.goto("/together");
  await host.getByRole("button", { name: "История" }).click();
  await expect(host).toHaveURL(/\/r\/\d{6}$/);
  const code = host.url().slice(-6);
  await guest.goto("/together");
  await guest.getByLabel("Код на стаята").fill(code);
  await guest.getByRole("button", { name: "Влез" }).click();
  await expect(host.locator(".players li")).toHaveCount(2);
  await expect(guest.getByText(/Чакаме .* да започне/)).toBeVisible();
  await host.getByRole("button", { name: "Започни" }).click();
  for (let n = 0; n < 10; n++) {
    for (const p of [host, guest]) await expect(p.locator(".question-head")).toContainText(`${n + 1} от 10`);
    await answer(host);
    await answer(guest);
    for (const p of [host, guest]) await expect(p.locator(".verdict")).toBeVisible();
    await host.getByRole("button", { name: n < 9 ? "Напред" : "Към класирането" }).click();
  }
  for (const p of [host, guest]) await expect(p.getByRole("heading", { name: /печели/ })).toBeVisible();
  await expect(host.getByRole("button", { name: "Нова игра" })).toBeVisible();
});

test("two people asking for a duel play each other", async ({ browser }, info) => {
  // Matching is the server's, the same for every engine; and duels in two engines at once would match across them.
  test.skip(info.project.name !== "chromium", "one engine is enough");
  test.setTimeout(150_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const find = async (p: Page) => {
    await p.goto("/together");
    await p.getByRole("button", { name: "Намери съперник" }).click();
  };
  await Promise.all([find(a), find(b)]);
  for (const p of [a, b]) await expect(p).toHaveURL(/\/r\/\d{6}$/, { timeout: 20_000 });
  expect(a.url()).toBe(b.url());
  for (let n = 0; n < 10; n++) {
    for (const p of [a, b])
      await expect(p.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 20_000 });
    await answer(a);
    await answer(b);
    for (const p of [a, b]) await expect(p.locator(".verdict")).toBeVisible();
  }
  for (const p of [a, b])
    await expect(p.getByRole("heading", { name: /Победа|Загуба|Равенство/ })).toBeVisible({ timeout: 20_000 });
});

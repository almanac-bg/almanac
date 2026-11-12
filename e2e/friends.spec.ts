import { expect, test } from "@playwright/test";
import { answer } from "./play.ts";

test("friends: an invite link, then a duel between the two", async ({ browser }) => {
  test.setTimeout(150_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // Ana's link: a player is made for her the first time she asks for it.
  await a.goto("/together");
  await a.locator(".friends").getByRole("button", { name: "Покани приятел" }).click();
  const link = await a.locator(".invite-link").getAttribute("href");
  expect(link).toMatch(/^\/f\/[a-z0-9]{8}$/);

  // Bo opens it and accepts: they're friends, both ways.
  await b.goto(link ?? "");
  await expect(b.getByRole("heading", { name: /те кани за приятел/ })).toBeVisible();
  await b.getByRole("button", { name: "Приеми" }).click();
  await expect(b.getByRole("heading", { name: /Вече сте приятели/ })).toBeVisible();
  await a.reload();
  await expect(a.locator(".friend")).toHaveCount(1);

  // Ana asks Bo to a duel; Bo finds the invitation in Заедно, accepts, and they play.
  await a.locator(".friend").getByRole("button", { name: "Дуел" }).click();
  await expect(a.getByRole("heading", { name: /^Дуел с / })).toBeVisible();
  await b.goto("/together");
  await b.locator(".invitation").getByRole("link", { name: "Приеми" }).click();
  for (let n = 0; n < 10; n++) {
    for (const p of [a, b])
      await expect(p.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 20_000 });
    await answer(a);
    await answer(b);
    for (const p of [a, b]) await expect(p.locator(".verdict")).toBeVisible();
  }
  for (const p of [a, b])
    await expect(p.getByRole("heading", { name: /Победа|Загуба|Равенство/ })).toBeVisible({ timeout: 20_000 });

  // The duel counts in their record.
  await a.goto("/together");
  await expect(a.locator(".friend .record")).toBeVisible();
});

test("a friend can turn a duel down", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto("/together");
  await a.locator(".friends").getByRole("button", { name: "Покани приятел" }).click();
  const link = await a.locator(".invite-link").getAttribute("href");
  await b.goto(link ?? "");
  await b.getByRole("button", { name: "Приеми" }).click();
  await expect(b.getByRole("heading", { name: /Вече сте приятели/ })).toBeVisible();
  await a.reload();
  await a.locator(".friend").getByRole("button", { name: "Дуел" }).click();
  await expect(a.getByRole("heading", { name: /^Дуел с / })).toBeVisible();
  await b.goto("/together");
  await b.locator(".invitation").getByRole("button", { name: "Откажи" }).click();
  await expect(a.getByRole("heading", { name: "Не може сега" })).toBeVisible();
  await expect(a.getByRole("link", { name: "Предизвикай" })).toBeVisible();
});

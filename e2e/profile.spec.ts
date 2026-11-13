import { expect, test } from "@playwright/test";
import { playRun } from "./play.ts";

test("a player's profile: from a board, asked to be friends, then a duel from it", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // Ana plays a topic: she's on this week's board.
  await a.goto("/play");
  await a.getByRole("link", { name: "История" }).click();
  await playRun(a);
  const ana = await a.evaluate(
    async () => (await (await fetch("/api/me")).json()).user as { name: string; tag: string },
  );

  // Bo finds her there and opens her profile.
  await b.goto("/ranks");
  await b.getByRole("tab", { name: "Седмица" }).click();
  await b.locator(`.board a.who[href="/players/${ana.tag}"]`).first().click();
  await expect(b.getByRole("heading", { level: 1, name: ana.name })).toBeVisible();
  await expect(b.locator(".me-tag")).toHaveText(`@${ana.tag}`);
  await expect(b.locator(".stats")).toContainText("изиграна игра");
  await expect(b.getByRole("heading", { name: "Колко знае" })).toBeVisible();

  // He asks to be friends; she sees it on his profile and accepts there.
  await b.getByRole("button", { name: "Добави приятел" }).click();
  await expect(b.getByText("Поканата за приятелство чака отговор.")).toBeVisible();
  const bo = await b.evaluate(
    async () => (await (await fetch("/api/me")).json()).user as { name: string; tag: string },
  );
  await a.goto("/friends");
  await a.locator(".invitation").getByRole("link", { name: bo.name }).click();
  await expect(a.getByText(`${bo.name} иска да сте приятели.`)).toBeVisible();
  await a.getByRole("button", { name: "Приеми" }).click();
  await expect(a.getByText("Приятели сте.")).toBeVisible();

  // Friends now: a duel from her profile.
  await b.reload();
  await b.locator(".player-actions").getByRole("button", { name: "Дуел" }).click();
  await expect(b.locator("article.question")).toBeVisible();

  // Her own profile, as others see it, says so.
  await a.goto(`/players/${ana.tag}`);
  await expect(a.getByText("Така те виждат другите.")).toBeVisible();
  await a.goto("/players/nosuchplayer");
  await expect(a.getByRole("heading", { name: "Няма такъв профил" })).toBeVisible();
});

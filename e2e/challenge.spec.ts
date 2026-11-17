import { expect, type Page, test } from "@playwright/test";
import { openGame, playRun } from "./play.ts";

/** What the page shares, kept instead of the phone's sheet. */
async function catchShares(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (d: ShareData) => {
        (window as unknown as { shared: ShareData }).shared = d;
      },
    });
  });
}

const shared = (page: Page) => page.evaluate(() => (window as unknown as { shared?: ShareData }).shared ?? null);

test("a challenge: one link, a stranger plays it as a guest, both see the two side by side", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await (await browser.newContext()).newPage();
  await catchShares(a);

  // Ana plays a topic's ten, and sends the game as a challenge: plain text with her score, and the link.
  await openGame(a, "/play/history");
  await playRun(a);
  await a.getByRole("button", { name: "Предизвикай" }).click();
  // What a challenge says carries the name: one still drawn is asked first (kept as it is here).
  await a
    .getByRole("dialog", { name: "Как да те познаят приятелите?" })
    .getByRole("button", { name: "Сподели" })
    .click();
  await expect.poll(() => shared(a)).not.toBeNull();
  const share = await shared(a);
  expect(share?.text).toMatch(/^Познах \d+ от 10 по „История“ в АЛМАНАХ\. Можеш ли повече\?$/);
  const path = new URL(share?.url ?? "").pathname;
  expect(path).toMatch(/^\/c\/[a-z0-9]{8}$/);

  // Bo, never here before, opens it: who and how they did, and the count only after his tap.
  const b = await (await browser.newContext()).newPage();
  await catchShares(b);
  await b.goto(path);
  await expect(b.getByRole("heading", { name: /те предизвиква$/ })).toBeVisible();
  await expect(b.locator(".lead")).toContainText(/позна \d+ от 10 по „История“/);
  await expect(b.getByRole("heading", { name: "Приготви се" })).toHaveCount(0);
  await b.getByRole("button", { name: "Започни", exact: true }).click();
  await b.getByRole("button", { name: "Започни сега" }).click();
  await playRun(b);
  await expect(b.getByRole("heading", { name: /Победа|Загуба|Равенство/ })).toBeVisible({ timeout: 10_000 });
  await expect(b.locator(".duel-head .kicker")).toHaveText(/^Предизвикателство от \S/);
  await expect(b.locator(".duel-face .duel-points")).toHaveCount(2);
  await expect(b.locator(".duel-meant .duel-rating")).toHaveCount(0); // no rating moves
  // Ana a tap away as a friend; and the challenge, sent on with his own game, gold.
  await b
    .locator(".duel-add")
    .getByRole("button", { name: /^Добави .+ в приятели$/ })
    .click();
  await expect(b.locator(".duel-add")).toHaveText("Поканата е изпратена.");
  await expect(b.getByRole("button", { name: "Предизвикай и ти" })).toHaveClass(/primary/);
  await b.getByRole("button", { name: "Предизвикай и ти" }).click();
  await b
    .getByRole("dialog", { name: "Как да те познаят приятелите?" })
    .getByRole("button", { name: "Сподели" })
    .click();
  await expect.poll(async () => (await shared(b))?.url ?? "").toMatch(/\/c\/[a-z0-9]{8}$/);
  expect(new URL((await shared(b))?.url ?? "").pathname).not.toBe(path);

  // Opened again, it's his result, not a second game.
  await b.goto(path);
  await expect(b).toHaveURL(/\/duel\/\d+$/);
  await expect(b.getByRole("heading", { name: /Победа|Загуба|Равенство/ })).toBeVisible();

  // Ana's own link shows who took it; Начало tells her once.
  await a.goto(path);
  await expect(a.getByRole("heading", { name: /^\d+ от 10 по „История“$/ })).toBeVisible();
  await expect(a.locator(".duel-row")).toHaveCount(1);
  await a.goto("/");
  const line = a.locator(".streak-notice", { hasText: "изигра предизвикателството ти" });
  await expect(line.getByRole("link", { name: "Виж" })).toHaveAttribute("href", path);
  await a.reload();
  await expect(a.locator(".day")).toBeVisible();
  await expect(line).toHaveCount(0);
});

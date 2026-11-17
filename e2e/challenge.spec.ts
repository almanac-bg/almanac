import { expect, type Page, test } from "@playwright/test";
import { answer, moveOn, openGame, playRun } from "./play.ts";

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

test("a challenge: made on Дуел, one link, a stranger plays it as a guest, both see the two side by side", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const a = await (await browser.newContext()).newPage();
  await catchShares(a);

  // Ana makes one on Дуел: a topic, its ten, and then (no friends yet) the link is the gold way: plain text with her
  // score, and the link.
  await a.goto("/duel");
  await a.getByRole("link", { name: "Предизвикай" }).click();
  await expect(a).toHaveURL(/\/challenge$/);
  await a.locator(".challenge-topics").getByRole("link", { name: "История" }).click();
  await expect(a.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await a.getByRole("button", { name: "Започни сега" }).click();
  await playRun(a);
  await expect(a.getByRole("button", { name: "Прати" })).toHaveClass(/primary/);
  await a.getByRole("button", { name: "Прати" }).click();
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
  // The page, its address now the duel's, is still the first in the history (back from it leaves, as it should).
  await expect.poll(() => b.evaluate(() => history.state?.i)).toBe(0);
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

test("a challenge left half-way, its link opened again from outside, waits for „Продължи“", async ({ browser }) => {
  test.setTimeout(150_000);
  const a = await (await browser.newContext()).newPage();
  await catchShares(a);
  await openGame(a, "/play/history");
  await playRun(a);
  await a.getByRole("button", { name: "Предизвикай" }).click();
  await a
    .getByRole("dialog", { name: "Как да те познаят приятелите?" })
    .getByRole("button", { name: "Не сега" })
    .click();
  await expect.poll(() => shared(a)).not.toBeNull();
  const path = new URL((await shared(a))?.url ?? "").pathname;

  // Bo plays its first question, and leaves it at the second.
  const bo = await browser.newContext();
  const b = await bo.newPage();
  await b.goto(path);
  await b.getByRole("button", { name: "Започни", exact: true }).click();
  await b.getByRole("button", { name: "Започни сега" }).click();
  await expect(b.locator(".question-head")).toContainText("1 от 10");
  await answer(b);
  await moveOn(b);
  await expect(b.locator(".question-head")).toContainText("2 от 10", { timeout: 10_000 });
  // The link again, in another tab: the duel it is now, waiting for a tap, its time not running in sight.
  const again = await bo.newPage();
  await again.goto(path);
  await expect(again).toHaveURL(/\/duel\/\d+$/);
  await expect(again.getByRole("button", { name: "Продължи" })).toBeVisible();
  await expect(again.locator(".question-head")).toHaveCount(0);
  await a.context().close();
  await bo.close();
});

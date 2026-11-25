import { expect, type Page, test } from "@playwright/test";
import { dayAs, daysPlayed, mailedCode, playRun, startDay } from "./play.ts";

/** What the page sent to the share sheet and to the clipboard, each stood in for (`sheet`: whether there is a share
 * sheet at all). */
async function standIn(page: Page, sheet: boolean): Promise<void> {
  await page.addInitScript((sheet) => {
    const w = window as unknown as { sent: string[]; copied: string[] };
    w.sent = [];
    w.copied = [];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: sheet ? async (d: ShareData) => void w.sent.push(d.text ?? "") : undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void w.copied.push(t) },
    });
  }, sheet);
}

const shape = /^АЛМАНАХ · Брой \d+ · (\d+)\/10( · \d+ дни)?\n[■◩□]{10}\nhttps?:\/\/\S+(\/d\/\d+-[a-z2-9]{8})$/;

test("the day shared: its score and shape and a link, which brings another to the same ten", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await standIn(page, true);
  await page.goto("/");
  // Not the first day (whose result's action is keeping the game): its action is sharing it.
  await daysPlayed(page, 1);
  await page.reload();
  await startDay(page);
  await playRun(page);
  // The sheet: the server's card (the link's preview), the text, and the ways to send it.
  await page.getByRole("button", { name: "Сподели", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Сподели резултата" });
  const card = sheet.locator(".share-card");
  await expect(card).toHaveAttribute("src", /^\/card\/\d+-[0-3]{10}\.png\?v=[^&]+$/);
  await expect.poll(() => card.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1200);
  await expect(sheet.locator(".share-text")).toContainText("/10");
  await sheet.getByRole("button", { name: "Сподели", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { sent: string[] }).sent.length)).toBe(1);
  await expect(sheet).toBeHidden();
  const text = await page.evaluate(() => (window as unknown as { sent: string[] }).sent[0] ?? "");
  const m = text.match(shape);
  expect(m, text).not.toBeNull();
  const [, rights = "", , link = ""] = m ?? [];
  // The day's result says the same score.
  await expect(page.locator(".score-n")).toHaveText(rights);

  // Whoever opens the link: Днес, the score shared and its shape over the same ten, and no name.
  const other = await browser.newContext({ ...test.info().project.use, baseURL: test.info().project.use.baseURL });
  const visitor = await other.newPage();
  await visitor.goto(link);
  await expect(visitor).toHaveURL(/\/$/);
  await expect(visitor.getByRole("heading", { name: `Някой позна ${rights} от 10. А ти?` })).toBeVisible();
  await expect(visitor.locator(".shared-score .tile")).toHaveCount(10);
  await expect(visitor.locator(".shared-score .tile.right")).toHaveCount(Number(rights));
  await startDay(visitor);
  await expect(visitor.locator(".question-head")).toContainText("1 от 10");
  // Played: the score shared stays on the result, beside the visitor's own.
  await playRun(visitor);
  await expect(visitor.locator(".score-leaf")).toContainText(`По връзката: ${rights} от 10`);
  // With no friends yet, the board's Приятели asks whoever sent the link, and names nobody.
  const board = visitor.locator(".day-board");
  await board.getByRole("tab", { name: "Приятели" }).click();
  await expect(board).toContainText("Още нямаш приятели.");
  await board.getByRole("button", { name: "Покани човека, който ти прати връзката" }).click();
  await expect(board.getByRole("status")).toHaveText(
    "Поканата е изпратена. Ако я приеме, ще се появи в приятелите ти.",
  );
  // Signed in right after to a profile of their own from elsewhere, Днес drawn again as theirs: the request stays sent,
  // not offered again.
  const email = `by-link-${test.info().project.name}-${Date.now()}@example.com`;
  const elsewhere = await browser.newContext({ ...test.info().project.use, baseURL: test.info().project.use.baseURL });
  await elsewhere.request.post("/api/auth/code", { data: { email } });
  await expect.poll(() => mailedCode(email)).not.toBe("");
  await elsewhere.request.post("/api/auth/verify", { data: { email, code: mailedCode(email) } });
  await elsewhere.close();
  const first = mailedCode(email);
  const asks = visitor.locator(".result-share");
  await asks.getByLabel("Имейл").fill(email);
  await asks.getByRole("button", { name: "Напомняй ми по имейл" }).click();
  await expect.poll(() => mailedCode(email)).not.toBe(first);
  await asks.getByLabel("Код").fill(mailedCode(email));
  await asks.getByRole("button", { name: "Потвърди" }).click();
  await expect(visitor.locator(".notice")).toContainText("Влезе като");
  await board.getByRole("tab", { name: "Приятели" }).click();
  await expect(board.getByRole("status")).toHaveText(
    "Поканата е изпратена. Ако я приеме, ще се появи в приятелите ти.",
  );
  await expect(board.getByRole("button", { name: "Покани човека, който ти прати връзката" })).toHaveCount(0);
  await other.close();
  // The one who shared it sees the request, with the link's issue.
  const issue = link.match(/\/d\/(\d+)-/)?.[1] ?? "";
  await page.goto("/friends");
  await expect(page.locator(".invitation")).toContainText(`Иска да сте приятели. По връзката ти от Брой ${issue}.`);
  // Opened by one who had played already: their result, with the score shared on it; their own link asks nobody.
  await page.goto(link);
  await page.locator(".day-board").getByRole("tab", { name: "Приятели" }).click();
  await expect(page.locator(".day-board")).toContainText("Още нямаш приятели.");
  await expect(page.getByRole("button", { name: "Покани човека, който ти прати връзката" })).toHaveCount(0);
  await expect(page.locator(".score-leaf")).toContainText(`По връзката: ${rights} от 10`);
  // Not on a later visit by Днес's own address: nothing of it is kept.
  await page.goto("/");
  await expect(page.locator(".score-n")).toHaveText(rights);
  await expect(page.locator(".score-leaf")).not.toContainText("По връзката");

  // A link that isn't is a page that isn't.
  const missing = await page.goto("/d/1-abcdefgh");
  expect(missing?.status()).toBe(404);
});

test("without a share sheet, the day's text is copied", async ({ page }) => {
  test.setTimeout(120_000);
  await standIn(page, false);
  await page.goto("/");
  await daysPlayed(page, 1);
  await page.reload();
  await startDay(page);
  await playRun(page);
  await page.getByRole("button", { name: "Сподели", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Сподели резултата" });
  // No share sheet on the device: copying is the way, gold.
  await expect(sheet.getByRole("button", { name: "Сподели", exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Копирай текста" }).click();
  await expect(sheet.getByRole("status")).toHaveText("Копирано.");
  const copied = await page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  expect(copied).toHaveLength(1);
  expect(copied[0]).toMatch(shape);
  await sheet.getByRole("button", { name: "Затвори" }).click();
  await expect(sheet).toBeHidden();
  // A later visit: the result again, shared from there too, with the same link.
  await page.reload();
  await expect(page.locator(".result")).toBeVisible();
  await page.getByRole("button", { name: "Сподели", exact: true }).click();
  await page.getByRole("dialog", { name: "Сподели резултата" }).getByRole("button", { name: "Копирай текста" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual(copied);
});

test("a national day: the cover names it under the date, and the share says it after the issue", async ({ page }) => {
  test.setTimeout(120_000);
  // Today made 3 March as the server sends it (bank.NationalName): in the page's boot and in GET /api/day.
  const name = "Освобождението";
  await dayAs(page, (day) => {
    day.national = name;
  });
  await standIn(page, false);
  await page.goto("/");
  // One quiet line under the date, on the issue, and „Започни“ still in sight under it.
  const line = page.locator(".issue .issue-national");
  await expect(line).toHaveText(name);
  await expect(page.getByRole("heading", { name: "Десет въпроса за днес" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Започни" })).toBeInViewport({ ratio: 1 });
  await daysPlayed(page, 1);
  await page.reload();
  await expect(line).toHaveText(name);
  await startDay(page);
  await playRun(page);
  await page.getByRole("button", { name: "Сподели", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Сподели резултата" });
  await sheet.getByRole("button", { name: "Копирай текста" }).click();
  await expect(sheet.getByRole("status")).toHaveText("Копирано.");
  const [copied = ""] = await page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  expect(copied).toMatch(/^АЛМАНАХ · Брой \d+ · \d{1,2} [а-я]+ · Освобождението · \d+\/10\n[■◩□]{10}\n/);
});

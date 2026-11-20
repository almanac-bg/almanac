import { expect, type Page, test } from "@playwright/test";
import { playRun, startDay } from "./play.ts";

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

const shape = /^Алманах, брой \d+ · \d{1,2} [а-я]+\n(\d+) от 10 [■□]{10}\n\S+(\/d\/\d+-[a-z2-9]{8})$/;

test("the day shared: its score and shape and a link, which brings another to the same ten", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await standIn(page, true);
  await page.goto("/");
  await startDay(page);
  await playRun(page);
  await page.getByRole("button", { name: "Сподели резултата" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { sent: string[] }).sent.length)).toBe(1);
  const text = await page.evaluate(() => (window as unknown as { sent: string[] }).sent[0] ?? "");
  const m = text.match(shape);
  expect(m, text).not.toBeNull();
  const [, rights = "", link = ""] = m ?? [];
  // The day's result says the same score.
  await expect(page.locator(".score-n")).toHaveText(rights);

  // Whoever opens the link: Начало, the score shared and its shape over the same ten, and no name.
  const other = await browser.newContext({ ...test.info().project.use, baseURL: test.info().project.use.baseURL });
  const visitor = await other.newPage();
  await visitor.goto(link);
  await expect(visitor).toHaveURL(/\/$/);
  await expect(visitor.getByRole("heading", { name: "Колко ще познаеш ти?" })).toBeVisible();
  await expect(visitor.locator(".shared-score-n")).toHaveText(`${rights} от 10`);
  await expect(visitor.locator(".shared-score .trail li")).toHaveCount(10);
  await expect(visitor.locator(".shared-score .trail li.right")).toHaveCount(Number(rights));
  await startDay(visitor);
  await expect(visitor.locator(".question-head")).toContainText("1 от 10");
  await other.close();

  // A link that isn't is a page that isn't.
  const missing = await page.goto("/d/1-abcdefgh");
  expect(missing?.status()).toBe(404);
});

test("without a share sheet, the day's text is copied", async ({ page }) => {
  test.setTimeout(120_000);
  await standIn(page, false);
  await page.goto("/");
  await startDay(page);
  await playRun(page);
  const button = page.getByRole("button", { name: "Сподели резултата" });
  await button.click();
  await expect(page.getByRole("button", { name: "Копирано" })).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  expect(copied).toHaveLength(1);
  expect(copied[0]).toMatch(shape);
  await expect(button).toBeVisible({ timeout: 5000 }); // back to itself a moment after
  // A later visit: the day in one short card, shared from there too, with the same link.
  await page.reload();
  await expect(page.locator(".day-done")).toBeVisible();
  await page.getByRole("button", { name: "Сподели резултата" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual(copied);
});

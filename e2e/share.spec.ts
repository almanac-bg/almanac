import { expect, type Page, test } from "@playwright/test";
import { daysPlayed, playRun, startDay } from "./play.ts";

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

const shape = /^Брой \d+ · (\d+)\/10( · \d+ дни)?\n[■◧□]{10}\nhttps?:\/\/\S+(\/d\/\d+-[a-z2-9]{8})$/;

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
  // The sheet: the card drawn for it, the text, and the ways to send it.
  await page.getByRole("button", { name: "Сподели", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Сподели резултата" });
  await expect(sheet.locator(".share-card")).toHaveAttribute("src", /^data:image\/png;base64,/);
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

  // Whoever opens the link: Начало, the score shared and its shape over the same ten, and no name.
  const other = await browser.newContext({ ...test.info().project.use, baseURL: test.info().project.use.baseURL });
  const visitor = await other.newPage();
  await visitor.goto(link);
  await expect(visitor).toHaveURL(/\/$/);
  await expect(visitor.getByRole("heading", { name: `Някой позна ${rights} от 10. А ти?` })).toBeVisible();
  await expect(visitor.locator(".shared-score .tile")).toHaveCount(10);
  await expect(visitor.locator(".shared-score .tile.right")).toHaveCount(Number(rights));
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

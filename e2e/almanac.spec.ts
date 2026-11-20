import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { knows } from "./play.ts";

/** Every live question with a fact in the sample bank. */
function sampleFacts(): string[] {
  const dir = resolve(import.meta.dirname, "..", "bank/sample/questions");
  return readdirSync(dir).flatMap((f) =>
    (JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { id: string; fact?: string; retired?: boolean }[])
      .filter((q) => q.fact && !q.retired)
      .map((q) => q.id),
  );
}

test("the book's contents: a chapter a row with its facts, and Профил counting them", async ({ page }) => {
  // Every fact of the sample's „Кино и телевизия“, and one of „История“.
  await page.goto("/");
  await knows(page, ["mov-300", "mov-302", "mov-960", "mov-961", "mov-962", "mov-963", "mov-964", "his-002"]);

  await page.goto("/me");
  const line = page.getByRole("link", { name: /^8 факта в Алманаха/ });
  await expect(line).toBeVisible();
  await line.click();
  await expect(page).toHaveURL(/\/almanac$/);
  await expect(page.locator(".fig").nth(1)).toContainText("8факта");
  // Ten topics, „Микс“ and „България“: twelve chapters, each a way into its own.
  const rows = page.locator(".toc-row");
  await expect(rows).toHaveCount(12);
  await expect(rows.nth(4)).toContainText("Кино и телевизия");
  await expect(rows.nth(4)).toContainText("7 факта");
  await expect(rows.nth(10)).toContainText("Микс");
  await expect(rows.nth(11)).toContainText("България");
  await rows.nth(4).getByRole("link").click();
  await expect(page).toHaveURL(/\/almanac\/movies$/);
  await expect(page.getByRole("heading", { level: 1, name: "Кино и телевизия" })).toBeVisible();
  await expect(page.locator(".entry")).toHaveCount(7);
  // Its game, a tap away.
  await expect(page.getByRole("link", { name: "Играй главата" })).toHaveAttribute("href", "/play/movies");
});

test("a chapter comes a page at a time, by its numbers, and finds its facts by their words", async ({ page }) => {
  const facts = sampleFacts(); // more than three pages of thirty
  await page.goto("/");
  await knows(page, facts);
  await page.goto("/almanac/mix");
  const entries = page.locator(".entry");
  await expect(entries).toHaveCount(30);
  await expect(page.locator(".chapter-facts .sect-note")).toHaveText(`${facts.length}, най-новите първи`);
  await page.locator(".pager").getByRole("button", { name: "По-стари" }).click();
  await expect(page).toHaveURL(/\/almanac\/mix\?page=2$/);
  await expect(page.locator('.pager-n[aria-current="page"]')).toHaveText("2");
  // The page in the address: a reload opens it again.
  await page.reload();
  await expect(page.locator('.pager-n[aria-current="page"]')).toHaveText("2");
  await expect(entries).toHaveCount(30);
  // Found by a word of its answer, in any case.
  await page.getByRole("searchbox", { name: "Търси във фактите" }).fill("ДУНАВ");
  await expect(page).toHaveURL(/\?q=/);
  await expect(entries.first()).toContainText(/Дунав/i);
  for (const text of await entries.allTextContents()) expect(text).toMatch(/дунав/i);
  await page.getByRole("searchbox", { name: "Търси във фактите" }).fill("щщщщщ");
  await expect(page.getByText("Нищо не е намерено. Опитай с друга дума.")).toBeVisible();
});

test("a chapter's entries: the latest first, each with its dateline; a statement is its own headword", async ({
  page,
}) => {
  await page.goto("/");
  const day = 24 * 3600_000;
  await knows(page, ["his-002", "geo-961"], Date.now() - 2 * day);
  await knows(page, ["his-960"], Date.now());
  await page.goto("/almanac/mix");
  const items = page.locator(".entry");
  await expect(items).toHaveCount(3);
  // The latest first, each dated as it was learned.
  await expect(items.first().locator(".entry-when")).toBeVisible();
  // A true statement is the headword, with no question under it; an untrue one says so.
  const truth = items.first(); // learned today, the latest
  await expect(truth.locator(".entry-q")).toHaveCount(0);
  await expect(truth.locator(".entry-word")).toHaveText("Българската държава на Балканите е основана през 681 г.");
  await expect(page.locator(".entry-word", { hasText: "Дунав" })).toHaveText(
    "Невярно: Дунав се влива в Черно море на българска земя.",
  );
  // A question's answer is the headword, the question in italic under it.
  await expect(items.filter({ has: page.locator(".entry-q") })).toHaveCount(1);
  await expect(items.last().locator(".entry-q")).toHaveCount(1); // learned first
});

test("on a big screen the book is a spread: the contents in two columns, none over another", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await knows(page, sampleFacts().slice(0, 12));
  await page.goto("/almanac");
  const rows = page.locator(".toc-row");
  await expect(rows).toHaveCount(12);
  const boxes = await rows.evaluateAll((all) =>
    all.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  expect(new Set(boxes.map((b) => Math.round(b.left))).size).toBe(2);
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1))
      expect(a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1).toBe(false);
});

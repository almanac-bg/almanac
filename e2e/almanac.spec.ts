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

test("Моят Алманах in progress: Профил counts the facts, a topic says how many of its own", async ({ page }) => {
  // Every fact of the sample's „Кино и телевизия“, and one of „История“.
  await page.goto("/");
  await knows(page, ["mov-300", "mov-302", "mov-960", "mov-961", "mov-962", "mov-963", "mov-964", "his-002"]);

  await page.goto("/me");
  const line = page.getByRole("link", { name: /^8 факта в Алманаха/ });
  await expect(line).toBeVisible();
  await line.click();
  await expect(page).toHaveURL(/\/almanac$/);
  const head = page.locator(".almanac-head");
  await expect(head).toContainText("8 факта досега");
  await page.getByRole("button", { name: /Кино и телевизия/ }).click();
  await expect(head).toContainText("7 от 7 факта в „Кино и телевизия“");
});

test("Моят Алманах comes a page at a time, the next as the list's end comes near", async ({ page }) => {
  const facts = sampleFacts(); // more than three pages of thirty
  await page.goto("/");
  await knows(page, facts);
  await page.goto("/almanac");
  await expect(page.locator(".almanac-head")).toContainText(`${facts.length} факта досега`);
  const cards = page.locator(".almanac-item");
  await expect(cards).toHaveCount(30);
  // Down to the end, again and again: each time a page more, till there are none.
  for (const n of [60, 90, facts.length]) {
    await cards.last().scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(n);
  }
  await expect(page.getByRole("button", { name: "Още факти" })).toHaveCount(0);
  // One list, no datelines.
  await expect(page.locator(".almanac-list")).toHaveCount(1);
  // A topic starts again from its first, with no more than it has.
  await page.getByRole("button", { name: /^.*География/ }).click();
  const geography = facts.filter((id) => id.startsWith("geo-")).length;
  await expect(cards).toHaveCount(Math.min(geography, 30));
  await expect(page.locator(".almanac-topic").first()).toContainText("География");
});

test("Моят Алманах reads in the order the facts were learned, with no datelines; a statement is its own headline", async ({
  page,
}) => {
  await page.goto("/");
  const day = 24 * 3600_000;
  await knows(page, ["his-002", "geo-961"], Date.now() - 2 * day);
  await knows(page, ["his-960"], Date.now());
  await page.goto("/almanac");
  const items = page.locator(".almanac-item");
  await expect(items).toHaveCount(3);
  // The first learned first, the latest last, and no dateline over any.
  await expect(page.locator("time")).toHaveCount(0);
  // A true statement is the headline, with no question over it; an untrue one says so.
  const truth = items.last(); // learned today, the last
  await expect(truth.locator(".almanac-q")).toHaveCount(0);
  await expect(truth.locator(".almanac-a")).toHaveText("Българската държава на Балканите е основана през 681 г.");
  await expect(page.locator(".almanac-a", { hasText: "Дунав" })).toHaveText(
    "Невярно: Дунав се влива в Черно море на българска земя.",
  );
  // A question's answer is the headline, the question a small line over it.
  const asked = items.filter({ has: page.locator(".almanac-q") });
  await expect(asked).toHaveCount(1);
  await expect(items.first().locator(".almanac-q")).toHaveCount(1); // learned first
});

test("Моят Алманах lays its cards as masonry: columns where they fit, none over another", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await knows(page, sampleFacts().slice(0, 12));
  await page.goto("/almanac");
  const cards = page.locator(".almanac-card");
  await expect(cards).toHaveCount(12);
  const boxes = await cards.evaluateAll((all) =>
    all.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  expect(new Set(boxes.map((b) => Math.round(b.left))).size).toBeGreaterThan(1);
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1))
      expect(a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1).toBe(false);
});

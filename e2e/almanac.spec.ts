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

  // „Цяла тема“: every fact of a topic, there for the taking (it's given with the next game's news).
  await page.goto("/rewards");
  await page.getByText(/^Всички постижения \(\d+\)$/).click();
  const whole = page.locator(".achievement", { hasText: "Цяла тема" }).last();
  await expect(whole).toContainText("Събери всички факти от една тема в Алманаха.");
  await expect(page.locator(".achievement", { hasText: "Сто факта" }).last()).toContainText("8 / 100");
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
  // All learned today: one day, its head once, its facts going on under it from page to page.
  await expect(page.locator(".almanac-day")).toHaveCount(1);
  // A topic starts again from its newest, with no more than it has.
  await page.getByRole("button", { name: /^.*География/ }).click();
  const geography = facts.filter((id) => id.startsWith("geo-")).length;
  await expect(cards).toHaveCount(Math.min(geography, 30));
  await expect(page.locator(".almanac-topic").first()).toContainText("География");
});

test("Моят Алманах reads by day, newest first, each under its issue and date; a statement is its own headline", async ({
  page,
}) => {
  await page.goto("/");
  const day = 24 * 3600_000;
  await knows(page, ["his-002", "geo-961"], Date.now() - 2 * day);
  await knows(page, ["his-960"], Date.now());
  await page.goto("/almanac");
  const days = page.locator(".almanac-day");
  await expect(days).toHaveCount(2);
  // The newest day first, under its dateline („Брой 6 · 17 ноември“), its issue two after the other's.
  const heads = page.locator(".almanac-date");
  await expect(heads.first()).toHaveText(/^Брой \d+ · \d{1,2} \p{L}+$/u);
  const issue = async (n: number) => Number((await heads.nth(n).textContent())?.match(/Брой (\d+)/)?.[1]);
  expect((await issue(0)) - (await issue(1))).toBe(2);
  await expect(days.first().locator(".almanac-item")).toHaveCount(1);
  await expect(days.last().locator(".almanac-item")).toHaveCount(2);
  // A true statement is the headline, with no question over it; an untrue one says so.
  const truth = days.first().locator(".almanac-item");
  await expect(truth.locator(".almanac-q")).toHaveCount(0);
  await expect(truth.locator(".almanac-a")).toHaveText("Българската държава на Балканите е основана през 681 г.");
  await expect(days.last().locator(".almanac-a", { hasText: "Дунав" })).toHaveText(
    "Невярно: Дунав се влива в Черно море на българска земя.",
  );
  // A question's answer is the headline, the question a small line over it.
  const asked = days
    .last()
    .locator(".almanac-item")
    .filter({ has: page.locator(".almanac-q") });
  await expect(asked).toHaveCount(1);
});

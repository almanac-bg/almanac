import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { knows, readText } from "./play.ts";

/** Every live question with a fact in the sample bank (in one chapter's file, `chapter`). */
function sampleFacts(chapter = ""): string[] {
  const dir = resolve(import.meta.dirname, "..", "bank/sample/questions");
  return readdirSync(dir)
    .filter((f) => !chapter || f === `${chapter}.json`)
    .flatMap((f) =>
      (JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { id: string; fact?: string; retired?: boolean }[])
        .filter((q) => q.fact && !q.retired)
        .map((q) => q.id),
    );
}

test("the book's contents: a chapter a row with its ink, and no count of it all", async ({ page }) => {
  // Every fact of the sample's „Кино и телевизия“ in ink, and one of „История“ in pencil.
  await page.goto("/");
  await knows(page, ["mov-300", "mov-302", "mov-960", "mov-961", "mov-962", "mov-963", "mov-964"], Date.now(), true);
  await knows(page, ["his-002"]);

  await page.goto("/almanac");
  await expect(page.locator(".book")).not.toContainText("факта");
  // Ten topics, each a chapter's card with its ink; „Микс“ and „България“ two ways to play at the book's head.
  const cards = page.locator(".chapter-card");
  await expect(cards).toHaveCount(10);
  const movies = cards.filter({ hasText: "Кино и телевизия" });
  await expect(movies).toContainText(/7\s*с\sмастило/);
  // A counter at zero is hidden: the book's head says how ink is written.
  await expect(cards.filter({ hasText: "География" })).not.toContainText("с мастило");
  await expect(page.locator(".way")).toHaveText([/Микс/, /България/]);
  // The chapters with ink first, then those without: no short card beside a tall one.
  await expect(cards.first()).toContainText("Кино и телевизия");
  await expect(cards.nth(1)).not.toContainText("с мастило");
  await movies.click();
  await expect(page).toHaveURL(/\/almanac\/movies$/);
  await expect(page.getByRole("heading", { level: 1, name: "Кино и телевизия" })).toBeVisible();
  await expect(page.locator(".entry")).toHaveCount(7);
  // Its game, a tap away.
  await expect(page.getByRole("link", { name: "Игра на главата" })).toHaveAttribute("href", "/play/movies");
});

test("a chapter comes a page at a time, by its numbers", async ({ page }) => {
  // No chapter of the sample has more than a page of facts: the server's pages (play.AlmanacOf, its own tests) are
  // stood in for here, 95 facts of „География“, thirty to a page.
  const found = 95;
  await page.route(/\/api\/almanac\?/, async (route) => {
    const q = new URL(route.request().url()).searchParams;
    const at = Math.min(Number(q.get("page") ?? 0), Math.ceil(found / 30) - 1);
    const n = Math.max(0, Math.min(30, found - at * 30));
    const facts = Array.from({ length: Number(q.get("page") ?? 0) > at ? 0 : n }, (_, i) => ({
      id: `geo-${at * 30 + i}`,
      category: "geography",
      question: `Въпрос ${at * 30 + i + 1}`,
      answer: `Отговор ${at * 30 + i + 1}`,
      fact: "Факт.",
      at: Date.now() - (at * 30 + i) * 60_000,
      kind: "day",
      issue: 3,
    }));
    await route.fulfill({ json: { facts, found, ink: { geography: 0 } } });
  });
  await page.goto("/");
  await knows(page, ["geo-961"]); // a player, with a fact
  await page.goto("/almanac/geography");
  const entries = page.locator(".entry");
  await expect(entries).toHaveCount(30);
  await expect(page.locator(".chapter-facts .sect-note")).toHaveText(`${found} факта, най-новите първи`);
  await page.locator(".pager").getByRole("link", { name: "По-стари" }).click();
  await expect(page).toHaveURL(/\/almanac\/geography\?page=2$/);
  await expect(page.locator('.pager-n[aria-current="page"]')).toHaveText("2");
  // The page in the address: a reload opens it again.
  await page.reload();
  await expect(page.locator('.pager-n[aria-current="page"]')).toHaveText("2");
  await expect(entries).toHaveCount(30);
  // A page is an entry of the history: back is the page before, still in the chapter.
  await page.goBack();
  await expect(page).toHaveURL(/\/almanac\/geography$/);
  await expect(page.locator('.pager-n[aria-current="page"]')).toHaveText("1");
  await page.goForward();
  await expect(page.locator('.pager-n[aria-current="page"]')).toHaveText("2");
  // A page past the last is the last.
  await page.goto("/almanac/geography?page=99");
  await expect(page.locator('.pager-n[aria-current="page"]')).toHaveText("4");
  await expect(page).toHaveURL(/\/almanac\/geography\?page=4$/);
  await expect(entries).toHaveCount(5);
});

test("a chapter finds its facts by their words", async ({ page }) => {
  const facts = sampleFacts("geography"); // more than the ten from which a chapter is searched
  await page.goto("/");
  await knows(page, facts);
  await page.goto("/almanac/geography");
  const entries = page.locator(".entry");
  await expect(entries).toHaveCount(facts.length);
  // Found by a word of its answer, in any case.
  await page.getByRole("searchbox", { name: "Търси във фактите" }).fill("ДУНАВ");
  await expect(page).toHaveURL(/\?q=/);
  await expect(entries.first()).toContainText(/Дунав/i);
  for (const text of await entries.allTextContents()) expect(text).toMatch(/дунав/i);
  await page.getByRole("searchbox", { name: "Търси във фактите" }).fill("щщщщщ");
  await expect(page.getByText("Нищо не е намерено. Опитай с друга дума.")).toBeVisible();
});

test("„Микс“ and „България“ are ways to play, not chapters: no page of their own lists every fact", async ({
  page,
}) => {
  await page.goto("/");
  await knows(page, ["his-002", "geo-961"]);
  for (const way of ["mix", "bulgaria"]) {
    await page.goto(`/almanac/${way}`);
    await expect(page.getByRole("heading", { level: 1, name: "Няма такава страница" })).toBeVisible();
  }
  await page.goto("/almanac");
  await expect(page.locator(".way").first()).toHaveAttribute("href", "/play/mix");
});

/** A text as the page holds it, without the soft hyphens that let its long words break (ui.ts, textWords). */
const read = (text: string | null) => (text ?? "").replaceAll("­", "");

test("a chapter's entries: the latest first, each with its dateline; a statement is its own headword", async ({
  page,
}) => {
  await page.goto("/");
  const day = 24 * 3600_000;
  await knows(page, ["his-002", "geo-961"], Date.now() - 2 * day);
  await knows(page, ["his-960"], Date.now());
  await page.goto("/almanac/history");
  const items = page.locator(".entry");
  await expect(items).toHaveCount(2);
  // The latest first, each dated as it was learned.
  await expect(items.first().locator(".entry-when")).toBeVisible();
  // A true statement is the headword, with no question under it.
  const truth = items.first(); // learned today, the latest
  await expect(truth.locator(".entry-q")).toHaveCount(0);
  await expect
    .poll(() => readText(truth.locator(".entry-word")))
    .toBe("Българската държава на Балканите е основана през 681 г.");
  // A question's answer is the headword, the question in italic under it.
  await expect(items.last().locator(".entry-q")).toHaveCount(1); // learned first
  // Two facts are read at a glance: no search over them.
  await expect(page.getByRole("searchbox", { name: "Търси във фактите" })).toHaveCount(0);
  // An untrue statement says so.
  await page.goto("/almanac/geography");
  await expect
    .poll(() => readText(page.locator(".entry-word", { hasText: "Дунав" })))
    .toBe("Невярно: Дунав се влива в Черно море на българска земя.");
});

test("a chapter the book doesn't have is the page that isn't there; the book with a slash after it is the book", async ({
  page,
}) => {
  await page.goto("/almanac/nosuch");
  await expect(page.getByRole("heading", { level: 1, name: "Няма такава страница" })).toBeVisible();
  await page.goto("/almanac/");
  await expect(page).toHaveURL(/\/almanac$/);
  await expect(page.locator(".chapter-card")).toHaveCount(10);
});

test("on a big screen the book's chapters are five across, none over another", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await knows(page, sampleFacts().slice(0, 12));
  await page.goto("/almanac");
  const rows = page.locator(".chapter-card");
  await expect(rows).toHaveCount(10);
  const boxes = await rows.evaluateAll((all) =>
    all.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  expect(new Set(boxes.map((b) => Math.round(b.left))).size).toBe(5);
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1))
      expect(a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1).toBe(false);
});

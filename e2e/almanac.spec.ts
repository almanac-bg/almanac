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
  // Ten chapters, each a chapter's card with its ink, and nothing else to play at the book's head.
  const cards = page.locator(".chapter-card");
  await expect(cards).toHaveCount(10);
  const movies = cards.filter({ hasText: "Кино и телевизия" });
  await expect(movies).toContainText(/7\s*с\sмастило/);
  // A counter at zero is hidden: the book's head says how ink is written.
  await expect(cards.filter({ hasText: "География" })).not.toContainText("с мастило");
  // A chapter before its first rank has the foot the others have: no seal yet, and how far the first is.
  await expect(cards.filter({ hasText: "География" })).toContainText(/Още\sбез\sпечат\s*още\s1\sдо\s„Бележка“/);
  await expect(page.locator(".book-head a")).toHaveCount(0);
  // The chapters in their numbers' order, whatever their ink: a book's contents.
  await expect(cards.first()).toContainText("Обща култура");
  await expect(cards.nth(4)).toContainText("Кино и телевизия");
  await movies.click();
  await expect(page).toHaveURL(/\/almanac\/movies$/);
  await expect(page.getByRole("heading", { level: 1, name: "Кино и телевизия" })).toBeVisible();
  await expect(page.locator(".entry")).toHaveCount(7);
  // Its game, a tap away.
  await expect(page.getByRole("link", { name: "Играй 10 въпроса" })).toHaveAttribute("href", "/play/movies");
});

test("a chapter says nothing of its ink until its numbers have come", async ({ page }) => {
  // A fact in ink in „Кино и телевизия“; the chapter's numbers held back a moment, as on a slow line.
  await page.goto("/");
  await knows(page, ["mov-300"], Date.now(), true);
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route(/\/api\/almanac\?/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/almanac/movies");
  await expect(page.getByRole("heading", { level: 1, name: "Кино и телевизия" })).toBeVisible();
  // Not „no ink yet“ while they're on their way: nothing.
  await expect(page.locator(".chapter-stand")).toHaveCount(0);
  release();
  await expect(page.locator(".chapter-ink")).toContainText(/1\s*с\sмастило/);
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
      chapter: "geography",
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
  await page.locator(".pages").getByRole("link", { name: "По-стари" }).click();
  await expect(page).toHaveURL(/\/almanac\/geography\?page=2$/);
  await expect(page.locator(".pages-at")).toHaveText("Страница 2\u00a0от\u00a04");
  // The page in the address: a reload opens it again.
  await page.reload();
  await expect(page.locator(".pages-at")).toHaveText("Страница 2\u00a0от\u00a04");
  await expect(entries).toHaveCount(30);
  // A page is an entry of the history: back is the page before, still in the chapter.
  await page.goBack();
  await expect(page).toHaveURL(/\/almanac\/geography$/);
  await expect(page.locator(".pages-at")).toHaveText("Страница 1\u00a0от\u00a04");
  await expect(page.locator(".pages").getByRole("button", { name: "По-нови" })).toBeDisabled();
  await page.goForward();
  await expect(page.locator(".pages-at")).toHaveText("Страница 2\u00a0от\u00a04");
  // A page past the last is the last.
  await page.goto("/almanac/geography?page=99");
  await expect(page.locator(".pages-at")).toHaveText("Страница 4\u00a0от\u00a04");
  await expect(page.locator(".pages").getByRole("button", { name: "По-стари" })).toBeDisabled();
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
  // What it found is marked in each entry, whole across a long word's soft hyphens, and nothing else is.
  const marks = page.locator(".entry mark");
  await expect(marks.first()).toBeVisible();
  for (const m of await marks.all()) expect((await readText(m)).toLowerCase()).toBe("дунав");
  for (const e of await entries.all()) await expect(e.locator("mark").first()).toBeVisible();
  // A long word, broken by syllables („по-лу-ост-ров“), is marked in one piece over its soft hyphens.
  await page.getByRole("searchbox", { name: "Търси във фактите" }).fill("луостр");
  await expect(page).toHaveURL(/\?q=%D0%BB/);
  await expect.poll(() => readText(marks.first())).toBe("луостр");
  for (const m of await marks.all()) {
    expect(await readText(m)).toBe("луостр");
    expect(await m.textContent()).toContain("­");
  }
  // No search, no marks.
  await page.getByRole("searchbox", { name: "Търси във фактите" }).fill("");
  await expect(page).toHaveURL(/\/almanac\/geography$/);
  await expect(entries).toHaveCount(facts.length);
  await expect(marks).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Търси във фактите" }).fill("щщщщщ");
  await expect(page.getByText("Нищо не е намерено. Опитай с друга дума.")).toBeVisible();
});

test("a game is of one chapter: every chapter at once and Bulgaria's are no page and no game", async ({ page }) => {
  await page.goto("/");
  await knows(page, ["his-002", "geo-961"]);
  for (const path of ["/almanac/mix", "/almanac/bulgaria", "/play/mix", "/play/bulgaria"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Няма такава страница" })).toBeVisible();
  }
});

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
  // An entry reads as it was lived: the dateline, the question, its answer as the headword, then the fact.
  await expect(items.last().locator(".entry-q")).toHaveCount(1); // learned first
  expect(
    await items
      .last()
      .locator(".entry-when, .entry-q, .entry-word, .entry-lines, .entry-fact")
      .evaluateAll((all) => all.map((e) => e.className)),
  ).toEqual(["entry-when", "entry-q", expect.stringMatching(/^entry-(word|lines)$/), "entry-fact"]);
  // Two facts are read at a glance: no search over them.
  await expect(page.getByRole("searchbox", { name: "Търси във фактите" })).toHaveCount(0);
  // An untrue statement says so.
  await page.goto("/almanac/geography");
  await expect
    .poll(() => readText(page.locator(".entry-word", { hasText: "Дунав" })))
    .toBe("Невярно: Дунав се влива в Черно море на българска земя.");
});

test("a chapter opened at facts shows them marked for a moment, and its address is the chapter's own", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  const day = 24 * 3600 * 1000;
  // The day's two, in ink, under a chapter's game played since (grey): they're down the page.
  await knows(page, ["his-002", "his-960"], Date.now() - day, true);
  await knows(
    page,
    sampleFacts("history").filter((id) => id !== "his-002" && id !== "his-960"),
  );
  await page.goto("/almanac/history?fact=his-002&fact=his-960");
  const lit = page.locator(".entry.lit");
  await expect(lit).toHaveCount(2);
  expect(await lit.evaluateAll((all) => all.map((e) => (e as HTMLElement).dataset.fact).sort())).toEqual([
    "his-002",
    "his-960",
  ]);
  // The first of them in sight, though it's far down the chapter; the tint is the chapter's colour, fading.
  await expect(lit.first()).toBeInViewport();
  expect(await lit.first().evaluate((e) => getComputedStyle(e, "::after").animationName)).toBe("lit");
  // Read once: the address is the chapter's own, so a reload, or coming back, marks nothing.
  await expect(page).toHaveURL(/\/almanac\/history$/);
  await page.reload();
  await expect(page.locator(".entry").first()).toBeVisible();
  await expect(page.locator(".entry.lit")).toHaveCount(0);
});

test("a picture question's entry shows its picture, credited; a choice of pictures shows its answer's", async ({
  page,
}) => {
  await page.goto("/");
  // A flag over its question (geo-901), a choice of flags (geo-965), and a question without a picture (his-002).
  await knows(page, ["geo-901", "geo-965"]);
  await page.goto("/almanac/geography");
  const entries = page.locator(".entry");
  await expect(entries).toHaveCount(2);
  for (const e of await entries.all()) {
    const pic = e.locator("img.entry-pic");
    await expect(pic).toBeVisible();
    await expect(pic).toHaveAttribute("loading", "lazy");
    await expect(pic).toHaveAttribute("src", /^\/qimg\/[0-9a-f]{16}-600\.webp$/);
    // Drawn, at its own shape, beside the question and headword, in the entry's small text its credit.
    expect(await pic.evaluate((im: HTMLImageElement) => im.complete && im.naturalWidth > 0)).toBe(true);
    await expect(e.locator(".credit")).toContainText("Снимка:");
    const [p, word] = [await pic.boundingBox(), await e.locator(".entry-word").boundingBox()];
    expect(p && word && p.x > word.x).toBe(true);
  }
  await page.goto("/");
  await knows(page, ["his-002"]);
  await page.goto("/almanac/history");
  await expect(page.locator(".entry")).toHaveCount(1);
  await expect(page.locator(".entry img, .entry .credit")).toHaveCount(0);
});

test("an entry's picture opens large, whole and credited, its headword the title, and goes again", async ({ page }) => {
  await page.goto("/");
  await knows(page, ["geo-901"]);
  await page.goto("/almanac/geography");
  const word = await readText(page.locator(".entry-word"));
  const thumb = page.getByRole("button", { name: "Виж снимката голяма" });
  const sheet = page.locator("dialog.picture-sheet");
  // Opened by the thumbnail: the largest file, drawn whole, wider than the thumbnail; the headword and the credit.
  await thumb.click();
  await expect(sheet).toBeVisible();
  expect(await readText(sheet.getByRole("heading", { level: 2 }))).toBe(word);
  const big = sheet.locator("img.picture-large");
  await expect(big).toHaveAttribute("src", /^\/qimg\/[0-9a-f]{16}\.webp$/);
  await expect.poll(() => big.evaluate((im: HTMLImageElement) => im.complete && im.naturalWidth > 0)).toBe(true);
  await expect(big).toHaveCSS("object-fit", "contain");
  expect((await big.boundingBox())?.width ?? 0).toBeGreaterThan(200);
  await expect(sheet.locator(".credit")).toContainText("Снимка:");
  // Put away by „Затвори“, by Esc, and by a tap beside it.
  await sheet.getByRole("button", { name: "Затвори" }).click();
  await expect(sheet).toHaveCount(0);
  await thumb.click();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await thumb.click();
  await page.mouse.click(5, 5);
  await expect(sheet).toHaveCount(0);
});

test("on a big screen a chapter's entries are one column, the latest first, top to bottom", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  await knows(page, sampleFacts("geography"));
  await page.goto("/almanac/geography");
  const entries = page.locator(".entry");
  await expect(entries.first()).toBeVisible();
  const boxes = await entries.evaluateAll((all) => all.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  expect(new Set(boxes.map((b) => Math.round(b.left))).size).toBe(1);
  for (const [i, b] of boxes.slice(1).entries()) expect(b.top).toBeGreaterThan(boxes[i]?.bottom ?? 0);
  expect(boxes[0]?.width).toBeLessThanOrEqual(44 * 16 + 1);
  // Scrolled to its last fact, the chapter's head and its „Играй“ are still beside them: no half a screen left empty.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const play = await page.getByRole("link", { name: "Играй 10 въпроса" }).boundingBox();
  expect(play && play.y >= 0 && play.y + play.height <= 900).toBe(true);
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

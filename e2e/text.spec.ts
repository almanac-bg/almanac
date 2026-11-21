// Large text and a finger's room: the text at twice its size (a phone's own setting, or the game's „Размер на
// текста“ with it) on the narrowest phone scrolls nowhere sideways, and every control on its own has 44px to tap.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { befriend, daysPlayed, dealt, startDay } from "./play.ts";

/** The text at `percent` of its size from the page's start, as a phone set to large text gives it (a style the page's
 * own rules can't undo; CSP lets the test add it). */
async function textAt(page: Page, percent: number): Promise<void> {
  await page.addInitScript((p) => {
    const style = document.createElement("style");
    style.textContent = `html { font-size: ${p}% !important; }`;
    const put = () => {
      if (document.head && !style.isConnected) document.head.append(style);
    };
    new MutationObserver(put).observe(document, { childList: true, subtree: true });
    put();
  }, percent);
}

/** What makes the page wider than the screen, if anything: the deepest element that does, found by hiding each in
 * turn (a name a failing test can be read by). */
async function sideways(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const wide = () => root.scrollWidth > root.clientWidth;
    if (!wide()) return "";
    const path: string[] = [];
    let at: Element = document.body;
    for (;;) {
      const culprit = [...at.children].find((c) => {
        const el = c as HTMLElement;
        const was = el.style.display;
        el.style.display = "none";
        const fits = !wide();
        el.style.display = was;
        return fits;
      });
      if (!culprit) break;
      path.push(`${culprit.tagName.toLowerCase()}.${[...culprit.classList].join(".")}`);
      at = culprit;
    }
    return `${root.scrollWidth}px wide: ${path.join(" > ")}`;
  });
}

async function fits(page: Page, where: string): Promise<void> {
  await page.waitForTimeout(300); // what comes in beats (an answer's parts) has come
  expect(await sideways(page), where).toBe("");
}

/** Answers whatever question shows, without the pointer's checks: at this size „Готово“ and „Отговори“ stay at the
 * screen's foot over what scrolls under them, which a player scrolls past and a test's click won't. */
async function answerAnyhow(page: Page): Promise<void> {
  const q = page.locator("article.question");
  await expect(q.locator(".split, .options, .keypad, .tf-options, .match").first()).toBeVisible();
  const tap = (l: ReturnType<Page["locator"]>) => l.dispatchEvent("click");
  if (await q.locator(".keypad").count()) {
    for (const k of "1900") await tap(q.locator(".keypad").getByRole("button", { name: k, exact: true }));
    await tap(q.getByRole("button", { name: "Отговори" }));
  } else if (await q.locator(".sortable-list").count()) {
    await tap(q.getByRole("button", { name: "Готово" }));
  } else if (await q.locator(".match").count()) {
    const [left, right] = [q.locator(".match-col").first(), q.locator(".match-col").last()];
    for (let i = 0; i < 4; i++) {
      await tap(left.locator(".match-item").nth(i));
      await tap(right.locator(".match-item").nth(i));
    }
    await tap(q.getByRole("button", { name: "Готово" }));
  } else if (await q.locator(".split").count()) {
    for (let i = 0; i < 6; i++) await tap(q.locator(".split-side").first());
  } else if (await q.locator(".tf-options").count()) {
    await tap(q.getByRole("button", { name: "Вярно", exact: true }));
  } else {
    await tap(q.locator(".options .option").first());
  }
}

test.describe("twice the text on a 320px phone", () => {
  test.use({ viewport: { width: 320, height: 640 }, bypassCSP: true });

  test("the day, its ten questions and answers, and the places: nothing scrolls sideways", async ({ page }) => {
    test.setTimeout(180_000);
    await textAt(page, 200);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Десет въпроса за днес" })).toBeVisible();
    await fits(page, "Днес");
    await startDay(page);
    for (let n = 0; n < 10; n++) {
      await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
      await fits(page, `question ${n + 1}`);
      await answerAnyhow(page);
      await expect(page.locator(".after .verdict")).toBeVisible({ timeout: 40_000 });
      await expect(page.locator(".after .up-next-go")).toBeVisible();
      await fits(page, `answer ${n + 1}`);
      await page
        .locator(".after .up-next-go")
        .dispatchEvent("click")
        .catch(() => {}); // moved on by itself
    }
    await expect(page.locator(".summary")).toBeVisible({ timeout: 10_000 });
    await fits(page, "the day's result");
    for (const path of ["/", "/almanac", "/me", "/avatar", "/friends", "/settings", "/duel/new"]) {
      await page.goto(path);
      await expect(page.locator("#main h1, #main h2").first()).toBeVisible();
      await fits(page, path);
    }
    // The places at the foot, each name whole in its third: none cut („Алмана…“) or wider than its place.
    const cut = await page
      .locator(".places-foot a")
      .evaluateAll((links) =>
        links
          .filter((a) => a.scrollWidth > a.clientWidth + 1 || getComputedStyle(a).textOverflow === "ellipsis")
          .map((a) => a.textContent),
      );
    expect(cut).toEqual([]);
  });
});

/** What of `selector` can't be seen whole at any scroll of `scroller` (the page, or a box that may scroll on its own:
 * an answer's panel): its top, middle and foot each come into sight, over everything else, at some scroll. Quick enough
 * to run while an answer shows (nothing waits for a frame: a scroll lays the page out when it's next asked). */
async function outOfReach(page: Page, selector: string, scroller?: string): Promise<string[]> {
  return page.evaluate(
    ([selector, scroller]) => {
      const own = scroller ? document.querySelector<HTMLElement>(scroller) : null;
      const box = own && own.scrollHeight > own.clientHeight + 1 ? own : null; // else the page scrolls it
      const items = [...document.querySelectorAll<HTMLElement>(selector)].filter((e) => e.getClientRects().length);
      const max = box ? box.scrollHeight - box.clientHeight : document.documentElement.scrollHeight - innerHeight;
      const was = box ? box.scrollTop : scrollY;
      const to = (y: number) => (box ? box.scrollTo(0, y) : scrollTo(0, y));
      const seen = new Map(items.map((e) => [e, new Set<number>()]));
      for (let y = 0; y <= max + 8; y += 8) {
        to(Math.min(y, max));
        for (const e of items) {
          const r = e.getBoundingClientRect();
          [r.top + 4, r.top + r.height / 2, r.bottom - 4].forEach((at, i) => {
            if (at < 0 || at > innerHeight) return;
            const hit = document.elementFromPoint(r.left + r.width / 2, at);
            if (hit && (hit === e || e.contains(hit))) seen.get(e)?.add(i);
          });
        }
      }
      to(was);
      return items
        .filter((e) => (seen.get(e)?.size ?? 0) < 3)
        .map((e) => `${e.className}: ${(e.textContent ?? "").trim().slice(0, 24)}`);
    },
    [selector, scroller ?? ""] as const,
  );
}

/** The words of six letters or fewer broken across two lines in `selector` (none ever is: a word breaks only where
 * it's wider than its cell, and at the usual size or twice it, six letters fit any). */
async function brokenWords(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const out: string[] = [];
    for (const cell of document.querySelectorAll(selector)) {
      const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        for (const m of (node.textContent ?? "").matchAll(/[\p{L}\p{N}­]+/gu)) {
          const word = m[0].replaceAll("­", "");
          if (word.length > 6) continue;
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const tops = new Set([...range.getClientRects()].filter((r) => r.width).map((r) => Math.round(r.top)));
          if (tops.size > 1) out.push(word);
        }
      }
    }
    return out;
  }, selector);
}

/** The sample bank's questions, one of each kind: a choice (the one with the longest answer), „Вярно или невярно“,
 * an order, pairs, groups, clues and a number. */
function eachKind(): string[] {
  const dir = resolve(import.meta.dirname, "../bank/sample/questions");
  type Q = { id: string; type: string; image?: unknown; answer?: unknown; wrong?: string[] };
  const all = readdirSync(dir).flatMap((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Q[]);
  const longest = (q: Q) => Math.max(...[String(q.answer), ...(q.wrong ?? [])].map((o) => o.length));
  const choice = all.filter((q) => q.type === "choice" && !q.image).sort((a, b) => longest(b) - longest(a))[0];
  return [
    choice?.id ?? "",
    ...["truefalse", "order", "match", "split", "clues", "number"].map(
      (type) => all.find((q) => q.type === type && !q.image)?.id ?? "",
    ),
  ];
}

test.describe("a player's places at twice the text on a 320px phone", () => {
  test.use({ viewport: { width: 320, height: 640 }, bypassCSP: true });

  test("the streak, friends of long names and their duels: words whole, nothing cut or sideways", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const other = await (await browser.newContext()).newPage();
    await page.goto("/");
    await daysPlayed(page, 1, 2, 3, 4);
    await befriend(page, other);
    await other.evaluate(() =>
      fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Борислав Петров" }),
      }),
    );
    const friend = await other.evaluate(async () => (await (await fetch("/api/me")).json()).user.id as number);
    await page.evaluate(
      (id) =>
        fetch("/api/duels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friend: id }),
        }),
      friend,
    );
    for (const size of [200, 150]) {
      await textAt(page, size);
      await page.goto("/");
      await expect(page.locator(".streak-chip")).toBeVisible();
      await fits(page, `Днес, ${size} %`);
      // The streak's words inside its card.
      const out = await page
        .locator(".streak-chip")
        .evaluate((chip) =>
          [...chip.querySelectorAll("*")].some(
            (e) => e.getBoundingClientRect().right > chip.getBoundingClientRect().right + 1,
          ),
        );
      expect(out, `the streak's words past its card, ${size} %`).toBe(false);
      for (const path of ["/friends", "/duel/new"]) {
        await page.goto(path);
        await expect(page.locator(".friend, .duel-pick").first()).toBeVisible();
        await fits(page, `${path}, ${size} %`);
        expect(
          await brokenWords(page, ".friend-name, .duel-row .who-name, .segmented button, .friend-act, .places-foot a"),
          `${path}'s words, ${size} %`,
        ).toEqual([]);
        // „Дуел“ and the tabs inside the screen.
        const off = await page
          .locator(".friend-act, .segmented button, .duel-row")
          .evaluateAll((els) =>
            els.filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.textContent),
          );
        expect(off, `${path}: off the screen's edge, ${size} %`).toEqual([]);
      }
      const cut = await page
        .locator(".places-foot a")
        .evaluateAll((links) => links.filter((a) => a.scrollWidth > a.clientWidth + 1).map((a) => a.textContent));
      expect(cut, `the places at the foot, ${size} %`).toEqual([]);
    }
  });
});

test.describe("every kind of question at twice the text on a 320px phone", () => {
  test.use({ viewport: { width: 320, height: 640 }, bypassCSP: true });

  test("its controls in reach, its words whole, its answer in sight", async ({ page }) => {
    test.setTimeout(180_000);
    await textAt(page, 200);
    await page.goto("/");
    const ids = eachKind();
    await dealt(page, "history", ids);
    await page.goto("/play/history");
    await page.getByRole("button", { name: "Продължи", exact: true }).click();
    await page.getByRole("button", { name: "Започни сега" }).click();
    const cells = "article.question :is(.options .option, .match-item, .split-side, .split-card.top)";
    for (let n = 0; n < ids.length; n++) {
      await expect(page.locator(".question-head")).toContainText(`${n + 1} от ${ids.length}`, { timeout: 10_000 });
      await expect(page.locator("article.question .answering")).toBeVisible();
      await page.waitForTimeout(300);
      // Each control is a scroll away, never only under „Готово“, „Отговори“ or the head.
      const controls = `article.question :is(.keypad button, .match-item, .split-side, .split-back:not([hidden]),
        .options .option, .answering .btn)`;
      expect(await outOfReach(page, controls), `question ${n + 1}'s controls`).toEqual([]);
      expect(await brokenWords(page, cells), `question ${n + 1}'s words`).toEqual([]);
      await answerAnyhow(page);
      await expect(page.locator(".after .up-next-go")).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(800); // the answer's beats
      // The answer: the panel's parts a scroll of the panel away, „Напред“ at its foot over none of them; the answers
      // (the right one, the whole order) a scroll of the page away, above the panel.
      expect(await outOfReach(page, ".after > :not(.up-next)", ".after"), `answer ${n + 1}'s panel`).toEqual([]);
      expect(await outOfReach(page, "article.question .options .option"), `answer ${n + 1}'s answers`).toEqual([]);
      expect(await brokenWords(page, cells), `answer ${n + 1}'s words`).toEqual([]);
      await page
        .locator(".after .up-next-go")
        .dispatchEvent("click")
        .catch(() => {}); // moved on by itself
    }
  });
});

/** The browser's own text size (its setting, not the page's): in Chromium the font size it starts every page at,
 * which also sizes the rem of a media query, as a phone's large text does; elsewhere the page's root, as textAt. */
async function browserTextAt(page: Page, px: number): Promise<void> {
  if (page.context().browser()?.browserType().name() !== "chromium") return textAt(page, (px / 16) * 100);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  await cdp.send("Page.setFontSizes", { fontSizes: { standard: px, fixed: px } });
}

/** What's wrong with the question showing at this size, if anything: the clock over the count before an answer;
 * after it, a column of the answer's panel squeezed to nothing, the line of how everyone answered a few letters
 * wide, „Напред“ off the screen's sides. */
async function crowded(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
    const meet = (a?: DOMRect, b?: DOMRect) =>
      !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const after = document.querySelector<HTMLElement>(".run-question.answered .after");
    if (!after) {
      if (meet(box(".question-head .count"), box(".question-top .timer .secs"))) out.push("the clock over the count");
      return out;
    }
    const cols = getComputedStyle(after).gridTemplateColumns.split(" ").map(parseFloat);
    if (cols.some((w) => w < 1)) out.push(`the panel's columns ${cols.join(" ")}`);
    const crowd = document.querySelector<HTMLElement>(".after .crowd-says");
    if (crowd) {
      const wide = crowd.getBoundingClientRect().width / parseFloat(getComputedStyle(crowd).fontSize);
      if (wide < 6) out.push(`how everyone answered, ${wide.toFixed(1)} letters wide`);
    }
    const go = box(".after .up-next-go");
    if (!go || go.left < 0 || go.right > document.documentElement.clientWidth) out.push("„Напред“ off the screen");
    return out;
  });
}

test.describe("every kind of question at a phone's own large text, 24 and 32px, on a 320px phone", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const px of [24, 32])
    test(`at ${px}px: its head, its answer's panel and „Напред“ on the screen, nothing sideways`, async ({ page }) => {
      test.setTimeout(180_000);
      await browserTextAt(page, px);
      // How everyone answered, as on a day many have played: its line under the verdict.
      await page.route("**/api/runs/*/answer", async (route) => {
        const res = await route.fetch();
        const json = await res.json();
        json.reveal.crowd = { answers: 240, right: 0.68, today: true };
        await route.fulfill({ response: res, json });
      });
      const each = async (where: string) => {
        await expect(page.locator("article.question .answering")).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(300);
        expect(await crowded(page), `${where}, asked`).toEqual([]);
        expect(await sideways(page), `${where}, asked`).toBe("");
        await answerAnyhow(page);
        await expect(page.locator(".after .up-next-go")).toBeVisible({ timeout: 40_000 });
        await page.waitForTimeout(800); // the answer's beats
        expect(await crowded(page), `${where}, answered`).toEqual([]);
        expect(await sideways(page), `${where}, answered`).toBe("");
      };
      // The day's first question: its head has the issue and the clock.
      await page.goto("/");
      await startDay(page);
      await each("the day's first question");
      // Then one of each kind, a picture's too.
      await page.goto("/");
      const ids = [...eachKind(), withPicture()];
      await dealt(page, "history", ids);
      await page.goto("/play/history");
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      await page.getByRole("button", { name: "Започни сега" }).click();
      for (let n = 0; n < ids.length; n++) {
        await expect(page.locator(".question-head")).toContainText(`${n + 1} от ${ids.length}`, { timeout: 10_000 });
        await each(`question ${n + 1}`);
        await page
          .locator(".after .up-next-go")
          .dispatchEvent("click")
          .catch(() => {}); // moved on by itself
      }
    });
});

/** A choice under a picture, from the sample bank. */
function withPicture(): string {
  const dir = resolve(import.meta.dirname, "../bank/sample/questions");
  type Q = { id: string; type: string; image?: unknown };
  const all = readdirSync(dir).flatMap((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Q[]);
  return all.find((q) => q.type === "choice" && q.image)?.id ?? "";
}

test("„Размер на текста“: three sizes, kept on this device; the one switch before it becomes the first step", async ({
  page,
}) => {
  // „По-едър текст“ on, as a player had it: the first of the larger sizes now.
  await page.addInitScript(() => {
    if (!localStorage.getItem("almanac.text")) localStorage.setItem("almanac.big", "on");
  });
  await page.goto("/settings");
  const sizes = page.getByRole("radiogroup", { name: "Размер на текста" });
  await expect(sizes.getByRole("radio", { name: "Едър", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveCSS("font-size", "20px");
  await sizes.getByRole("radio", { name: "Много едър" }).click();
  await expect(page.locator("html")).toHaveCSS("font-size", "24px");
  await page.reload();
  await expect(sizes.getByRole("radio", { name: "Много едър" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveCSS("font-size", "24px");
  await sizes.getByRole("radio", { name: "Обичаен" }).click();
  await expect(page.locator("html")).toHaveCSS("font-size", "16px");
});

test("a switch in Настройки is its whole row to tap, words and all", async ({ page }) => {
  await page.goto("/settings");
  const calm = page.getByRole("switch", { name: "По-малко движение" });
  const was = await calm.getAttribute("aria-checked");
  await page.getByText("Без анимации. Часовникът върви както винаги.").click();
  await expect(calm).not.toHaveAttribute("aria-checked", was ?? "");
  // What it does is read with it.
  await expect(calm).toHaveAccessibleDescription("Без анимации. Часовникът върви както винаги.");
});

/** Controls on their own (not a link inside a sentence) whose tap reaches them less than 44px high: tried by
 * elementFromPoint 21px above and below each one's middle, so a target drawn smaller with room around it to tap
 * (a pill's padding, a row's height) counts as what a finger has. */
async function smallTargets(page: Page): Promise<string[]> {
  const found: string[] = [];
  const controls = page.locator("a[href], button, [role=switch], [role=radio], [role=tab], summary");
  for (const c of await controls.all()) {
    if (!(await c.isVisible())) continue;
    const small = await c.evaluate((el) => {
      const parent = el.parentElement;
      // A link or a word that explains, in a sentence: read where it is, the line's height (WCAG's inline exception).
      if (
        parent &&
        [...parent.childNodes].some((n) => n !== el && n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      )
        return "";
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const reaches = (dy: number) => {
        const hit = document.elementFromPoint(x, y + dy);
        return !!hit && (hit === el || el.contains(hit) || !!hit.closest("label")?.contains(el));
      };
      return reaches(-21) && reaches(21)
        ? ""
        : `${el.tagName.toLowerCase()} „${(el.textContent ?? "").trim()}“ ${Math.round(r.height)}px`;
    });
    if (small) found.push(small);
  }
  return found;
}

test.describe("a finger's room", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("every control on its own has 44px to tap", async ({ page }) => {
    test.setTimeout(90_000);
    for (const path of ["/", "/settings", "/me", "/almanac", "/avatar", "/friends"]) {
      await page.goto(path);
      await expect(page.locator("#main h1, #main h2").first()).toBeVisible();
      expect(await smallTargets(page), path).toEqual([]);
    }
  });
});

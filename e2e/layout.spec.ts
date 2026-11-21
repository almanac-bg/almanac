// The look fits (DESIGN.md, Fit and Large text), held in one place: at a 320 × 568 phone, Safari's 375 × 600 and
// 390 × 664, and a 1366 × 900 laptop, at the usual text and at twice it (a phone's own setting, or the game's
// „Размер на текста“ with it), each screen looked at by day and by night:
//
// - Днес keeps its budget in the HTML's order and shows „Започни“ whole and high; the day's first question (its head
//   has the issue and the clock), its answer and the day's result scroll nowhere sideways, the clock never over the count, the answer's panel never squeezed.
// - Every kind of question (the longest the tests' bank has, the real bank's orders and pairs where it's here:
//   kinds.ts, bank.ts), answered right, wrong and close: at the usual
//   text what answers it and its action whole in sight, nothing under the action; once answered the player's row,
//   the right one and „Напред“, nothing under „Напред“ (on a laptop, the answer beside the question); at twice the
//   text every control a scroll away; a row's sign, a punctuation mark or a short word never on a line of its own.
//   On a laptop's short screen too (1366 × 650; a laptop has no touch screen, here as at 1366 × 900): its action in
//   sight, the answer beside it.
// - A kept player's places (seals, a friend of a long name, duels, /admin) and a new player's: nothing sideways, no
//   name cut, nothing over another.
//
// And what plays along with them: the sounds start with a tap (and come back from the background), and a question
// that's over isn't kept in memory. FIT_SHOTS=<folder> keeps a picture of each question before and after its answer.
import { expect, type Page, test } from "@playwright/test";
import { answerAs, beside, closeable, flaws, kinds, panelFlaws, type Q, unseenAnswers } from "./kinds.ts";
import { cutOrOverlapping, daysPlayed, dealt, keptPlayer, knows, startDay } from "./play.ts";

const sizes = [
  { width: 320, height: 568, go: 500 },
  { width: 375, height: 600, go: 540 },
  { width: 390, height: 664, go: 664 },
  { width: 1366, height: 900, go: 900 },
];
const schemes = ["light", "dark"] as const;

/** The text at `percent` of its size from the page's start, as a phone set to large text gives it (a style the page's
 * own rules can't undo; CSP lets the test add it). A later size for the same page: `textNow`. */
async function textAt(page: Page, percent: number): Promise<void> {
  await page.addInitScript((p) => {
    const style = document.createElement("style");
    const size = () => sessionStorage.getItem("e2e.text") ?? String(p);
    const put = () => {
      const rule = `html { font-size: ${size()}% !important; }`;
      if (style.textContent !== rule) style.textContent = rule; // else a change of its own, noticed again, forever
      if (document.head && !style.isConnected) document.head.append(style);
    };
    new MutationObserver(put).observe(document, { childList: true, subtree: true });
    put();
  }, percent);
}

/** That the page's text is at `percent` of its size: what the test means to look at is what it looks at. */
const textIs = (page: Page, percent: number) =>
  expect(page.locator("html")).toHaveCSS("font-size", `${(16 * percent) / 100}px`);

/** The text at `percent` from the next page on (after textAt). */
const textNow = (page: Page, percent: number) =>
  page.evaluate((p) => sessionStorage.setItem("e2e.text", String(p)), percent);

/** Until what the screen shows has come and holds still: the fonts, the question's pictures, and every short
 * movement (an answer's beats, a panel sliding in) run to its end; the clock and the line to the next question
 * (seconds long) go on. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.fonts.status === "loaded" &&
      [...document.querySelectorAll<HTMLImageElement>("article.question img")].every((i) => i.complete) &&
      !document.getAnimations().some((a) => {
        const end = Number(a.effect?.getComputedTiming().endTime ?? 0);
        return a.playState === "running" && end < 2500;
      }),
    undefined,
    { polling: "raf", timeout: 10_000 },
  );
}

/** What `check` finds by day and by night, each line with its scheme (the look's colours change, never its room). */
async function byDayAndNight(page: Page, check: () => Promise<string[]>): Promise<string[]> {
  const out: string[] = [];
  for (const scheme of schemes) {
    await page.emulateMedia({ colorScheme: scheme });
    out.push(...(await check()).map((x) => `${scheme}: ${x}`));
  }
  return out;
}

/** What makes the page wider than the screen, if anything: the deepest element that does, found by hiding each in
 * turn (a name a failing test can be read by). */
async function sideways(page: Page): Promise<string[]> {
  const wide = await page.evaluate(() => {
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
  return wide ? [wide] : [];
}

/** What's wrong with the question showing, if anything: the clock over the count before an answer; after it, a
 * column of the answer's panel squeezed to nothing, the line of how everyone answered a few letters wide, „Напред“
 * off the screen's sides (#530: a phone's large text matched the on-its-side layout). */
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
        .map((e) => `out of reach: ${e.className}: ${(e.textContent ?? "").trim().slice(0, 24)}`);
    },
    [selector, scroller ?? ""] as const,
  );
}

/** The words of six letters or fewer broken across two lines in `selector` (none ever is: a word breaks only where
 * it's wider than its cell, and at the usual size or twice it, six letters fit any; #511). */
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
          if (tops.size > 1) out.push(`a word broken: ${word}`);
        }
      }
    }
    return out;
  }, selector);
}

/** What of a place is wrong at this size: the page sideways, a name cut or run into its neighbour (play.ts), a short
 * word of a name or a button broken, a friend's „Дуел“ or a tab past the screen's edge, a place's name at the foot cut
 * („Алмана…“). */
async function placeFlaws(page: Page): Promise<string[]> {
  const names = ".friend-name, .duel-row .who-name, .segmented button, .friend-act, .places-foot a";
  const off = await page.evaluate(() => {
    const out: string[] = [];
    for (const e of document.querySelectorAll(".friend-act, .segmented button, .duel-row"))
      if (e.getBoundingClientRect().right > innerWidth + 1) out.push(`off the screen's edge: ${e.textContent}`);
    for (const a of document.querySelectorAll(".places-foot a"))
      if (a.scrollWidth > a.clientWidth + 1 || getComputedStyle(a).textOverflow === "ellipsis")
        out.push(`a place's name cut: ${a.textContent}`);
    return out;
  });
  return [...(await sideways(page)), ...(await cutOrOverlapping(page)), ...(await brokenWords(page, names)), ...off];
}

/** Answers whatever question shows, without the pointer's checks: at twice the text „Готово“ and „Отговори“ stay at
 * the screen's foot over what scrolls under them, which a player scrolls past and a test's click won't. */
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

/** On to the next question, by „Напред“ (or by itself, if the game moved on first). */
const next = (page: Page) =>
  page
    .locator(".after .up-next-go")
    .dispatchEvent("click", undefined, { timeout: 5000 })
    .catch(() => {}); // moved on by itself

/** How everyone answered, as on a day many have played: its line under every answer's verdict. */
async function aCrowd(page: Page): Promise<void> {
  await page.route("**/api/runs/*/answer", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    if (json?.reveal) json.reveal.crowd = { answers: 240, right: 0.68, today: true };
    await route.fulfill({ response: res, json });
  });
}

/** The game's audio, watched from the page's start: its contexts, and every tone started. */
async function listen(page: Page): Promise<() => Promise<{ contexts: number; state?: string; tones: number }>> {
  await page.addInitScript(() => {
    const w = window as unknown as { contexts: AudioContext[]; tones: number };
    w.contexts = [];
    w.tones = 0;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        w.contexts.push(this);
      }
      override createOscillator(): OscillatorNode {
        w.tones++;
        return super.createOscillator();
      }
    };
  });
  return () =>
    page.evaluate(() => {
      const w = window as unknown as { contexts: AudioContext[]; tones: number };
      return { contexts: w.contexts.length, state: w.contexts[0]?.state, tones: w.tones };
    });
}

/** The questions over and kept in memory: an animation left on the document's timeline kept each question's whole
 * page to the run's end. Chromium's own protocol lists what's cut off from the page but kept. */
async function questionsKept(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("DOM.enable");
  await cdp.send("DOM.getDocument", { depth: -1 });
  const { detachedNodes } = await cdp.send("DOM.getDetachedDomNodes");
  await cdp.detach();
  return detachedNodes
    .map((d) => d.treeNode)
    .filter((n) => n.nodeName === "ARTICLE")
    .map((n) => n.attributes?.join(" ") ?? "");
}

for (const size of sizes)
  for (const text of [100, 200])
    test.describe(`${size.width}×${size.height}, ${text === 100 ? "the usual text" : "twice the text"}`, () => {
      // The laptop a laptop: no touch screen, no phone's way with the page's width.
      const laptop = size.width > 1000;
      test.use({
        viewport: { width: size.width, height: size.height },
        bypassCSP: true,
        ...(laptop ? { isMobile: false, hasTouch: false } : {}),
      });
      const big = text !== 100;

      test("Днес, the day's first question and its result, and a new player's places", async ({ page }) => {
        test.setTimeout(150_000);
        if (big) await textAt(page, text);
        const audio = await listen(page);
        await aCrowd(page);
        await page.goto("/");
        await expect(page.locator(".issue")).toBeVisible();
        await textIs(page, text);
        await settled(page);
        const today = await byDayAndNight(page, async () => {
          const out = await sideways(page);
          // The budget (DESIGN.md, Днес): the issue, then its action, then (for a player) the streak; nothing else.
          const parts = await page.locator("section.today > *").evaluateAll((all) =>
            all
              .filter((el) => (el as HTMLElement).offsetParent !== null || el.childElementCount)
              .map((el) => el.className)
              .filter((c) => !c.includes("notices")),
          );
          if (parts.join(" | ") !== "issue day page-1 | today-side page-2") out.push(`Днес's parts: ${parts}`);
          const go = await page
            .locator(".issue-go")
            .first()
            .evaluate((el) => el.getBoundingClientRect().toJSON());
          if (!big && (go.top < 0 || go.bottom > size.go))
            out.push(`„Започни“ not whole, high enough: ${Math.round(go.top)}–${Math.round(go.bottom)}`);
          return out;
        });
        expect(today, "Днес").toEqual([]);
        // Nothing sounds, nor is started, before a touch.
        expect(await audio()).toEqual({ contexts: 0, state: undefined, tones: 0 });

        // The day's first question, its head with the issue and the clock (every kind's are below), and its answer.
        await startDay(page);
        await expect(page.locator(".question-head")).toContainText("1 от 10", { timeout: 10_000 });
        await settled(page);
        const asked = await byDayAndNight(page, async () => [...(await sideways(page)), ...(await crowded(page))]);
        expect.soft(asked, "the day's first question, asked").toEqual([]);
        await answerAnyhow(page);
        await expect(page.locator(".after .up-next-go")).toBeVisible({ timeout: 40_000 });
        await settled(page);
        const said = await byDayAndNight(page, async () => [...(await sideways(page)), ...(await crowded(page))]);
        expect.soft(said, "the day's first question, answered").toEqual([]);
        // The sounds start with the first tap, and come back with the game from the background, the one audio.
        await expect.poll(audio).toMatchObject({ contexts: 1, state: "running" });
        expect((await audio()).tones).toBeGreaterThan(0);
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await expect.poll(audio).toMatchObject({ contexts: 1, state: "running" });
        // The other nine given up the server's way, and the day's result.
        const { run } = await (await page.request.get("/api/day")).json();
        for (let n = 1; n < 10; n++) {
          await page.request.post(`/api/runs/${run.id}/show`, { data: {} });
          await page.request.post(`/api/runs/${run.id}/start`, { data: { n } });
          await page.request.post(`/api/runs/${run.id}/answer`, { data: { n, answer: null } });
        }
        await page.goto("/");
        await expect(page.locator(".summary")).toBeVisible({ timeout: 10_000 });
        await settled(page);
        expect(await byDayAndNight(page, () => sideways(page)), "the day's result").toEqual([]);

        // A new player's places, the day played.
        for (const path of ["/almanac", "/me", "/avatar", "/friends", "/settings", "/duel/new"]) {
          await page.goto(path);
          await expect(page.locator("main :is(h1, h2)").first()).toBeVisible();
          await settled(page);
          expect.soft(await byDayAndNight(page, () => placeFlaws(page)), path).toEqual([]);
        }
      });

      // Every kind, at its longest, each with its fact as the bank's questions have; close only where an answer can
      // be (a number, an order, pairs, groups).
      for (const how of ["right", "wrong", "close"] as const)
        test(`every kind of question, answered ${how}: what answers it, then the answer and „Напред“`, async ({
          page,
          browserName,
        }) => {
          test.setTimeout(150_000);
          if (big) await textAt(page, text);
          const all = kinds().filter((k) => how !== "close" || closeable(k.q));
          await page.goto("/");
          await textIs(page, text);
          await dealt(
            page,
            "history",
            all.map((k) => k.q.id),
          );
          await page.goto("/play/history");
          await page.getByRole("button", { name: "Продължи", exact: true }).click();
          await page.getByRole("button", { name: "Започни сега" }).click();
          const shot = async (name: string) => {
            const dir = process.env.FIT_SHOTS;
            if (dir)
              await page.screenshot({
                path: `${dir}/${name}-${size.width}x${size.height}${big ? "-2x" : ""}.png`,
                fullPage: big,
              });
          };
          const cells = "article.question :is(.options .option, .match-item, .split-side, .split-card.top)";
          const controls = `article.question :is(.keypad button, .match-item, .split-side, .split-back:not([hidden]),
            .options .option, .answering .btn)`;
          for (const [n, { name, q }] of all.entries()) {
            const where = `${name} (${q.id})`;
            await expect(page.locator(".question-head")).toContainText(`${n + 1} от ${all.length}`, {
              timeout: 10_000,
            });
            await expect(page.locator("article.question .answering")).toBeVisible();
            await settled(page);
            if (how === "right") await shot(`${name}-before`);
            if (n === 3 && how === "right" && browserName === "chromium")
              expect(await questionsKept(page), "the questions over, kept in memory").toEqual([]);
            // At the usual text, what answers it and its action whole in sight; at twice it, each control a scroll
            // away, never only under „Готово“, „Отговори“ or the head, nor off the screen's side.
            const asked = await byDayAndNight(page, async () => [
              ...(await flaws(page)),
              ...(await brokenWords(page, cells)),
              ...(await crowded(page)),
              ...(big ? await outOfReach(page, controls) : await unseenAnswers(page)),
            ]);
            expect.soft(asked, `${where}, asked`).toEqual([]);

            await answerAs(page, q, how);
            await expect(page.locator(".after .up-next-go")).toBeVisible({ timeout: 40_000 });
            await settled(page);
            await shot(`${name}-after-${how}`);
            const said = await byDayAndNight(page, async () => [
              ...(await flaws(page)),
              ...(await brokenWords(page, cells)),
              ...(await crowded(page)),
              ...(big
                ? [
                    // The panel's parts a scroll of the panel away, „Напред“ at its foot over none of them; the
                    // answers (the right one, the whole order) a scroll of the page away, above the panel.
                    ...(await outOfReach(page, ".after > :not(.up-next)", ".after")),
                    ...(await outOfReach(page, "article.question .options .option")),
                  ]
                : [...(await panelFlaws(page)), ...(await answerInPlace(page, q.type))]),
              ...(!big && laptop ? await beside(page) : []),
            ]);
            expect.soft(said, `${where}, answered ${how}`).toEqual([]);
            if (how === "wrong") await rightSaid(page, q);
            await next(page);
          }
        });

      test("a kept player's places: nothing sideways, no name cut, nothing over another", async ({ page, browser }) => {
        test.setTimeout(150_000);
        // A seal in every chapter, facts in the book, a streak, a friend of a long name with a duel played and one
        // asked, the keys to /admin.
        if (big) await textAt(page, text);
        const kept = await keptPlayer(page, browser);
        await knows(page, ["his-002", "mov-001"], Date.now(), true);
        await daysPlayed(page, 1, 2, 3, 4);
        const friend = await page.evaluate(
          async (tag) =>
            ((await (await fetch("/api/friends")).json()).friends as { id: number; tag: string }[]).find(
              (f) => f.tag === tag,
            )?.id,
          kept.tag,
        );
        await page.request.post("/api/duels", { data: { friend } });
        const places = [
          "/",
          "/me",
          `/players/${kept.tag}`,
          "/friends",
          "/almanac",
          "/almanac/history",
          "/almanac/literature",
          `/duel/${kept.duel}`,
          "/duel/new",
          "/admin",
          "/settings",
        ];
        // At twice the text on the narrowest phone, the game's own largest size too (150 %).
        for (const percent of size.width === 320 && big ? [200, 150] : [text]) {
          if (big) await textNow(page, percent);
          const at = big ? `, ${percent} %` : "";
          for (const path of places) {
            await page.goto(path);
            await expect(page.locator("main :is(h1, h2)").first()).toBeVisible();
            // The friend and the duels in, before what they look like is measured.
            if (path === "/friends" || path === "/duel/new")
              await expect(page.locator(".friend, .duel-pick").first()).toBeVisible();
            if (path === "/") await textIs(page, percent);
            await settled(page);
            expect.soft(await byDayAndNight(page, () => placeFlaws(page)), `${path}${at}`).toEqual([]);
            if (path === "/") {
              // The streak's words inside its card.
              const out = await page
                .locator(".streak-chip")
                .evaluate((chip) =>
                  [...chip.querySelectorAll("*")].some(
                    (e) => e.getBoundingClientRect().right > chip.getBoundingClientRect().right + 1,
                  ),
                );
              expect.soft(out, `the streak's words past its card${at}`).toBe(false);
            }
          }
          // A duel's result: its ways on of one width.
          await page.goto(`/duel/${kept.duel}`);
          await expect(page.locator(".duel-side .actions .btn").first()).toBeVisible();
          const widths = await page
            .locator(".duel-side .actions .btn")
            .evaluateAll((all) => all.map((b) => Math.round(b.getBoundingClientRect().width)));
          expect.soft(new Set(widths).size, `the duel's ways on${at}`).toBe(1);
          // A new visitor's cover: the name and „Вход“ apart.
          const cover = await (
            await browser.newContext({ viewport: { width: size.width, height: size.height }, bypassCSP: true })
          ).newPage();
          if (big) await textAt(cover, percent);
          await cover.goto("/");
          await expect(cover.locator(".bar-in")).toBeVisible();
          const [brand, signIn] = await Promise.all(
            [".brand", ".bar-in"].map((s) => cover.locator(s).evaluate((el) => el.getBoundingClientRect().toJSON())),
          );
          expect.soft(brand.right, `the name runs into „Вход“${at}`).toBeLessThanOrEqual(signIn.left + 1);
          await cover.context().close();
        }
      });
    });

/** Where an answer ended, at the usual text: the player's row and the right one under the head and over the panel;
 * a choice's question still whole under the head, unless the panel at its least would cover the rows, and then moved
 * only as far as they need (DESIGN.md, Play). */
async function answerInPlace(page: Page, type: string): Promise<string[]> {
  return page.evaluate((type) => {
    const out: string[] = [];
    const after = document.querySelector(".after") as Element;
    const foot = getComputedStyle(after).position === "fixed" ? after.getBoundingClientRect().top : innerHeight;
    const head = document.querySelector(".question-top")?.getBoundingClientRect().bottom ?? 0;
    const rows = [...document.querySelectorAll("article.question button.option:is(.right, .wrong)")];
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (r.top < head - 1) out.push(`a row under the head: ${row.textContent}`);
      if (r.bottom > foot + 1) out.push(`a row under the panel: ${row.textContent}`);
    }
    const leaf = document.querySelector("article.question .q-leaf");
    if (!leaf) out.push("no question's sheet (.q-leaf)");
    else if (type === "choice" || type === "clues") {
      const bottom = Math.max(...rows.map((r) => r.getBoundingClientRect().bottom));
      if (leaf.getBoundingClientRect().top < head - 1 && !(bottom > foot - 24))
        out.push("the question went under the head, further than the rows needed");
    }
    return out;
  }, type);
}

/** A miss of a choice says the right answer in words, in the panel right under the verdict and how many got it (when
 * that's said); not where the question names it, nor under a choice of pictures, each named under it. */
async function rightSaid(page: Page, q: Q): Promise<void> {
  if (q.type !== "choice" && q.type !== "clues") return;
  const word = String(q.answer).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, "iu").test(q.text);
  const said = page.locator(".after .right-said");
  if (q.pictures || named) return expect.soft(said, `${q.id}: the right answer said again`).toHaveCount(0);
  await expect
    .soft(page.locator(".after > .verdict + .right-said, .after > .verdict + .crowd-says + .right-said"), q.id)
    .toHaveText(`Вярно е: ${q.answer}.`);
}

/** The browser's own text size (its setting, not the page's): in Chromium the font size it starts every page at,
 * which also sizes the rem of a media query, as a phone's large text does (#530); elsewhere the page's root, as
 * textAt (twice the text is the loop's above). */
async function browserTextAt(page: Page, px: number): Promise<void> {
  if (page.context().browser()?.browserType().name() !== "chromium") return textAt(page, (px / 16) * 100);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  await cdp.send("Page.setFontSizes", { fontSizes: { standard: px, fixed: px } });
}

test.describe("every kind of question at a phone's own large text, 24 and 32px, on a 320px phone", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const px of [24, 32])
    test(`at ${px}px: its head, its answer's panel and „Напред“ on the screen, nothing sideways`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium" && px === 32, "the page's twice the text, the loop's above");
      test.setTimeout(150_000);
      await browserTextAt(page, px);
      await aCrowd(page);
      const each = async (where: string) => {
        await expect(page.locator("article.question .answering")).toBeVisible({ timeout: 10_000 });
        await settled(page);
        expect([...(await crowded(page)), ...(await sideways(page))], `${where}, asked`).toEqual([]);
        await answerAnyhow(page);
        await expect(page.locator(".after .up-next-go")).toBeVisible({ timeout: 40_000 });
        await settled(page);
        expect([...(await crowded(page)), ...(await sideways(page))], `${where}, answered`).toEqual([]);
      };
      // The day's first question: its head has the issue and the clock.
      await page.goto("/");
      await startDay(page);
      await each("the day's first question");
      // Then one of each kind, a picture's too.
      await page.goto("/");
      const ids = kinds().map((k) => k.q.id);
      await dealt(page, "history", ids);
      await page.goto("/play/history");
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      await page.getByRole("button", { name: "Започни сега" }).click();
      for (let n = 0; n < ids.length; n++) {
        await expect(page.locator(".question-head")).toContainText(`${n + 1} от ${ids.length}`, { timeout: 10_000 });
        await each(`question ${n + 1}`);
        await next(page);
      }
    });
});

// A laptop's short screen (a browser's bars take what's left of 768): every kind, at its longest, has its action
// („Готово“, „Отговори“) in sight while the clock runs, and its answer beside it, the fact whole in sight.
test.describe("on a laptop, 1366 × 650", () => {
  test.use({ viewport: { width: 1366, height: 650 }, isMobile: false, hasTouch: false });

  for (const how of ["right", "wrong"] as const)
    test(`every kind of question, answered ${how}: its action in sight, then the answer beside it`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const all = kinds();
      await page.goto("/");
      await dealt(
        page,
        "history",
        all.map((k) => k.q.id),
      );
      await page.goto("/play/history");
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      await page.getByRole("button", { name: "Започни сега" }).click();
      for (const [n, { name, q }] of all.entries()) {
        const where = `${name} (${q.id})`;
        await expect(page.locator(".question-head")).toContainText(`${n + 1} от ${all.length}`, { timeout: 10_000 });
        await expect(page.locator("article.question .answering")).toBeVisible();
        await settled(page);
        if (["number", "order", "match"].includes(q.type)) {
          const box = await page.locator(".answering .btn.primary").first().boundingBox();
          expect.soft(box && box.y + box.height, `${where}: its action below the screen`).toBeLessThanOrEqual(650);
        }
        await answerAs(page, q, how);
        await expect(page.locator(".after .up-next-go")).toBeVisible({ timeout: 40_000 });
        await settled(page);
        expect.soft(await beside(page), `${where}, answered ${how}`).toEqual([]);
        if (how === "wrong") await rightSaid(page, q);
        await next(page);
      }
    });
});

test.describe("turned", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test.skip(({ browserName }) => browserName === "firefox", "a computer's Firefox has no touch screen");

  test("a phone turned mid-question has the head small on its side, and its size back upright", async ({ page }) => {
    await page.goto("/");
    await startDay(page);
    const head = page.locator(".question-top");
    await expect(page.locator(".question-head")).toContainText("1 от 10");
    await expect(head).not.toHaveClass(/stuck/);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(head).toHaveClass(/stuck/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(head).not.toHaveClass(/stuck/);
    await expect(head).toHaveCSS("margin-bottom", "0px");
  });
});

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
      await expect(page.locator("main :is(h1, h2)").first()).toBeVisible();
      expect(await smallTargets(page), path).toEqual([]);
    }
  });
});

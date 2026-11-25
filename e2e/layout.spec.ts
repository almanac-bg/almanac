// The look fits (DESIGN.md, Fit and Large text), held in one place: at a 320 × 568 phone, Safari's 375 × 600 and
// 390 × 664, and a 1366 × 900 laptop, at the usual text and at twice it (a phone's own setting), each screen looked at by day and by night:
//
// - Днес keeps its budget in the HTML's order and shows „Започни“ whole and high; the day's first question (its head
//   has the issue and the clock), its answer and the day's result scroll nowhere sideways, the clock never over the count, the answer's panel never squeezed.
// - Every kind of question (the longest the tests' bank has, the real bank's orders, pairs, choices and a portrait
//   where it's here: kinds.ts, bank.ts), answered right, wrong and close: from 375 × 600 at the usual
//   text what answers it and its action whole in sight, nothing under the action (at 320 × 568 every control a
//   scroll away, the first answer in sight; a picture never under 120px); once answered the player's row,
//   the right one and „Напред“, nothing under „Напред“ (on a laptop, the answer under what answered it, beside the
//   question); the question's words with their spaces, however it's cut; at twice the
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
import {
  befriend,
  cutOrOverlapping,
  dayAs,
  daysPlayed,
  dealt,
  givenUp,
  keptPlayer,
  knows,
  linkedNames,
  longestNational,
  mailedCode,
  moveOn,
  playedBefore,
  playRun,
  ranked,
  rose,
  startDay,
} from "./play.ts";

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

/** The question as it reads (its innerText: what's drawn, what's copied) has its words and the spaces between them,
 * as the bank has it: a -webkit-box line-clamp drew a cell's whole words (wholeWords) with no space between them in
 * Chromium („българскитепланини“). Read in Chromium only: WebKit's innerText leaves out the space where a line wraps,
 * spaces drawn or not. */
async function spaced(page: Page, q: Q): Promise<string[]> {
  const shown = await page
    .locator("article.question .ask")
    .first()
    // biome-ignore lint/performance/useDomNodeTextContent: the check is of the text as drawn, which only innerText reads
    .evaluate((e) => (e as HTMLElement).innerText);
  const plain = (s: string) => s.replaceAll("\u00ad", "").replace(/\s+/g, " ").trim();
  const [says, all] = [plain(shown), plain(q.text)];
  if (says === all) return [];
  // Cut to leave its rows room (answering.ts, clamp): its first words, whole, and „…“.
  const head = says.endsWith("…") ? says.slice(0, -1) : null;
  const whole = head !== null && all.startsWith(head) && /^[\s,;:—–-]/.test(all.slice(head.length));
  return whole ? [] : [`the question reads „${says}“`];
}

/** A question asked from 375 × 600 up, at the usual text: the page doesn't scroll at all (a picture's question scrolled
 * by 4–11px at 390 × 664). Where the page may scroll (320 × 568, twice the text), the question isn't cut („…“) to
 * spare a scroll: its task is read whole. */
async function askedFits(page: Page, scrolls: boolean): Promise<string[]> {
  return page.evaluate((scrolls) => {
    const out: string[] = [];
    const over = document.documentElement.scrollHeight - innerHeight;
    if (!scrolls && over > 0) out.push(`the page scrolls by ${over}px`);
    if (scrolls && document.querySelector("article.question .ask[data-cut]"))
      out.push("the question cut, the page scrolling");
    return out;
  }, scrolls);
}

/** An answer's panel packed (its parts at its gap, none pulled apart, „Напред“ at its own height: a panel stretched
 * to a height of its own swelled it from 56 to 80px), and a choice's „ти“, share and sign beside its words where one
 * line has room for them all (never dropped under one short word: #604's 9rem basis). */
async function packed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const after = document.querySelector<HTMLElement>(".after");
    if (!after) return ["no answer's panel"];
    const gap = Number.parseFloat(getComputedStyle(after).rowGap) || 0;
    const flow = [...after.children].filter(
      (e): e is HTMLElement =>
        e instanceof HTMLElement && e.offsetHeight > 0 && getComputedStyle(e).position === "static",
    );
    flow.slice(1).forEach((e, i) => {
      const prev = flow[i] as HTMLElement;
      const apart = e.offsetTop - (prev.offsetTop + prev.offsetHeight);
      if (e.offsetLeft === prev.offsetLeft && apart > gap + 1) out.push(`${e.className} ${Math.round(apart)}px apart`);
    });
    const go = after.querySelector<HTMLElement>(".up-next-go");
    const tall = Number.parseFloat(getComputedStyle(go ?? after).minHeight) || 0;
    if (go && go.offsetHeight > tall + 1) out.push(`„Напред“ ${go.offsetHeight}px tall, not ${tall}px`);
    for (const row of document.querySelectorAll<HTMLElement>(".choices > .option:is(.right, .wrong)")) {
      const words = row.querySelector<HTMLElement>(".option-words");
      const end = row.querySelector<HTMLElement>(".row-end");
      const letter = row.querySelector<HTMLElement>(".letter");
      if (!words || !end || !letter || getComputedStyle(end).position === "absolute") continue;
      if (end.offsetTop < words.offsetTop + words.offsetHeight - 1) continue; // beside them
      const range = document.createRange();
      range.selectNodeContents(words);
      const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      const style = getComputedStyle(row);
      const inner = row.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      const gaps = 2 * (Number.parseFloat(style.columnGap) || 0);
      if (lines === 1 && range.getBoundingClientRect().width + end.offsetWidth + letter.offsetWidth + gaps <= inner)
        out.push(`what the answer brings under one line of words with room for it: ${words.textContent}`);
    }
    return out;
  });
}

/** On the smallest phone, where the page may scroll (DESIGN.md, Play): what answers a question starts in sight (its
 * first answer, row, cell or key whole on the first screen, under the head), and a picture over a question is still a
 * picture (120px tall at the least), at every size. */
async function startsInSight(page: Page, scrolls: boolean): Promise<string[]> {
  return page.evaluate((scrolls) => {
    const out: string[] = [];
    const pic = document.querySelector("article.question > .picture")?.getBoundingClientRect();
    if (pic && pic.height < 119) out.push(`the picture shrunk to ${Math.round(pic.height)}px`);
    if (!scrolls) return out;
    const head = document.querySelector(".question-top")?.getBoundingClientRect().bottom ?? 0;
    const first = document.querySelector(
      `article.question .answering :is(.options > .option, .keypad .key, .match-item, .split-card.top, .tf-options > .option)`,
    );
    const r = first?.getBoundingClientRect();
    if (!r) out.push("nothing that answers it");
    else if (r.top < head - 1 || r.bottom > innerHeight + 0.5)
      out.push(
        `its first answer off the first screen: ${first?.className} [${Math.round(r.top)}–${Math.round(r.bottom)}]`,
      );
    return out;
  }, scrolls);
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

/** The long words of players' names in `selector` broken anywhere but at a syllable, where a hyphen shows (a soft
 * hyphen: ui.ts, nameWords), in either alphabet („Maximilia / n“ once); or at figures, which no syllable saves (a name
 * ending in a year: DESIGN.md, Names). */
async function offSyllable(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const out: string[] = [];
    for (const cell of document.querySelectorAll(selector)) {
      const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        const text = node.textContent ?? "";
        const top = (i: number) => {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          // Its last box: Chromium gives a letter after a broken soft hyphen the hyphen's box too, on the line before.
          const r = [...range.getClientRects()].filter((r) => r.width).at(-1);
          return r ? Math.round(r.top) : null;
        };
        for (const m of text.matchAll(/[\p{L}\p{N}­]{7,}/gu)) {
          let was = top(m.index);
          for (let i = m.index + 1; i < m.index + m[0].length; i++) {
            const now = top(i);
            if (now === null) continue;
            const figures = /\p{N}/u.test(text[i - 1] ?? "") || /\p{N}/u.test(text[i] ?? "");
            if (was !== null && now > was + 2 && text[i - 1] !== "­" && !figures)
              out.push(`a name broken off its syllables: ${m[0].replaceAll("­", "")}`);
            was = now;
          }
        }
      }
    }
    return out;
  }, selector);
}

/** What of a place is wrong at this size: the page sideways, a name cut or run into its neighbour (play.ts), a short
 * word of a name or a button broken, a friend's „Дуел“, a tab or a duel's card past the screen's edge, a place's name
 * at the foot cut („Алмана…“). */
async function placeFlaws(page: Page): Promise<string[]> {
  const names = ".friend-name, .duel-card-name, .segmented button, .friend-act, .places-foot a";
  const off = await page.evaluate(() => {
    const out: string[] = [];
    for (const e of document.querySelectorAll(".friend-act, .segmented button, .duel-card"))
      if (e.getBoundingClientRect().right > innerWidth + 1) out.push(`off the screen's edge: ${e.textContent}`);
    for (const a of document.querySelectorAll(".places-foot a"))
      if (a.scrollWidth > a.clientWidth + 1 || getComputedStyle(a).textOverflow === "ellipsis")
        out.push(`a place's name cut: ${a.textContent}`);
    return out;
  });
  return [
    ...(await sideways(page)),
    ...(await cutOrOverlapping(page)),
    ...(await linkedNames(page)),
    ...(await brokenWords(page, names)),
    ...(await offSyllable(page, ".name-words")),
    ...off,
  ];
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
      // The smallest phone: the page may scroll there (DESIGN.md, Play).
      const small = size.width < 375;

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
        // The score's ten tiles a finger's size: on the smallest phone two rows of five, not ten specks in one.
        const tile = await page.locator(".score-leaf .tile").first().boundingBox();
        expect.soft(tile?.width ?? 0, "the result's tiles too small").toBeGreaterThanOrEqual(small ? 40 : 24);

        // A new player's places, the day played.
        for (const path of ["/almanac", "/me", "/friends", "/settings"]) {
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
          await page.getByRole("button", { name: "Веднага" }).click();
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
              ...(browserName === "chromium" ? await spaced(page, q) : []),
              ...(await flaws(page)),
              ...(await brokenWords(page, cells)),
              ...(await crowded(page)),
              // From 375 × 600 up the question and what answers it fit; on a 320 × 568 phone (and at twice the
              // text) the page may scroll, nothing under anything, what answers it starting in sight.
              ...(big || small ? await outOfReach(page, controls) : await unseenAnswers(page)),
              ...(await startsInSight(page, small && !big)),
              ...(await askedFits(page, big || small)),
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
                    ...(laptop ? [] : await landed(page)),
                  ]
                : [...(await panelFlaws(page)), ...(await answerInPlace(page)), ...(await packed(page))]),
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
          // A played duel's card, first of the played (its old page goes there).
          `/friends?duel=${kept.duel}`,
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
            if (path.startsWith("/friends")) await expect(page.locator(".friend, .duel-card").first()).toBeVisible();
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
              // „Започни“ (or „Продължи“) on the first screen, over the places' bar, at every text size.
              const go = await page.evaluate(() => {
                const bar = document.querySelector(".places-foot")?.getBoundingClientRect();
                const go = document.querySelector(".issue-go")?.getBoundingClientRect();
                return go ? go.bottom - (bar?.height ? bar.top : innerHeight) : 0;
              });
              expect.soft(go, `„Започни“ under the places' bar${at}`).toBeLessThanOrEqual(1);
            }
          }
          // A new visitor's cover: the mark where the bar always has it, the name and „Вход“ apart; the sign-in page
          // the mark alone, its flaws none.
          const cover = await (
            await browser.newContext({ viewport: { width: size.width, height: size.height }, bypassCSP: true })
          ).newPage();
          if (big) await textAt(cover, percent);
          const box = (s: string) => cover.locator(s).evaluate((el) => el.getBoundingClientRect().toJSON());
          await cover.goto("/almanac");
          await expect(cover.locator(".bar-in")).toBeVisible();
          const always = await box(".brand");
          await cover.goto("/");
          await expect(cover.locator(".bar-in")).toBeVisible();
          const [brand, signIn] = await Promise.all([box(".brand"), box(".bar-in")]);
          expect.soft(Math.round(brand.left), `the cover's mark moved${at}`).toBe(Math.round(always.left));
          expect.soft(brand.right, `the name runs into „Вход“${at}`).toBeLessThanOrEqual(signIn.left + 1);
          await cover.locator(".bar-in").click();
          await expect(cover).toHaveURL(/\/signin$/);
          await expect(cover.getByLabel("Имейл")).toBeVisible();
          expect
            .soft(Math.round((await box(".brand")).left), `the sign-in page's mark moved${at}`)
            .toBe(Math.round(always.left));
          await settled(cover);
          expect.soft(await byDayAndNight(cover, () => placeFlaws(cover)), `/signin${at}`).toEqual([]);
          await cover.context().close();
        }
      });

      // What a fresh game never draws: the cover on the longest national day with a friend's duel waiting, a chapter of
      // several pages, and the day's two big moments at once (ten of ten, a best rank risen to „Страница“, the longest
      // rank's name), the player's name ending in figures beside „ти“ on the day's board.
      test("a long-time player's moments: a national day, a chapter's pages, ten of ten and a best rank risen", async ({
        page,
      }) => {
        test.setTimeout(150_000);
        if (big) await textAt(page, text);
        await dayAs(page, (day) => {
          day.national = longestNational;
          day.duel = { id: 1, from: { name: "Maximilian von Bulgarien", look: { avatar: "fox" } }, more: 2 };
          const run = day.run as { total: number; rights: number; trail: unknown[] } | null;
          if (run) [run.rights, run.trail] = [run.total, run.trail.map(() => ({ right: true }))];
        });
        await page.route(/\/api\/almanac\?/, async (route) => {
          const res = await route.fetch();
          const p = await res.json();
          if (new URL(route.request().url()).searchParams.get("chapter") === "geography")
            Object.assign(p, {
              found: 95,
              facts: Array.from({ length: 30 }, (_, i) => ({
                id: `geo-${i}`,
                chapter: "geography",
                question: `Въпрос ${i + 1}`,
                answer: `Отговор ${i + 1}`,
                fact: "Факт.",
                at: Date.now() - i * 60_000,
                kind: "day",
                issue: 3,
              })),
            });
          await route.fulfill({ response: res, json: p });
        });
        await page.goto("/");
        await ranked(page, 1);
        await daysPlayed(page, 1, 2, 3);
        await knows(page, ["geo-001"], Date.now(), true);
        await page.request.patch("/api/me", { data: { name: "Константинова2009" } });
        const passes = size.width === 320 && big ? [200, 150] : [text];
        for (const percent of passes) {
          if (big) await textNow(page, percent);
          const at = big ? `, ${percent} %` : "";
          await page.goto("/");
          await expect(page.locator(".issue-national")).toHaveText(longestNational);
          await expect(page.locator(".duel-waiting")).toBeVisible();
          await textIs(page, percent);
          await settled(page);
          expect.soft(await byDayAndNight(page, () => placeFlaws(page)), `the national cover${at}`).toEqual([]);
          const cover = await page.evaluate(() => {
            const bar = document.querySelector(".places-foot")?.getBoundingClientRect();
            const go = document.querySelector(".issue-go")?.getBoundingClientRect();
            const words = document.querySelector(".duel-waiting-text");
            const em = words ? Number.parseFloat(getComputedStyle(words).fontSize) : 1;
            return {
              go: go ? [go.top, go.bottom - (bar?.height ? bar.top : innerHeight)] : [],
              duel: (words?.getBoundingClientRect().width ?? 0) / em,
            };
          });
          expect.soft(cover.go[0] ?? -1, `„Започни“ over the screen's top${at}`).toBeGreaterThanOrEqual(0);
          expect.soft(cover.go[1] ?? 1, `„Започни“ under the places' bar${at}`).toBeLessThanOrEqual(1);
          // The duel's line a line's width, not a word or two to a line.
          expect.soft(cover.duel, `the duel's line in em${at}`).toBeGreaterThanOrEqual(5);
          await page.goto("/almanac/geography");
          await expect(page.locator(".chapter-facts .pages")).toBeVisible();
          await settled(page);
          expect.soft(await byDayAndNight(page, () => placeFlaws(page)), `a chapter's pages${at}`).toEqual([]);
          const off = await page
            .locator(".chapter-facts .pages > *")
            .evaluateAll((all) =>
              all
                .filter((e) => e.getBoundingClientRect().left < 0 || e.getBoundingClientRect().right > innerWidth)
                .map((e) => e.textContent),
            );
          expect.soft(off, `a chapter's pages past the screen${at}`).toEqual([]);
        }
        // The day played (as the server has it, none right; drawn all right), three chapters risen to „Страница“,
        // the best rank with them.
        const run = (await (await page.request.post("/api/day", { data: {} })).json()) as { id: number };
        await givenUp(page, run.id);
        for (const percent of passes) {
          if (big) await textNow(page, percent);
          const at = big ? `, ${percent} %` : "";
          await rose(page, 2, ["history", "movies", "sports"]);
          await page.goto("/");
          await expect(page.locator(".result .perfect")).toBeVisible();
          await expect(page.locator(".rankup .rankup-name")).toHaveText("Страница");
          await settled(page);
          expect.soft(await byDayAndNight(page, () => placeFlaws(page)), `ten of ten, a rank risen${at}`).toEqual([]);
          const lines = await page.evaluate(() =>
            [".score-n", ".score-kicker", ".rankup-name"].map((s) => {
              const el = document.querySelector(s);
              if (!el) return `${s} missing`;
              const r = el.getBoundingClientRect();
              const n = Math.round(r.height / Number.parseFloat(getComputedStyle(el).lineHeight));
              return n === 1 || (s === ".score-kicker" && n <= 2) ? "" : `${s} on ${n} lines: „${el.textContent}“`;
            }),
          );
          expect.soft(lines.filter(Boolean), `the big moments' words${at}`).toEqual([]);
        }
      });
    });

/** Where the page landed for an answer with large text on a phone (the panel under the answers, „Напред“ stuck at
 * the screen's foot over what scrolls under it): the head's foot between two parts, never across one; the verdict
 * under the head; the fact's first line whole over „Напред“'s foot (its fade with it), or, where the verdict and what
 * it says leave no room for it, the fact whole under the foot, a scroll away (DESIGN.md, Play). */
async function landed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
    const head = box(".question-top")?.bottom ?? 0;
    for (const el of document.querySelectorAll(
      "article.question > :is(.q-leaf, .picture), article.question .answering :is(.option, .hint, .clues > *, .clues-next)",
    )) {
      const r = el.getBoundingClientRect();
      if (r.height && r.top < head - 1 && r.bottom > head + 1)
        out.push(`cut by the head: ${el.className} [${Math.round(r.top)}–${Math.round(r.bottom)}]`);
    }
    const verdict = box(".after > .verdict");
    const foot = box(".after .after-foot")?.top ?? innerHeight;
    if (!verdict) return [...out, "no verdict"];
    if (verdict.top < head - 1) out.push(`the verdict under the head [${Math.round(verdict.top)}]`);
    const line = document.querySelector<HTMLElement>(".after .fact p:last-child");
    const told = line
      ? line.getBoundingClientRect().top + (Number.parseFloat(getComputedStyle(line).lineHeight) || 24)
      : verdict.bottom;
    const fact = line?.parentElement?.getBoundingClientRect();
    const room = told - verdict.top <= foot - head - 12;
    if (told > foot + 1 && (room || !fact || fact.top < foot - 1))
      out.push(`the fact's first line under „Напред“ [${Math.round(told)} > ${Math.round(foot)}]`);
    return out;
  });
}

/** Where an answer ended, at the usual text: the player's row and the right one under the head and over „Напред“;
 * nothing over the answers (the panel under them, never across a row: a docked panel cut them); the verdict in sight
 * over „Напред“; the page moved no further than to show the fact's first two lines over it, or on to the edge of
 * what the head would cut there; never a scrap of the sheet, the picture or a row left under the head's foot
 * (DESIGN.md, Play). */
async function answerInPlace(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const after = document.querySelector(".after") as HTMLElement;
    const foot = after.querySelector(".after-foot") as HTMLElement;
    const sticky = getComputedStyle(foot).position === "sticky";
    const footH = sticky ? foot.getBoundingClientRect().height : 0;
    const footTop = sticky ? foot.getBoundingClientRect().top : innerHeight;
    const head = document.querySelector(".question-top")?.getBoundingClientRect().bottom ?? 0;
    const rows = [...document.querySelectorAll("article.question button.option:is(.right, .wrong)")];
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (r.top < head - 1) out.push(`a row under the head: ${row.textContent}`);
      if (r.bottom > footTop + 1) out.push(`a row under „Напред“: ${row.textContent}`);
    }
    const parts = [
      ...document.querySelectorAll(
        "article.question > :is(.q-leaf, .picture), article.question .answering :is(.options > *, .clues > *, .clues-next)",
      ),
    ].map((el) => ({ el, r: el.getBoundingClientRect() }));
    for (const { el, r } of parts)
      if (r.height && r.top < head - 1 && r.bottom > head + 1 && !rows.includes(el))
        out.push(`a scrap under the head: ${el.className} [${Math.round(r.top)}–${Math.round(r.bottom)}]`);
    // Nothing over the answers: the panel comes under them.
    const panel = after.getBoundingClientRect();
    for (const { el, r } of parts)
      if (r.height && el.closest(".answering") && r.bottom > panel.top + 1)
        out.push(`a row under the panel: ${el.className} [${Math.round(r.top)}–${Math.round(r.bottom)}]`);
    const verdict = after.firstElementChild?.getBoundingClientRect();
    if (!verdict || verdict.top < head - 1 || verdict.bottom > footTop + 1) out.push("the verdict out of sight");
    const fact = after.querySelector<HTMLElement>(".fact p:last-child");
    const lines = fact
      ? fact.getBoundingClientRect().top + 2 * (Number.parseFloat(getComputedStyle(fact).lineHeight) || 24)
      : (verdict?.bottom ?? 0);
    const need = scrollY + lines + footH + 8 - innerHeight;
    const edge = parts.some(({ r }) => r.height && Math.abs(r.bottom - head) <= 2);
    // (On a laptop the panel beside the question shows whole: beside, below.)
    const sheet = document.querySelector("article.question .q-leaf")?.getBoundingClientRect();
    const besides = !!sheet && panel.left >= sheet.right;
    if (!besides && scrollY > Math.max(0, need) + 2 && !edge)
      out.push(`moved ${Math.round(scrollY - need)}px further than it needs`);
    return out;
  });
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
      await page.getByRole("button", { name: "Веднага" }).click();
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
      await page.getByRole("button", { name: "Веднага" }).click();
      for (const [n, { name, q }] of all.entries()) {
        const where = `${name} (${q.id})`;
        await expect(page.locator(".question-head")).toContainText(`${n + 1} от ${all.length}`, { timeout: 10_000 });
        await expect(page.locator("article.question .answering")).toBeVisible();
        await settled(page);
        if (["number", "order", "match"].includes(q.type)) {
          const box = await page.locator(".answering .btn.primary").first().boundingBox();
          expect.soft(box && box.y + box.height, `${where}: its action below the screen`).toBeLessThanOrEqual(650);
        }
        // A picture over the question: right under its sheet, and whole on the screen with it.
        if (q.image) {
          const at = await page.evaluate(() => {
            const sheet = document.querySelector(".run-question > .q-leaf")?.getBoundingClientRect();
            const pic = document.querySelector(".run-question > .picture")?.getBoundingClientRect();
            return sheet && pic ? { gap: pic.top - sheet.bottom, bottom: pic.bottom } : null;
          });
          expect.soft(at?.bottom, `${where}: its picture below the screen`).toBeLessThanOrEqual(650);
          expect.soft(at?.gap, `${where}: its picture away from its sheet`).toBeLessThanOrEqual(24);
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

// A number's pad has the most to fit under its question: on a phone of a usual height, the longest number question
// the bank has (the real bank's too, where it's here) leaves the pad and „Отговори“ whole in sight under it.
test.describe("a number's pad on a 375 × 812 phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("the longest number questions: every key and „Отговори“ in sight", async ({ page }) => {
    const all = kinds().filter((k) => k.q.type === "number");
    await page.goto("/");
    await dealt(
      page,
      "history",
      all.map((k) => k.q.id),
    );
    await page.goto("/play/history");
    await page.getByRole("button", { name: "Продължи", exact: true }).click();
    await page.locator(".get-ready .btn.primary").click();
    for (const [n, { name, q }] of all.entries()) {
      await expect(page.locator(".question-head")).toContainText(`${n + 1} от ${all.length}`, { timeout: 10_000 });
      await expect(page.locator("article.question .keypad")).toBeVisible();
      await settled(page);
      expect.soft(await unseenAnswers(page), `${name} (${q.id})`).toEqual([]);
      await answerAs(page, q, "right");
      await expect(page.locator(".after .up-next-go")).toBeVisible({ timeout: 40_000 });
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

test("a switch in Настройки is its whole row to tap, words and all", async ({ page }) => {
  await page.goto("/settings");
  const sounds = page.getByRole("switch", { name: "Звуци" });
  const was = await sounds.getAttribute("aria-checked");
  await sounds.locator("xpath=ancestor::label").locator(".switch-text").click();
  await expect(sounds).not.toHaveAttribute("aria-checked", was ?? "");
});

test("Настройки' three-way switch: every choice on one line, on a 320px phone too", async ({ page }) => {
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/settings");
    const choices = page.getByRole("radio");
    await expect(choices.first()).toBeVisible();
    const lines = await choices.evaluateAll((all) =>
      all.map((b) => {
        const r = document.createRange();
        r.selectNodeContents(b);
        return `${b.textContent}: ${r.getClientRects().length}`;
      }),
    );
    expect(lines, `${width}px`).toEqual(lines.map((l) => l.replace(/\d+$/, "1")));
  }
});

// Between a phone and a laptop (a tablet upright), the page a phone's column in the middle, the places' bar under it
// as wide: never a phone's page stretched from edge to edge. (A laptop with the browser's text at twice its size is the
// same case, its media queries counted in that text; a style on the page, as textAt sets it, doesn't move them.)
test.describe("a tablet, 768 × 1024", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("a phone's column, in the middle", async ({ page }) => {
    for (const path of ["/", "/almanac", "/friends"]) {
      await page.goto(path);
      await expect(page.locator("main :is(h1, h2)").first()).toBeAttached();
      const [main = 0, bar = 0] = await page.evaluate(() =>
        ["#main", ".places-foot"].map((s) => document.querySelector(s)?.getBoundingClientRect().width ?? 0),
      );
      expect.soft(main, `${path}: the column`).toBeLessThanOrEqual(40 * 16 + 1);
      expect.soft(bar, `${path}: the places' bar`).toBeLessThanOrEqual(40 * 16 + 1);
    }
  });
});

// The pages of a list (a chapter's facts, every duel played) at twice the text on a phone: „Страница 2 от 4“ on a line
// of its own, „По-нови“ and „По-стари“ under it, whole, nothing sideways.
test.describe("a list's pages, twice the text, 375 × 667", () => {
  test.use({ viewport: { width: 375, height: 667 }, bypassCSP: true });

  test("a chapter's pages and the duels played turn whole on the screen", async ({ page }) => {
    await textAt(page, 200);
    const found = 95;
    await page.route(/\/api\/almanac\?/, async (route) => {
      const facts = Array.from({ length: 30 }, (_, i) => ({
        id: `geo-${i}`,
        chapter: "geography",
        question: `Въпрос ${i + 1}`,
        answer: `Отговор ${i + 1}`,
        fact: "Факт.",
        at: Date.now() - i * 60_000,
        kind: "day",
        issue: 3,
      }));
      await route.fulfill({ json: { facts, found, ink: { geography: 0 } } });
    });
    const duel = (id: number) => ({
      id,
      state: "won",
      you: { name: "Заек 817", rights: 7, done: true, look: { avatar: "hare" } },
      opponent: { name: `Мария ${id}`, tag: `maria${id}`, rights: 5, done: true, look: { avatar: "fox" } },
      runId: id,
      first: true,
      createdAt: Date.now(),
      endedAt: Date.now(),
    });
    const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => duel(from - i));
    await page.route("**/api/duels", (r) =>
      r.fulfill({ json: { yours: [], theirs: [], played: ids(23, 10), playedAll: 23 } }),
    );
    await page.route("**/api/duels/played?page=*", (r) =>
      r.fulfill({ json: { duels: ids(23, 10), page: 1, pages: 3 } }),
    );
    await page.goto("/");
    await knows(page, ["geo-961"]);
    await page.goto("/almanac/geography");
    await textIs(page, 200);
    const pages = page.locator(".chapter-facts .pages");
    await expect(pages).toBeVisible();
    await settled(page);
    expect(await sideways(page), "a chapter").toEqual([]);
    const whole = (s: string) =>
      page
        .locator(s)
        .evaluateAll((all) =>
          all
            .filter((e) => e.getBoundingClientRect().left < 0 || e.getBoundingClientRect().right > innerWidth)
            .map((e) => e.textContent),
        );
    expect(await whole(".chapter-facts .pages > *"), "a chapter's pages").toEqual([]);
    await page.goto("/friends");
    await page.getByRole("button", { name: /^Всички завършени дуели/ }).click();
    const box = page.getByRole("dialog", { name: "Завършени дуели" });
    await expect(box.locator(".pages")).toBeAttached();
    expect(await whole(".duels-all .pages > *"), "the duels played").toEqual([]);
  });
});

// A laptop at 200 % zoom (1280 × 800 is 640 × 400), a mouse: laid out as a phone on its side, the places in the bar at
// the top (one at the foot took „Започни“ under it), the game's question within the height.
test.describe("a short wide window with a mouse, 640 × 400", () => {
  test.use({ viewport: { width: 640, height: 400 }, isMobile: false, hasTouch: false });

  test("„Започни“ in sight, nothing over it; a question within the height", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".issue-go")).toBeVisible();
    const go = await page.evaluate(() => {
      const bar = document.querySelector(".places-foot")?.getBoundingClientRect();
      const go = document.querySelector(".issue-go")?.getBoundingClientRect();
      return go ? go.bottom - (bar?.height ? bar.top : innerHeight) : 0;
    });
    expect(go, "„Започни“ under the places or the screen's foot").toBeLessThanOrEqual(1);
    expect(await sideways(page)).toEqual([]);
    await startDay(page);
    await expect(page.locator(".question-head")).toContainText("1 от 10");
    await expect(page.locator(".question-top")).toHaveClass(/stuck/);
  });
});

// A phone on its side: the count's „Отказ“ and a duel's „Започни“ in sight, the screen's height not grown past by the
// ring centred for an upright phone, nor by the faces over a duel's start (the review of #712 found both below it).
for (const viewport of [
  { width: 568, height: 320 },
  { width: 844, height: 390 },
]) {
  test.describe(`a phone on its side, ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    const inSight = (page: Page, selector: string) =>
      page.evaluate((selector) => {
        const r = document.querySelector(selector)?.getBoundingClientRect();
        return r ? r.bottom <= innerHeight + 1 : false;
      }, selector);

    test("the count's „Отказ“ and a duel's „Започни“ within the screen", async ({ page, browser }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Започни", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
      expect(await inSight(page, ".get-ready .actions .btn:last-child"), "„Отказ“").toBe(true);

      const other = await (await browser.newContext()).newPage();
      await befriend(page, other);
      const me = await page.evaluate(async () => (await (await fetch("/api/me")).json()).user.id as number);
      const made = await (await other.request.post("/api/duels", { data: { friend: me } })).json();
      const run =
        made.duel.runId ??
        (await (await other.request.post(`/api/duels/${made.duel.id}/play`, { data: {} })).json()).duel.runId;
      await givenUp(other, run); // sent once its first player has played it
      await other.context().close();
      await page.goto(`/duel/${made.duel.id}`);
      await expect(page.getByRole("button", { name: "Започни", exact: true })).toBeVisible();
      expect(await inSight(page, ".get-ready .btn.primary"), "„Започни“").toBe(true);
    });
  });
}

test.describe("on a laptop, Настройки and Вход", () => {
  test.use({ viewport: { width: 1366, height: 900 }, isMobile: false, hasTouch: false });

  test("are Профил's width: a field, a switch no further from its words", async ({ page }) => {
    for (const path of ["/signin", "/settings"]) {
      await page.goto(path);
      await expect(page.locator("main :is(h1, h2)").first()).toBeVisible();
      const wide = await page.locator("main .screen").evaluate((s) => s.getBoundingClientRect().width);
      expect(wide, path).toBeLessThanOrEqual(40 * 16 + 1);
    }
  });
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
    for (const path of ["/", "/settings", "/me", "/almanac", "/friends"]) {
      await page.goto(path);
      await expect(page.locator("main :is(h1, h2)").first()).toBeVisible();
      expect(await smallTargets(page), path).toEqual([]);
    }
  });

  test("a kept player's too: a friend, a request each way, Настройки with an email, a day played", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(120_000);
    // A friend (their name a link, „Премахни приятел“ over them), someone asking (their „Откажи“), a request sent to
    // an email and one to a player (their name a link, „Отмени“ beside it), an email to sign in with („Излез“, „Излез
    // от другите устройства“), and the day played, what it wrote in the book („+3 с мастило“, a link).
    const friend = await (await browser.newContext()).newPage();
    const asks = await (await browser.newContext()).newPage();
    const asked = await (await browser.newContext()).newPage();
    await page.goto("/");
    await befriend(page, friend);
    await asks.goto("/friends");
    await asks.locator(".friends").getByRole("button", { name: "Добави приятел" }).click();
    await playedBefore(asks, 1);
    const tag = await page.evaluate(async () => (await (await fetch("/api/me")).json()).user.tag as string);
    await asks.getByLabel("Потребителско име или имейл на приятел").fill(`@${tag}`);
    await asks.getByRole("button", { name: "Добави", exact: true }).click();
    await expect(asks.getByText(/^Поканата до .+ е изпратена\.$/)).toBeVisible();
    await playedBefore(page, 1);
    await page.goto("/friends");
    await page.getByLabel("Потребителско име или имейл на приятел").fill("someone@example.com");
    await page.getByRole("button", { name: "Добави", exact: true }).click();
    await expect(page.locator(".waiting")).toContainText("someone@example.com");
    await asked.goto("/friends");
    await asked.locator(".friends").getByRole("button", { name: "Добави приятел" }).click();
    const player = await asked.evaluate(async () => (await (await fetch("/api/me")).json()).user.tag as string);
    await page.getByLabel("Потребителско име или имейл на приятел").fill(`@${player}`);
    await page.getByRole("button", { name: "Добави", exact: true }).click();
    await expect(page.locator(".waiting li > a")).toHaveCount(1);
    await expect(page.locator(".invitation")).toHaveCount(1);
    await expect(page.locator(".friend")).toHaveCount(1);
    expect(await smallTargets(page), "/friends").toEqual([]);
    await page.getByRole("button", { name: "Премахни приятел" }).click();
    expect(await smallTargets(page), "/friends, changing the list").toEqual([]);
    const email = `finger-${info.project.name}-${Date.now()}@example.com`;
    await page.goto("/settings");
    await page.getByLabel("Имейл").fill(email);
    await page.getByRole("button", { name: "Прати ми код" }).click();
    await expect.poll(() => mailedCode(email)).not.toBe("");
    await page.getByLabel("Код").fill(mailedCode(email));
    await page.getByRole("button", { name: "Потвърди" }).click();
    await expect(page.getByRole("button", { name: "Излез от другите устройства" })).toBeVisible();
    expect(await smallTargets(page), "/settings").toEqual([]);
    await page.route("**/api/me/news", (route) =>
      route.fulfill({
        json: {
          ink: 3,
          chapters: [
            { chapter: "history", ink: 2, facts: ["his-002", "his-003"] },
            { chapter: "movies", ink: 1, facts: ["mov-001"] },
          ],
        },
      }),
    );
    const run = (await (await page.request.post("/api/day", { data: {} })).json()) as { id: number };
    await givenUp(page, run.id);
    await page.goto("/");
    await expect(page.locator(".ink-row")).toBeVisible();
    expect(await smallTargets(page), "/, the day played").toEqual([]);
    await friend.context().close();
    await asks.context().close();
    await asked.context().close();
  });
});

// The questions gone over (the review under a game's result), with twice the text on a 320px phone: a number's scale
// (its numbers, a mark at an end too) and a right answer's long words keep to the screen's width.
test.describe("the questions gone over, twice the text, 320 × 568", () => {
  test.use({ viewport: { width: 320, height: 568 }, bypassCSP: true });

  test("every kind keeps to the screen's width", async ({ page }) => {
    test.setTimeout(150_000);
    await textAt(page, 200);
    // (Not groups: a kind on its way out, slow to play through in WebKit at this size.)
    const all = kinds().filter((k) => k.q.type !== "split");
    await page.goto("/");
    await dealt(
      page,
      "history",
      all.map((k) => k.q.id),
    );
    await page.goto("/play/history");
    await page.getByRole("button", { name: "Продължи", exact: true }).click();
    await page.getByRole("button", { name: "Веднага" }).click();
    for (const [n, { q }] of all.entries()) {
      await expect(page.locator(".question-head")).toContainText(`${n + 1} от ${all.length}`, { timeout: 10_000 });
      await expect(page.locator("article.question .answering")).toBeVisible();
      await answerAs(page, q, "wrong");
      await moveOn(page);
    }
    await page.getByRole("button", { name: "Прегледай въпросите" }).click();
    await expect(page.locator(".number-near").first()).toBeVisible();
    await settled(page);
    expect(await sideways(page)).toEqual([]);
  });
});

// The day's board's rows, on a phone and on a laptop: every row's ten squares start in one column, whatever its
// score's digits („10 от 10“ is wider than „9 от 10“), on both its tabs.
for (const width of [390, 1366])
  test.describe(`the day's board at ${width} px`, () => {
    test.use({
      viewport: { width, height: 900 },
      colorScheme: "light",
      ...(width > 1000 ? { isMobile: false, hasTouch: false } : {}),
    });

    test("every row's squares start in one column", async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto("/");
      await startDay(page);
      await playRun(page);
      await expect(page.locator(".day-board")).toBeVisible();
      // The day as the server says it: a row of every width of score, each with its squares; Днес opened again from
      // another place, so that it asks for the day.
      const row = (name: string, rights: number, place: number, me = false) => ({
        name,
        rights,
        of: 10,
        place,
        me,
        trail: Array.from({ length: 10 }, (_, i) => ({ right: i < rights })),
      });
      const rows = [row("Ана", 10, 1), row("Бо", 9, 2), row("Цвета", 1, 3), row("Аз", 0, 4, true)];
      await page.route("**/api/day", async (route) => {
        const day = await (await route.fetch()).json();
        day.friends = rows;
        day.befriended = true;
        day.board = { ...day.board, players: 53, place: 4, top: rows, mine: rows[3] };
        await route.fulfill({ json: day });
      });
      // The places at the foot on a phone, at the top on a laptop: whichever is shown.
      const places = page.locator(":is(nav.places, nav.places-foot):visible");
      await places.getByRole("link", { name: "Алманах" }).click();
      await places.getByRole("link", { name: "Днес" }).click();
      for (const tab of ["Приятели", "Всички"]) {
        await page.locator(".day-board").getByRole("tab", { name: tab }).click();
        const minis = page.locator(".day-board .rank-row .mini");
        await expect(minis).toHaveCount(4);
        await expect(page.locator(".day-board .rank-row .rank-score").first()).toHaveText(/^10\sот\s10$/);
        const lefts = await minis.evaluateAll((all) => all.map((el) => el.getBoundingClientRect().left));
        expect(Math.max(...lefts) - Math.min(...lefts), `${tab}: the squares start at ${lefts}`).toBeLessThanOrEqual(1);
      }
    });
  });

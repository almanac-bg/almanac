// Every kind of question, as the tests' bank has it at its longest (the sample's, and beside them the real bank's
// longest orders and choices where the real bank is here: bank.ts), answered as a test wants it (right, wrong or
// close), and what a question's screen must never do whatever its size (layout.spec.ts, answer.spec.ts).
import { expect, type Page } from "@playwright/test";
import { bankQuestions, portrait, type Q, sampleIds, words } from "./bank.ts";

export type { Q };

/** How a question is answered: right, wrong, or close (a number near, an order partly right). */
export type How = "right" | "wrong" | "close";

/** Whether a kind of question can be answered close: a number, or an order. */
export const closeable = (q: Q) => ["number", "order"].includes(q.type);

/** One question of each kind, the longest the sample has: a choice, a choice of pictures, a choice under a picture,
 * „Вярно или невярно“, an order and a number; a choice under a portrait (the picture at its tallest), where the
 * sample has one; and of an order, the one with the longest question too, where that's another (a sheet of five lines over the rows); each named. Then, where the real bank is here, the longest of
 * each kind it adds (bank.ts, named so: „order-real“): a run here covers all that a run on CI (the sample alone)
 * does, and the real bank's extremes besides. */
export function kinds(): { name: string; q: Q }[] {
  const all = bankQuestions().filter((q) => !q.retired);
  const sample = sampleIds();
  const own = longestOf(all.filter((q) => sample.has(q.id)));
  const seen = new Set(own.map((k) => k.q.id));
  const real = longestOf(
    all.filter((q) => !sample.has(q.id)),
    "-real",
  ).filter((k) => !seen.has(k.q.id));
  return [...own, ...real];
}

/** The longest of each kind among `qs`, each named (`suffix` after the name): every kind must be there, but for the
 * real bank's additions (`suffix`), which are of a few kinds only. */
function longestOf(qs: Q[], suffix = ""): { name: string; q: Q }[] {
  const out: { name: string; q: Q }[] = [];
  const longest = (f: (q: Q) => boolean, size = words) => {
    const q = qs.filter(f).sort((a, b) => size(b) - size(a))[0];
    if (!q && !suffix) throw new Error("the bank has no such question");
    return q;
  };
  const add = (name: string, q: Q | undefined) => {
    if (q && !out.some((k) => k.q.id === q.id)) out.push({ name: `${name}${suffix}`, q });
  };
  const plain = (type: string) => (q: Q) => q.type === type && !q.image && !q.pictures;
  const asked = (q: Q) => q.text.length;
  add("choice", longest(plain("choice")));
  add(
    "pictures",
    longest((q) => !!q.pictures),
  );
  add(
    "picture",
    longest((q) => q.type === "choice" && !!q.image),
  );
  add("portrait", qs.filter(portrait).sort((a, b) => words(b) - words(a))[0]);
  add("truefalse", longest(plain("truefalse")));
  add("order", longest(plain("order")));
  add("order-asked", longest(plain("order"), asked));
  add("number", longest(plain("number")));
  return out;
}

/** A cell's words as a player reads them (the soft hyphens a long word may break at left out). */
const bare = (s: string | null) => (s ?? "").replaceAll("­", "").trim();

/** Taps what `cells` shows `text` in (its words, its letter or key aside), by a click that needs no room on the
 * screen: at twice the text „Готово“ may be over it, as it is over what scrolls under it. */
async function tapText(page: Page, cells: string, text: string, part = ":scope > span:nth-child(2)"): Promise<void> {
  const all = page.locator(cells);
  const i = await all.evaluateAll(
    (els, [text, part]) =>
      els.findIndex((e) => (e.querySelector(part)?.textContent ?? "").replaceAll("­", "").trim() === text),
    [text, part] as const,
  );
  if (i < 0) throw new Error(`no „${text}“ in ${cells}`);
  await all.nth(i).dispatchEvent("click");
}

/** Answers the question showing (`q`) as `how` says. */
export async function answerAs(page: Page, q: Q, how: How): Promise<void> {
  const ask = page.locator("article.question");
  const tap = (selector: string) => ask.locator(selector).first().dispatchEvent("click");
  const right = how === "right";
  switch (q.type) {
    case "choice":
      if (q.pictures) {
        const alt = q.pictures[right ? 0 : 1]?.alt ?? "";
        const i = await ask
          .locator(".pic-options .option")
          .evaluateAll((els, alt) => els.findIndex((e) => e.getAttribute("aria-label")?.endsWith(alt)), alt);
        await ask.locator(".pic-options .option").nth(i).dispatchEvent("click");
      } else await tapText(page, "article.question .choices > .option", String(right ? q.answer : q.wrong?.[0]));
      return;
    case "truefalse":
      await ask
        .getByRole("button", { name: (q.answer === true) === right ? "Вярно" : "Невярно", exact: true })
        .dispatchEvent("click");
      return;
    case "number": {
      const answer = Number(q.answer);
      const off = how === "right" ? 0 : how === "close" ? 0.5 : 3;
      const value = String(Math.round(answer - off * (q.tolerance ?? 0)));
      for (const k of value)
        await ask.locator(".keypad").getByRole("button", { name: k, exact: true }).dispatchEvent("click");
      await expect(ask.locator(".number-out .typed")).toHaveText(new RegExp(`^${[...value].join("\\s?")}$`));
      await tap(".answering .btn.primary");
      return;
    }
    case "order": {
      const items = [...(q.items ?? [])].sort((a, b) =>
        q.direction === "desc" ? (b.value ?? 0) - (a.value ?? 0) : (a.value ?? 0) - (b.value ?? 0),
      );
      const want = items.map((i) => i.text);
      if (how === "wrong") want.reverse(); // none in its place
      if (how === "close") want.splice(0, 2, want[1] ?? "", want[0] ?? ""); // the first two swapped
      const rows = ask.locator(".sortable-list > .option");
      for (const [place, text] of want.entries()) {
        const now = await rows.evaluateAll((els) =>
          els.map((e) => (e.children[1]?.textContent ?? "").replaceAll("\u00ad", "")),
        );
        const at = now.indexOf(text);
        if (at === place) continue;
        await rows.nth(at).dispatchEvent("click");
        await rows.nth(place).dispatchEvent("click");
        await expect
          .poll(async () => bare(await rows.nth(place).locator(":scope > span:nth-child(2)").textContent()))
          .toBe(text);
      }
      await tap(".answering .btn.primary");
      return;
    }
  }
}

/** What a question's screen does wrong, as it is now: each a line a failing test reads. */
export async function flaws(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > innerWidth + 0.5) out.push(`${root.scrollWidth}px wide`);
    const shown = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    };
    const name = (e: Element) =>
      `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} „${(e.textContent ?? "").replaceAll("­", "").trim().slice(0, 30)}“`;

    // Nothing of the question off the screen's side (where a box that cuts what overflows it would hide it).
    for (const e of document.querySelectorAll("article.question :is(.option, .btn, .link)"))
      if (shown(e)) {
        const r = e.getBoundingClientRect();
        if (r.left < -0.5 || r.right > innerWidth + 0.5) out.push(`off the screen's side: ${name(e)}`);
        // Cut by a box that hides what overflows it (an answer does).
        if (getComputedStyle(e).overflowX !== "visible" && e.scrollWidth > e.clientWidth + 1)
          out.push(`its words cut: ${name(e)}`);
        const box = e.closest(".option");
        if (box && box !== e) {
          const b = box.getBoundingClientRect();
          if (r.left < b.left - 0.5 || r.right > b.right + 0.5) out.push(`out of its answer: ${name(e)}`);
        }
      }

    // A row's sign (✓, ✕) and its value never on a line of their own: each beside something else of its row (the
    // words, the letter, the value, what's with it at the row's end: .row-end), or set in its corner.
    for (const mark of document.querySelectorAll(".option .sign, .option > .value, .option > .row-end > .value")) {
      const set = (e: Element | null) => !!e && getComputedStyle(e).position === "absolute";
      if (!shown(mark) || set(mark) || (mark.parentElement?.matches(".row-end") && set(mark.parentElement))) continue;
      const r = mark.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const near = (box: Element | null | undefined, not: Element) =>
        [...(box?.children ?? [])].filter((e) => e !== not && shown(e));
      let others = near(mark.parentElement, mark);
      // Alone at the row's end: beside the row's own parts, then.
      if (!others.length && mark.parentElement?.matches(".row-end"))
        others = near(mark.closest(".option"), mark.parentElement);
      if (
        !others.some((e) => {
          const o = e.getBoundingClientRect();
          return o.top <= mid && mid <= o.bottom;
        })
      )
        out.push(`on a line of its own: ${name(mark)} in ${name(mark.closest(".option") ?? mark)}`);
    }

    // A punctuation mark never starts a line: it goes with the word before it („революционер?“, never „?“ alone).
    const texts = ".ask, .option, .right-said";
    for (const box of document.querySelectorAll(texts)) {
      if (!shown(box)) continue;
      const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      let before: { node: Text; at: number } | null = null;
      for (let node = walk.nextNode() as Text | null; node; node = walk.nextNode() as Text | null) {
        const s = node.data;
        for (let i = 0; i < s.length; i++) {
          const c = s.charAt(i);
          if (/\s|­/.test(c)) {
            if (/\s/.test(c)) before = null;
            continue;
          }
          if (/[?!.,:;…“»)]/.test(c) && before) {
            const top = (n: Text, k: number) => {
              const range = document.createRange();
              range.setStart(n, k);
              range.setEnd(n, k + 1);
              const rects = [...range.getClientRects()].filter((x) => x.width);
              return rects.length ? Math.round(rects[rects.length - 1]?.top ?? 0) : null;
            };
            const a = top(before.node, before.at);
            const b = top(node, i);
            if (a !== null && b !== null && Math.abs(a - b) > 4) out.push(`„${c}“ alone on a line in ${name(box)}`);
          }
          before = { node, at: i };
        }
      }
    }
    return out;
  });
}

/** What of a question's answering can't be seen whole at the page's top as it opens: an answer (or a key, a row)
 * off the screen, under the head, or under the action at its foot („Готово“, „Отговори“). */
export async function unseenAnswers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const head = document.querySelector(".question-top")?.getBoundingClientRect().bottom ?? 0;
    const action = document.querySelector(".answering .btn.primary")?.getBoundingClientRect();
    if (action && (action.top < head - 1 || action.bottom > innerHeight + 0.5)) out.push("the action off the screen");
    const parts = `article.question :is(.choices > .option, .pic-options > .option, .tf-options > .option, .keypad .key,
      .sortable-list > .option)`;
    for (const e of document.querySelectorAll(parts)) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const what = `${e.className} „${(e.textContent ?? "").replaceAll("­", "").trim().slice(0, 24)}“`;
      if (r.top < head - 1 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5)
        out.push(`off the screen: ${what} [${Math.round(r.top)}–${Math.round(r.bottom)}]`);
      else if (
        action &&
        r.bottom > action.top + 1 &&
        r.top < action.bottom - 1 &&
        r.right > action.left &&
        r.left < action.right
      )
        out.push(`under the action: ${what}`);
    }
    return out;
  });
}

/** What's wrong with an answer's panel: „Напред“ (or „Към резултата“) not whole on the screen; anything of the
 * panel showing under it or beside it, between it and the panel's foot; or, where the panel scrolls, fewer than two
 * lines of the fact above the fade over „Напред“. */
export async function panelFlaws(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const after = document.querySelector<HTMLElement>(".after");
    const go = after?.querySelector<HTMLElement>(".up-next-go");
    if (!after || !go) return ["no answer's panel"];
    const g = go.getBoundingClientRect();
    if (g.top < 0 || g.bottom > innerHeight + 0.5 || g.left < 0 || g.right > innerWidth + 0.5)
      out.push(`„${go.textContent}“ off the screen [${Math.round(g.top)}–${Math.round(g.bottom)}]`);
    const p = after.getBoundingClientRect();
    const foot = Math.min(p.bottom, innerHeight) - 1;
    for (let y = g.bottom + 1; y <= foot; y += 3)
      for (const x of [p.left + 2, p.left + p.width / 2, p.right - 3]) {
        const hit = document.elementFromPoint(x, y);
        if (hit && hit !== after && !hit.closest(".after-foot") && after.contains(hit))
          out.push(`under „Напред“ at ${Math.round(y)}: ${hit.tagName.toLowerCase()}.${hit.className}`);
      }
    // Scrolling, at its top: the fact's first two lines above the fade over the foot (unless the panel gave way to the
    // player's row and the right one, right over it: DESIGN.md, Play; run.ts, settle, sets --give on the question).
    const fact = after.querySelector<HTMLElement>(".fact p:last-child");
    const gave = !!document.querySelector<HTMLElement>("article.question")?.style.getPropertyValue("--give");
    if (!gave && fact && after.scrollHeight > after.clientHeight + 1 && getComputedStyle(after).position === "fixed") {
      after.scrollTop = 0;
      const lh = Number.parseFloat(getComputedStyle(fact).lineHeight) || 24;
      const fade = (after.querySelector(".after-foot") ?? go).getBoundingClientRect().top - 28;
      const top = fact.getBoundingClientRect().top;
      if (top + 2 * lh > fade + 1) out.push(`the fact's two lines under the fade (${Math.round(fade - top)}px)`);
    }
    return [...new Set(out)];
  });
}

/** Where the answer ended, on a laptop: on the right page, under what answered it, never over the question's sheet
 * on the left; the verdict, the fact whole and „Напред“ in sight on the screen, nothing over them. The rows a choice
 * keeps in sight (the player's, the right one) come first: moved as far as they let (run.ts, settle: at the head's
 * foot), the page shows the fact's first line, the rest a scroll away, as on a tablet. */
export async function beside(page: Page): Promise<string[]> {
  const at = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
    const seen = (s: string, x: number, y: number) =>
      y >= 0 && y <= innerHeight && !!document.elementFromPoint(x, y)?.closest(s);
    const head = box(".question-top")?.bottom ?? 0;
    const kept = [...document.querySelectorAll("article.question button.option:is(.right, .wrong)")].map((r) =>
      r.getBoundingClientRect(),
    );
    const keptTop = Math.min(...kept.map((r) => r.top));
    const atHead = kept.length > 0 && keptTop >= head - 1 && keptTop <= head + 16;
    const line = document.querySelector<HTMLElement>(".after .fact p:last-child");
    const lh = line ? Number.parseFloat(getComputedStyle(line).lineHeight) || 24 : 0;
    const l = line?.getBoundingClientRect();
    const firstLine = !!l && seen(".fact", l.left + 8, l.top + 4) && seen(".fact", l.left + 8, l.top + lh - 4);
    const fact = box(".after .fact");
    const go = box(".after .up-next-go");
    const verdict = box(".after .verdict");
    const answers = box(".run-question .answering");
    const panel = box(".after");
    const sheet = box(".run-question .q-leaf");
    return {
      under:
        !!answers &&
        !!panel &&
        !!sheet &&
        panel.left >= sheet.right &&
        panel.left >= answers.left - 1 &&
        panel.top >= answers.bottom - 1,
      verdict: !!verdict && seen(".verdict", verdict.left + 8, verdict.top + verdict.height / 2),
      fact:
        !fact ||
        (seen(".fact", fact.left + 8, fact.top + 4) && seen(".fact", fact.left + 8, fact.bottom - 4)) ||
        (atHead && firstLine),
      go: !!go && seen(".up-next-go", go.left + go.width / 2, go.top + 4) && go.bottom <= innerHeight,
    };
  });
  return [
    at.under ? "" : "the answer isn't under what answered it, beside the question",
    at.verdict ? "" : "the verdict is out of sight",
    at.fact ? "" : "the fact isn't whole in sight",
    at.go ? "" : "„Напред“ is out of sight",
  ].filter(Boolean);
}

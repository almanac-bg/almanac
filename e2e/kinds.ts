// Every kind of question, as the sample bank has it at its longest, answered as a test wants it (right, wrong or
// close), and what a question's screen must never do whatever its size (layout.spec.ts, answer.spec.ts).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

/** A question of the sample bank, as much of it as the tests read. */
export interface Q {
  id: string;
  type: string;
  text: string;
  answer?: unknown;
  wrong?: string[];
  image?: unknown;
  pictures?: { alt: string }[];
  clues?: string[];
  items?: { text: string; value?: number; group?: number }[];
  direction?: string;
  pairs?: { left: string; right: string }[];
  decoy?: string;
  groups?: string[];
  tolerance?: number;
}

/** How a question is answered: right, wrong, or close (a number near, an order, pairs or groups partly right). */
export type How = "right" | "wrong" | "close";

/** Whether a kind of question can be answered close: a number, or a whole made of parts. */
export const closeable = (q: Q) => ["number", "order", "match", "split"].includes(q.type);

const bank = (): Q[] => {
  const dir = resolve(import.meta.dirname, "../bank/sample/questions");
  return readdirSync(dir).flatMap((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Q[]);
};

/** All the words a question shows: the longest of each kind is the one a screen has the least room for. */
const words = (q: Q) =>
  [
    q.text,
    q.answer,
    q.wrong,
    q.clues,
    q.items?.map((i) => i.text),
    q.pairs?.flatMap((p) => [p.left, p.right]),
    q.decoy,
    q.groups,
  ]
    .flat()
    .filter((w) => typeof w === "string")
    .join(" ").length;

/** One question of each kind, the longest the sample bank has: a choice, a choice of pictures, a choice under a
 * picture, „Вярно или невярно“, an order, pairs, groups, clues and a number; each named. */
export function kinds(): { name: string; q: Q }[] {
  const all = bank();
  const longest = (f: (q: Q) => boolean) => {
    const q = all.filter(f).sort((a, b) => words(b) - words(a))[0];
    if (!q) throw new Error("the sample bank has no such question");
    return q;
  };
  const plain = (type: string) => (q: Q) => q.type === type && !q.image && !q.pictures;
  return [
    { name: "choice", q: longest(plain("choice")) },
    { name: "pictures", q: longest((q) => !!q.pictures) },
    { name: "picture", q: longest((q) => q.type === "choice" && !!q.image) },
    { name: "truefalse", q: longest(plain("truefalse")) },
    { name: "order", q: longest(plain("order")) },
    { name: "match", q: longest(plain("match")) },
    { name: "split", q: longest(plain("split")) },
    { name: "clues", q: longest(plain("clues")) },
    { name: "number", q: longest(plain("number")) },
  ];
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
    case "clues":
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
    case "match": {
      const pairs = q.pairs ?? [];
      const n = pairs.length;
      for (const [i, p] of pairs.entries()) {
        // Wrong: each with the next one's pair; close: the first two right, the rest swapped.
        const j =
          how === "right" || (how === "close" && i < 2) ? i : how === "close" ? (i === n - 1 ? 2 : i + 1) : (i + 1) % n;
        await tapText(page, "article.question .match-col:first-of-type .match-item", p.left);
        await tapText(page, "article.question .match-col:last-of-type .match-item", pairs[j]?.right ?? "");
      }
      await expect(ask.locator(".match-lines line")).toHaveCount(n);
      await tap(".answering .btn.primary");
      return;
    }
    case "split": {
      const items = q.items ?? [];
      for (let i = 0; i < items.length; i++) {
        await expect(ask.locator(".split-pips b.done")).toHaveCount(i);
        const text = bare(await ask.locator(".split-card.top .split-text").textContent());
        const item = items.find((x) => x.text === text);
        const group = item?.group ?? 0;
        const ok = how === "right" || (how === "close" && i < items.length / 2);
        await ask
          .locator(".split-side")
          .nth(ok ? group : 1 - group)
          .dispatchEvent("click");
      }
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
    for (const e of document.querySelectorAll("article.question :is(.option, .btn, .link, .split-arrow, .split-label)"))
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
    // words, the letter, the value), or set in its corner.
    for (const mark of document.querySelectorAll(".option .sign, .option > .value")) {
      if (!shown(mark) || getComputedStyle(mark).position === "absolute") continue;
      const r = mark.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const others = [...(mark.parentElement?.children ?? [])].filter((e) => e !== mark && shown(e));
      if (
        !others.some((e) => {
          const o = e.getBoundingClientRect();
          return o.top <= mid && mid <= o.bottom;
        })
      )
        out.push(`on a line of its own: ${name(mark)} in ${name(mark.closest(".option") ?? mark)}`);
    }

    // A punctuation mark never starts a line: it goes with the word before it („революционер?“, never „?“ alone).
    const texts = ".ask, .option, .clue, .split-card.top, .right-said, .match-pair, .split-pair";
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

/** What of a question's answering can't be seen whole at the page's top as it opens: an answer (or a key, a cell,
 * a group, a card) off the screen, under the head, or under the action at its foot („Готово“, „Отговори“). */
export async function unseenAnswers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const head = document.querySelector(".question-top")?.getBoundingClientRect().bottom ?? 0;
    const action = document.querySelector(".answering .btn.primary")?.getBoundingClientRect();
    if (action && (action.top < head - 1 || action.bottom > innerHeight + 0.5)) out.push("the action off the screen");
    const parts = `article.question :is(.choices > .option, .pic-options > .option, .tf-options > .option, .keypad .key,
      .sortable-list > .option, .match-item, .split-side, .split-card.top, .split-back:not([hidden]), .clue)`;
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
    // Scrolling, at its top: the fact's first two lines above the fade over the foot.
    const fact = after.querySelector<HTMLElement>(".fact p:last-child");
    if (fact && after.scrollHeight > after.clientHeight + 1 && getComputedStyle(after).position === "fixed") {
      after.scrollTop = 0;
      const lh = Number.parseFloat(getComputedStyle(fact).lineHeight) || 24;
      const fade = (after.querySelector(".after-foot") ?? go).getBoundingClientRect().top - 28;
      const top = fact.getBoundingClientRect().top;
      if (top + 2 * lh > fade + 1) out.push(`the fact's two lines under the fade (${Math.round(fade - top)}px)`);
    }
    return [...new Set(out)];
  });
}

/** Where the answer ended, on a laptop: on the left page under the question, what answered it on the right; the
 * verdict, the fact whole and „Напред“ in sight on the screen, nothing over them. */
export async function beside(page: Page): Promise<string[]> {
  const at = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
    const seen = (s: string, x: number, y: number) =>
      y >= 0 && y <= innerHeight && !!document.elementFromPoint(x, y)?.closest(s);
    const fact = box(".after .fact");
    const go = box(".after .up-next-go");
    const verdict = box(".after .verdict");
    return {
      answers: box(".run-question .answering")?.left ?? 0,
      panel: box(".after")?.right ?? Number.POSITIVE_INFINITY,
      verdict: !!verdict && seen(".verdict", verdict.left + 8, verdict.top + verdict.height / 2),
      fact: !fact || (seen(".fact", fact.left + 8, fact.top + 4) && seen(".fact", fact.left + 8, fact.bottom - 4)),
      go: !!go && seen(".up-next-go", go.left + go.width / 2, go.top + 4) && go.bottom <= innerHeight,
    };
  });
  return [
    at.panel < at.answers ? "" : "the answer isn't beside what answered it",
    at.verdict ? "" : "the verdict is out of sight",
    at.fact ? "" : "the fact isn't whole in sight",
    at.go ? "" : "„Напред“ is out of sight",
  ].filter(Boolean);
}

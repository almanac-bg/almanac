// Each question type's screen: how it's asked, how it's answered, and how its answer is shown. One renderer per type,
// as the server has one Go file per type (internal/bank).

import { append, type Child, effect, h, listen, onCleanup, type Signal, signal } from "../lib/dom.ts";
import { ordinal } from "../lib/ordinal.ts";
import { play } from "../lib/sound.ts";
import { hyphenate, keepShort, listWords, withWord } from "../lib/words.ts";
import { formatNumber, formatValue, type VerdictKind } from "../ui.ts";
import { percent, rare, withOwn } from "./numbers.ts";
import { optionSizes, overSizes } from "./sizes.ts";
import type {
  Answer,
  ChoiceView,
  CluesView,
  Credit,
  Crowd,
  MatchView,
  NumberView,
  OrderView,
  Picture,
  Reveal,
  SplitView,
  Spread,
  TrueFalseView,
  View,
} from "./types.ts";

/** Runs a step of an answer's showing `ms` after its first (DESIGN.md, Motion), or at once. */
export type Stage = (ms: number, step: () => void) => void;

/** An answer shown all at once: in a review, in a game played with others, with less motion. */
const atOnce: Stage = (_ms, step) => step();

/** The beats of an answer's showing, from the moment the player's own answer is judged: the right answer (when it
 * wasn't theirs) with the verdict; how everyone else answered; the fact. */
export const beats = { right: 300, crowd: 550, fact: 700 };

export interface Asked {
  /** The answering part, under the question. */
  node: Child;
  /** Shows the answer: what was right, and how what was given compares; in beats on a stage (a run, run.ts), the
   * player's own answer first; `how` it went (a number's own mark: right, close („близо“) or not). */
  reveal(reveal: Reveal, given: Answer | null, at?: Stage, how?: VerdictKind): void;
  /** What's been put in but not sent yet (a typed number, things moved into an order): it counts when time runs out. */
  pending(): Answer | null;
  /** Takes a newer view of the same question, as more of it shows (the next clue). */
  update?(view: View): void;
}

/** A cell's words (a pair, a thing to sort, a group): each that may break (hyphenate) held whole in a `.word`, so that
 * it goes to the next line whole where it fits there („Ангел / Каралийчев“, not „Ангел Каралий-/чев“), and breaks, at
 * its syllables, only where it's wider than the cell itself. A one-letter word goes with the word after it
 * (keepShort), in its `.word` too, so that the two never part: in a question (`asked`, a line wide enough) always, in
 * a narrow cell only where that word is too short to break (else „В / България“ beats „В Бълга-/рия“). */
export function wholeWords(text: string, asked = false): Child {
  return hyphenate(keepShort(text, !asked))
    .split(/([^ \t\n\r]*­[^ \t\n\r]*)/)
    .map((part, i) => (i % 2 ? h("span", { class: "word" }, part) : part));
}

/** How everyone did with a question, in one quiet line under its verdict, as each kind of question counts right:
 * „Вярно отговарят 34% от играчите днес.“ for the day's ten (its players today), without „днес“ for everyone ever;
 * the player among them (withOwn), as on the answers' shares. A right answer few others got stands out, said as the feat it is („Познаха го само 12% от играчите днес.“), and
 * nobody else right is said as such, never as „0%“. Nothing while the question has too few answers to say. */
export function crowdLine(type: View["type"], c: Crowd | undefined, right: boolean): Child {
  if (!c) return null;
  const all = withOwn(c, -1, right).right;
  const s = `${percent(all)} от играчите${c.today ? "\u00a0днес" : ""}`;
  if (c.right === 0) {
    const none = right
      ? c.today
        ? "Днес само ти го позна."
        : "Досега само ти го позна."
      : c.today
        ? "Днес още никой не го е познал."
        : "Още никой не го е познал.";
    return h("p", { class: right ? "crowd-says rare" : "crowd-says" }, none);
  }
  if (right && all <= rare) return h("p", { class: "crowd-says rare" }, `Познаха го само ${s}.`);
  const says = {
    choice: `Вярно отговарят ${s}.`,
    truefalse: `Вярно отговарят ${s}.`,
    clues: `Вярно отговарят ${s}.`,
    number: `Вярно отговарят ${s}.`, // near enough to count is right; „близо“ is only the close answer that isn't
    order: `Изцяло вярно подреждат ${s}.`,
    match: `Всички двойки свързват вярно ${s}.`,
    split: `Всичко разпределят вярно ${s}.`,
  }[type];
  return h("p", { class: "crowd-says" }, says);
}

/** The shares on each answer, where the question has had enough answers to say: each in its place beside the answer
 * now, unseen, so that the answers settle into their place with them (with the right one marked: run.ts, settle) and
 * none grows when they show; and shown by the function returned, a bar behind each answer filling in as long as the
 * share that gave it. The player's own answer is among them (withOwn: `mine`, the place they picked, -1 for none). */
function crowdOnAll(buttons: HTMLElement[], crowd: Crowd | undefined, mine: number): () => void {
  const c = crowd && withOwn(crowd, mine, false);
  const shares = buttons.flatMap((b, i) => {
    const x = c?.picks?.[i];
    if (!c || x === undefined) return [];
    const share = h("span", { class: "value crowd-share unseen" }, percent(x));
    // After the words (and „ти“), before the ✓ or ✕ at the row's end.
    const sign = b.querySelector(":scope > .row-end > .sign, :scope > .sign");
    if (sign) sign.before(share);
    else (b.querySelector(".pic-frame") ?? b).append(share);
    return [{ b, share, x }];
  });
  // The shares are of every answer, the ones that ran out of time too (bank.Crowd: so that the right one's is the share
  // right), so where some ran out they don't add up to 100 %: what's missing said under the answers, in its room now
  // and unseen as the shares are, never „72 % + 22 %“ left to puzzle over.
  const rest = c?.picks && shares.length ? 1 - c.picks.reduce((a, x) => a + x, 0) : 0;
  const none =
    Math.round(rest * 100) >= 1 ? h("p", { class: "crowd-none unseen" }, `Без отговор: ${percent(rest)}`) : null;
  if (none) buttons[0]?.parentElement?.after(none);
  return () => {
    for (const { b, share, x } of shares) {
      b.classList.add("crowd");
      share.classList.remove("unseen");
      requestAnimationFrame(() => b.style.setProperty("--share", `${Math.round(x * 1000) / 10}%`));
    }
    none?.classList.remove("unseen");
  };
}

/** Draws a question's answering part; submit sends an answer once, and locked stops input. With the answer it shows
 * how everyone else has answered each option (once the question has had enough answers to say); the sentence that
 * sums it up goes under the verdict (crowdLine). `say` tells a screen reader what changes as the question runs (a
 * clue come out), in the game's live region; without it, the question keeps one of its own. `display`: drawn to be
 * looked at, never answered here (a review's): no keys, no line on how to answer, no „Готово“, no
 * grips; the clues still come out as their time comes. */
export function ask(
  view: View,
  submit: (a: Answer) => void,
  locked: Signal<boolean>,
  say?: (s: string) => void,
  display = false,
): Asked {
  switch (view.type) {
    case "choice":
      return choice(view, submit, locked, display);
    case "number":
      return number(view, submit, locked, display);
    case "order":
      return order(view, submit, locked, display);
    case "truefalse":
      return truefalse(view, submit, locked, display);
    case "match":
      return match(view, submit, locked, display);
    case "split":
      return split(view, submit, locked, display);
    case "clues":
      return clues(view, submit, locked, say, display);
  }
}

/** Draws a question as it was answered, for going over it once the question is past (a review). „Вярно“ and „Невярно“ carry no ✓ while asked; here the right one says it is, for whoever can't tell
 * colours. */
export function answered(view: View, reveal: Reveal, given: Answer | null, how?: VerdictKind): Child {
  const a = ask(view, () => {}, signal(true), undefined, true);
  a.reveal(reveal, given, undefined, how);
  if (a.node instanceof Element) {
    a.node.querySelector(".option.tf.right")?.append(h("small", { class: "tf-right" }, "верният отговор"));
    // Shown, not answered: its options, rows and keys do nothing, so the keyboard passes them by (ten questions' worth
    // were some forty stops on the way through the questions' dialog); a screen reader still reads them. A link (a
    // picture's credit) stays one.
    for (const el of a.node.querySelectorAll<HTMLElement>("button, [tabindex]")) el.tabIndex = -1;
  }
  return a.node;
}

/** An answer named inside a sentence, in quotes unless it brings its own. */
const quoted = (name: string) => (/^[„"«]/.test(name) ? name : `„${name}“`);

/** The right answer as a screen reader says it after a miss, where one short sentence holds it: „Верният отговор е „Бийтълс“.“
 * (none for an order, pairs or groups: their rows say it). */
export function spokenAnswer(view: View, reveal: Reveal): string {
  if (view.type === "truefalse") return reveal.truth ? "Твърдението е вярно." : "Твърдението е невярно.";
  const name = answerWords(view, reveal);
  if (!name) return "";
  const words = `Верният отговор е ${view.type === "number" ? name : quoted(name)}`;
  return words.endsWith(".") ? words : `${words}.`;
}

/** The right answer in a few words, where a few words hold it: a choice's or clues' option, a number with its unit,
 * „Вярно“ or „Невярно“ for a statement; "" for an order, pairs or groups (their rows say it). */
export function answerWords(view: View, reveal: Reveal): string {
  switch (view.type) {
    case "choice": {
      const pick = reveal.pick ?? -1;
      return reveal.names?.[pick] ?? view.choices?.[pick] ?? view.pictures?.[pick]?.alt ?? "";
    }
    case "clues":
      return view.choices[reveal.pick ?? -1] ?? "";
    case "truefalse":
      return reveal.truth ? "Вярно" : "Невярно";
    case "number":
      return `${formatNumber(reveal.value ?? 0, view.step)}${view.unit ? `\u00a0${view.unit}` : ""}`;
    default:
      return "";
  }
}

/** The least a question's picture is drawn at, however little room the screen has: still a picture to look at (a
 * short phone, twice the text, scrolls rather than shrink it to a stamp: DESIGN.md, Play). */
const pictureFloor = 120;

/** The picture over a question. While it's asked (fit), it's kept low enough that the question, the picture and the
 * whole answering part under it fit on the screen, down to a floor on a screen too small for that, and kept so as
 * the screen changes size. */
export function picture(view: View, fit = false): Child {
  const im = view.image;
  if (!im) return null;
  const img = h("img", {
    class: "picture",
    src: im.src,
    srcset: im.srcset,
    sizes: overSizes(im),
    width: im.w,
    height: im.h,
    alt: im.alt,
    decoding: "async",
  });
  if (fit) {
    // The answering part follows the picture; the room it leaves is the screen's height less the question's height
    // without the picture (as if the page were at its top, where a question opens), and a margin under it. Where the
    // answering part is set at the screen's foot (a run on a phone), the room between them is the picture's too.
    const size = () => {
      const below = img.nextElementSibling;
      // Answered, it stays as it was.
      if (!img.isConnected || !below || img.closest(".answered")) return;
      const box = img.getBoundingClientRect();
      const under = below.getBoundingClientRect();
      // Beside the answers (a laptop's spread): the screen's height under the picture's top is its own.
      if (under.left >= box.right - 1) {
        img.style.setProperty("--fit", `${Math.max(pictureFloor, Math.floor(innerHeight - box.top - scrollY - 16))}px`);
        return;
      }
      const gap = Number.parseFloat(getComputedStyle(img.parentElement ?? img).rowGap) || 0;
      const spare = Math.max(0, under.top - box.bottom - gap);
      const end = under.bottom + scrollY - box.height - spare;
      img.style.setProperty("--fit", `${Math.max(pictureFloor, Math.floor(innerHeight - end - 16))}px`);
    };
    requestAnimationFrame(size);
    listen(window, "resize", size);
  }
  return img;
}

/** Whether a question shows pictures (over it, or as its options). */
export function hasPictures(view: View): boolean {
  return !!view.image || (view.type === "choice" && !!view.pictures?.length);
}

/** Loads a question's pictures as its screen will show them, so that its time can start once they're in: done when
 * each is decoded (or has failed), or after `ms` at most. */
export function picturesIn(view: View, ms: number): Promise<void> {
  const files: [Picture, string][] = [];
  if (view.image) files.push([view.image, overSizes(view.image)]);
  if (view.type === "choice") for (const p of view.pictures ?? []) files.push([p, optionSizes(p)]);
  const loads = files.map(([p, sizes]) => {
    const img = new Image();
    img.sizes = sizes;
    img.srcset = p.srcset;
    img.src = p.src;
    return img.decode().catch(() => {});
  });
  return new Promise((done) => {
    const t = setTimeout(done, ms);
    Promise.all(loads).then(() => {
      clearTimeout(t);
      done();
    });
  });
}

/** What marks each answer, on every screen: a letter, so that everyone at a table (saying „Б“) names the same answer. */
const letters = ["А", "Б", "В", "Г"];

/** Keys 1–4 press the answer they mark, and so do its letter's keys, А–Г (a Bulgarian keyboard), while the question
 * waits for one (never in a field, never with a modifier). */
function answerKeys(buttons: HTMLElement[], locked: Signal<boolean>): void {
  listen(document, "keydown", (e: KeyboardEvent) => {
    if (locked.peek() || e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.target instanceof HTMLInputElement) return;
    const i = /^[1-4]$/.test(e.key) ? Number(e.key) - 1 : letters.indexOf(e.key.toUpperCase());
    if (i >= 0) buttons[i]?.click();
  });
}

/** Whether the player points with a mouse (a computer): its hints say „Щракни“, not „Докосни“, and name the keys. */
const mouse = () => typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;

/** The ✓ or ✕ on a revealed answer (its colour and words say the same). */
const sign = () => h("span", { class: "sign", "aria-hidden": "true" });

/** „ти“ on the player's own wrong answer: a choice's after its words, before how many gave it; a picture's after its
 * name (held to the last word of it). */
const yours = () => h("span", { class: "yours" }, "ти");

function choice(view: ChoiceView, submit: (a: Answer) => void, locked: Signal<boolean>, display: boolean): Asked {
  const pictures = view.pictures;
  const names = pictures?.map(() => h("span", { class: "pic-name" })) ?? [];
  const buttons = (pictures ?? view.choices ?? []).map((option, i) =>
    h(
      "button",
      {
        class: pictures ? "option pic-option" : "option",
        type: "button",
        "aria-disabled": locked,
        "aria-label": typeof option === "string" ? null : `${letters[i]}: ${option.alt}`,
        onclick: () => {
          if (locked.peek()) return;
          buttons[i]?.classList.add("picked");
          play("tap");
          submit({ pick: i });
        },
      },
      typeof option === "string"
        ? [
            h("span", { class: "letter", "aria-hidden": "true" }, letters[i]),
            h("span", { class: "option-words" }, wholeWords(option)),
          ]
        : [
            // The picture, its letter in one corner (its key in another, on a computer), its ✓ or ✕ in the other
            // once answered, and how many chose it at its foot; its name under it, the card's whole width.
            h(
              "span",
              { class: "pic-frame" },
              h("img", {
                class: "pic-option-img",
                src: option.src,
                srcset: option.srcset,
                sizes: optionSizes(option),
                width: option.w,
                height: option.h,
                alt: "",
                decoding: "async",
              }),
              h("span", { class: "letter pic-letter", "aria-hidden": "true" }, letters[i]),
            ),
            names[i],
          ],
    ),
  );
  if (!display) answerKeys(buttons, locked);
  const credits = h("p", { class: "credit pic-credits", hidden: true });
  return {
    node: h("div", null, h("div", { class: pictures ? "options pic-options" : "options choices" }, buttons), credits),
    pending: () => null,
    reveal(reveal, given, at = atOnce) {
      const mine = given && "pick" in given ? given.pick : -1;
      const mark = (b: HTMLElement, i: number) => {
        b.classList.remove("picked");
        const how = i === reveal.pick ? "right" : i === mine ? "wrong" : "dim";
        b.classList.add(how);
        if (i === mine) b.classList.add("mine");
        const name = reveal.names?.[i];
        if (name) {
          const cell = names[i];
          if (cell) append(cell, [wholeWords(name)]);
          b.setAttribute("aria-label", `${letters[i]}: ${name}`);
        }
        // A choice's words' \u201e\u0442\u0438\u201c, share and \u2713 or \u2715 in one box at the row's end: beside the words, or together under
        // them (app.css). A picture's in its corners and under its name.
        const end = () =>
          b.querySelector(":scope > .row-end") ?? b.appendChild(h("span", { class: "row-end" }) as HTMLElement);
        if (how === "wrong") names[i] ? names[i].append("\u00a0", yours()) : end().append(yours());
        if (how !== "dim") (b.querySelector(".pic-frame") ?? end()).append(sign());
      };
      const own = buttons[mine];
      if (own) mark(own, mine);
      let crowd = () => {};
      at(beats.right, () => {
        buttons.forEach((b, i) => {
          if (b !== own) mark(b, i);
        });
        crowd = crowdOnAll(buttons, reveal.crowd, mine);
        // Gone over, the pictures' credits under them; in a game, in the answer's panel (run.ts), where nothing
        // covers them.
        if (display && reveal.credits?.length) {
          credits.hidden = false;
          append(credits, creditsWords(reveal.credits));
        }
      });
      at(beats.crowd, () => crowd());
    },
  };
}

/** A choice of pictures' credits, in a line: „Снимки: А … (CC BY-SA 4.0) · Б …“. */
export function creditsWords(credits: Credit[]): Child[] {
  return [
    "Снимки: ",
    ...credits.flatMap((c, i) => [
      i ? " · " : "",
      h("a", { href: c.source, target: "_blank", rel: "noopener" }, `${letters[i]} ${c.credit}`),
      ` (${c.license})`,
    ]),
  ];
}

/** The keys of the number pad, row by row ("" is a gap, "," a decimal comma). */
function keys(view: NumberView): string[] {
  const decimal = view.step < 1;
  return ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimal ? "," : "", "0", "⌫"];
}

/** A number, typed on a pad of its own (no phone keyboard over the question) or on a computer's keys. */
function number(view: NumberView, submit: (a: Answer) => void, locked: Signal<boolean>, display = false): Asked {
  const decimals = (String(view.step).split(".")[1] ?? "").length;
  const typed = signal(""); // digits, and a comma once decimals are allowed: "1878", "6,5"
  const negative = signal(false);
  const value = (): number | null => {
    const t = typed();
    if (t === "" || t === ",") return null;
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? (negative() ? -n : n) : null;
  };
  const press = (k: string) => {
    if (locked.peek()) return;
    const before = typed.peek();
    typed.update((t) => {
      if (k === "⌫") return t.slice(0, -1);
      if (k === ",") return decimals && !t.includes(",") ? `${t || "0"},` : t;
      const [whole = "", part] = t.split(",");
      if (part !== undefined) return part.length < decimals ? t + k : t;
      if (whole.length >= 9) return t;
      return whole === "0" ? k : t + k;
    });
    if (typed.peek() !== before) play("key");
  };
  const send = () => {
    const v = value();
    if (locked.peek() || v === null) return;
    play("tap");
    submit({ value: v });
  };
  // The number as typed, with a space between thousands from 10 000 up (as the game writes numbers).
  const shown = () => {
    const [whole = "", part] = typed().split(",");
    if (whole === "" && part === undefined) return "";
    const w = whole === "" ? "0" : formatNumber(Number(whole));
    return `${negative() ? "−" : ""}${w}${part === undefined ? "" : `,${part}`}`;
  };
  listen(document, "keydown", (e: KeyboardEvent) => {
    if (locked.peek() || e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLTextAreaElement) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") press("⌫");
    else if (e.key === "," || e.key === ".") press(",");
    else if (e.key === "-" && view.signed) negative.update((n) => !n);
    else if (e.key === "Enter") send();
    else return;
    e.preventDefault();
  });
  const pad = h(
    "div",
    { class: "number" },
    h(
      "div",
      // Keys land here wherever focus is, so it always looks like a field in focus: a ring and a blinking caret.
      { class: () => (locked() ? "number-out" : "number-out live") },
      view.signed
        ? h(
            "button",
            {
              class: () => (negative() ? "sign-key on" : "sign-key"),
              type: "button",
              disabled: locked,
              "aria-pressed": negative,
              "aria-label": "Минус",
              onclick: () => negative.update((n) => !n),
            },
            "−",
          )
        : null,
      h("output", { class: "typed", "aria-live": "polite", "aria-label": "Твоят отговор" }, shown),
      view.unit ? h("span", { class: "unit" }, view.unit) : null,
    ),
    h(
      "div",
      { class: "keypad" },
      keys(view).map((k) =>
        k === ""
          ? h("span", { "aria-hidden": "true" })
          : h(
              "button",
              {
                class: k === "⌫" ? "key erase" : "key",
                type: "button",
                disabled: locked,
                "aria-label": k === "⌫" ? "Изтрий" : k === "," ? "Запетая" : null,
                onclick: () => press(k),
              },
              k === "⌫" ? null : k,
            ),
      ),
    ),
    h("button", { class: "btn primary big", disabled: () => locked() || value() === null, onclick: send }, "Отговори"),
  );
  const unit = view.unit ? ` ${view.unit}` : "";
  const result = h("div", { class: "number-result", hidden: true });
  return {
    node: h("div", null, pad, result),
    pending: () => {
      const v = value();
      return v === null ? null : { value: v };
    },
    reveal(reveal, given, at = atOnce, how) {
      pad.hidden = true;
      result.hidden = false;
      const answer = reveal.value ?? 0;
      const mine = given && "value" in given ? given.value : null;
      const said = (v: number) => `${v < 0 ? "−" : ""}${formatNumber(Math.abs(v), view.step)}`;
      append(result, [
        // What the player said, as they typed it; then the answer, and both on a scale.
        h(
          "p",
          { class: "number-said" },
          mine === null
            ? h("span", { class: "typed muted" }, "Без отговор")
            : [h("span", { class: "typed" }, said(mine)), view.unit ? h("span", { class: "unit" }, view.unit) : null],
        ),
        mine === null || mine === answer ? null : scale(answer, mine, how, view),
        // Spot on, what was said is the answer: said once.
        mine === answer
          ? null
          : h(
              "p",
              { class: "number-answer" },
              "Верният отговор: ",
              h("strong", null, `${said(answer)}${unit}`),
              // A unit that ends a sentence itself („лв.“) ends it once.
              unit.endsWith(".") ? null : ".",
            ),
      ]);
      // Everyone's guesses, gone over (a review's): they take their room at once, and show on their beat. In a game
      // the scale is enough, and how everyone did is said under the verdict (DESIGN.md, Play).
      const guesses = reveal.crowd?.guesses;
      if (!guesses || !display) return;
      const all = spread(guesses, answer, mine, view);
      all.classList.add("unseen");
      result.append(all);
      at(beats.crowd, () => all.classList.remove("unseen"));
    },
  };
}

/** The player's number beside the answer on a scale running a little past both (as far again as they are apart), its
 * two ends named: the answer a filled square; the player's a disc, filled when it was near enough to be right, half
 * filled when it was close („близо“), hollow when not. */
function scale(answer: number, mine: number, how: VerdictKind | undefined, view: NumberView): HTMLElement {
  const right = how === "right" || how === "exact";
  const near = how === "partial";
  const mark = right ? "right" : near ? "near" : "mine";
  const gap = Math.abs(answer - mine);
  let lo = Math.min(answer, mine) - gap;
  const hi = Math.max(answer, mine) + gap;
  // A scale of a count or a size starts no lower than nothing, as the answer can't be under it.
  if (lo < 0 && Math.min(answer, mine) >= 0) lo = 0;
  // Where a value is on the scale (0 to 1): its mark there, its number over it held within the scale (app.css).
  const at = (v: number) => {
    const x = (v - lo) / (hi - lo || 1);
    return { left: `${x * 100}%`, "--at": String(x) };
  };
  const word = (v: number) => `${v < 0 ? "−" : ""}${formatNumber(Math.abs(v), view.step)}`;
  const unit = view.unit ? ` ${view.unit}` : "";
  return h(
    "div",
    { class: "number-near" },
    h(
      "div",
      { class: "near-scale", "aria-hidden": "true" },
      h("span", { class: "near-track" }),
      h("span", { class: "near-mark answer", style: at(answer) }, word(answer), h("i")),
      h("span", { class: `near-mark ${mark}`, style: at(mine) }, word(mine), h("i")),
      h("span", { class: "near-end lo" }, word(lo)),
      h("span", { class: "near-end hi" }, `${word(hi)}${unit}`),
    ),
    h(
      "p",
      { class: "near-key", "aria-hidden": "true" },
      h("span", null, h("i", { class: "answer" }), "верният отговор"),
      h(
        "span",
        null,
        h("i", { class: mark }),
        right ? "твоят отговор, вярно" : near ? "твоят отговор, близо" : "твоят отговор",
      ),
    ),
  );
}

/** Where everyone's guesses at a number fell: a bar for each part of the range a guess scores in, one at each end for
 * the guesses beyond it, the answer's part filled as a right answer is and the player's own outlined, as their mark
 * on the scale over it is. The player's own beyond the range isn't one of those ends' bars (it would read as the most
 * said): it's named at that end under them, „1900 лв. →“. */
function spread(s: Spread, answer: number, mine: number | null, view: NumberView): HTMLElement {
  const n = s.bins.length;
  const at = (v: number) =>
    s.log ? (v <= 0 ? -1 : Math.log(v / s.lo) / Math.log(s.hi / s.lo)) : (v - s.lo) / (s.hi - s.lo);
  // Columns: 0 is below the range, 1…n its parts, n+1 above it.
  const column = (v: number) => {
    const a = at(v);
    return a < 0 ? 0 : a > 1 ? n + 1 : Math.min(n, Math.floor(a * n) + 1);
  };
  const shares = [s.below, ...s.bins, s.above];
  const top = Math.max(...shares, 0.01);
  const theAnswer = column(answer);
  const at0 = mine === null ? -1 : column(mine);
  const beyond = at0 === 0 ? "lo" : at0 === n + 1 ? "hi" : "";
  const theirs = beyond ? -1 : at0;
  const unit = view.unit ? ` ${view.unit}` : "";
  const inRange = s.bins.reduce((a, b) => a + b, 0);
  const bars = h(
    "div",
    {
      class: "guess-bars",
      role: "img",
      "aria-label": `${percent(inRange)} от отговорите са между ${formatNumber(s.lo, view.step)} и ${formatNumber(s.hi, view.step)}${unit}.`,
      style: { "grid-template-columns": `0.6fr repeat(${n}, 1fr) 0.6fr` },
    },
    shares.map((x, k) =>
      h("span", {
        class: ["guess-bar", (k === 0 || k === n + 1) && "edge", k === theirs && "mine", k === theAnswer && "answer"]
          .filter(Boolean)
          .join(" "),
        style: { height: `${Math.max(3, (x / top) * 100)}%` },
      }),
    ),
  );
  return h(
    "div",
    { class: "guesses" },
    h("span", { class: "kicker" }, "Отговорите на играчите"),
    bars,
    h(
      "div",
      { class: "guess-axis", "aria-hidden": "true" },
      h("span", null, formatNumber(s.lo, view.step)),
      h("span", null, `${formatNumber(s.hi, view.step)}${unit}`),
    ),
    beyond && mine !== null
      ? h(
          "p",
          { class: `guess-out ${beyond}`, "aria-hidden": "true" },
          h("i", { class: "guess-swatch mine" }),
          beyond === "lo" ? `← ${formatNumber(mine, view.step)}${unit}` : `${formatNumber(mine, view.step)}${unit} →`,
        )
      : null,
    h(
      "div",
      { class: "guess-key", "aria-hidden": "true" },
      h("span", null, h("i", { class: "guess-swatch answer" }), "верният отговор"),
      mine === null ? null : h("span", null, h("i", { class: "guess-swatch mine" }), "твоят отговор"),
      h("span", null, h("i", { class: "guess-swatch edge" }), "извън целта"),
    ),
  );
}

let orders = 0; // for each order's hint its own id
/** How long a finger rests on a row, in ms, to take it up to drag (on the grip it's at once), and how far, in px, it
 * may stir meanwhile: moved further first, it scrolls the page. */
const HOLD = 300;
const STILL = 8;

/** Things to put in order, then sent with „Готово“: a tap on one picks it up and a tap on another place puts it
 * there (a screen reader's way too); or it's dragged into place: with a mouse from anywhere on it, with a finger by its
 * grip at once or from anywhere else once held a moment (a finger that moves at once scrolls the page, as it expects);
 * or moved with the arrow keys. */
function order(view: OrderView, submit: (a: Answer) => void, locked: Signal<boolean>, display: boolean): Asked {
  const how = `order-how-${++orders}`;
  const n = view.items.length;
  const arrangement = view.items.map((_, i) => i); // the item at each place
  let moved = false;
  const picked = signal(-1); // the item picked up by a tap, to be put down by the next
  let dragged = false; // the pointer down now has moved: a drag, not a tap
  let swallow = false; // a drag just ended: the click that may follow it is no tap (none follows a finger's)
  let holding = false; // a finger drags a row now: the page stays put under it
  const said = h("p", { class: "sr", "aria-live": "polite" });
  const rows = view.items.map((text, item) =>
    h(
      "li",
      {
        class: () => (picked() === item ? "option sortable chosen" : "option sortable"),
        role: "button",
        tabindex: 0,
        "aria-pressed": () => picked() === item,
        "aria-describedby": how,
      },
      h("span", { class: "letter", "aria-hidden": "true" }),
      h("span", null, wholeWords(text)),
      display ? null : h("span", { class: "grip", "aria-hidden": "true" }),
    ),
  );
  const list = h("ol", { class: "options sortable-list" });
  list.addEventListener(
    "pointerdown",
    () => {
      swallow = false;
    },
    true,
  );
  // Puts the rows in the order they're in now, numbered by place.
  const lay = () => {
    arrangement.forEach((item, place) => {
      const row = rows[item] as HTMLElement;
      row.style.transform = "";
      (row.firstChild as HTMLElement).textContent = String(place + 1);
      row.setAttribute("aria-label", `${place + 1}. ${view.items[item]}`);
    });
    list.append(...arrangement.map((i) => rows[i] as HTMLElement));
  };
  const move = (from: number, to: number) => {
    const [item] = arrangement.splice(from, 1);
    if (item === undefined) return;
    arrangement.splice(to, 0, item);
    moved = true;
    lay();
    play("key");
    said.textContent = `„${view.items[item]}“ е на ${ordinal(to + 1, "n")} място.`;
  };
  // A tap: picks a thing up, puts the one picked up in this one's place, or (on the one picked up) puts it back.
  const tap = (item: number) => {
    if (locked.peek()) return;
    const held = picked.peek();
    if (held === item) {
      picked.set(-1);
      said.textContent = `„${view.items[item]}“ остава на мястото си.`;
    } else if (held >= 0) {
      const keys = list.contains(document.activeElement);
      picked.set(-1);
      move(arrangement.indexOf(held), arrangement.indexOf(item));
      if (keys) (rows[held] as HTMLElement).focus({ preventScroll: true }); // the rows were laid anew
    } else {
      picked.set(item);
      play("tap");
      said.textContent = `Взе „${view.items[item]}“. ${mouse() ? "Щракни" : "Докосни"} мястото, където да отиде.`;
    }
  };
  rows.forEach((row, item) => {
    row.addEventListener("click", () => {
      if (swallow) swallow = false;
      else tap(item);
    });
    // A long press is the drag's, not the phone's: no menu, no text picked.
    row.addEventListener("contextmenu", (e) => e.preventDefault());
    // A finger dragging a row moves the row, not the page (the row lets the page pan: till it's taken up, it may).
    row.addEventListener(
      "touchmove",
      (e) => {
        if (holding) e.preventDefault();
      },
      { passive: false },
    );
    row.addEventListener("pointerdown", (e: PointerEvent) => {
      if (locked.peek() || e.button !== 0) return;
      // A mouse drags from anywhere on the row, a finger by the grip at once…
      if (e.pointerType === "mouse" || (e.target as Element).closest(".grip")) return grab(e, false);
      // …or anywhere else once held still a moment: before that, a finger that moves scrolls the page, one lifted taps.
      const { pointerId: id, clientX: x0, clientY: y0 } = e;
      const wait = () => {
        clearTimeout(timer);
        row.removeEventListener("pointermove", stir);
        row.removeEventListener("pointerup", wait);
        row.removeEventListener("pointercancel", wait);
      };
      const stir = (ev: PointerEvent) => {
        if (ev.pointerId === id && Math.hypot(ev.clientX - x0, ev.clientY - y0) > STILL) wait();
      };
      const timer = setTimeout(() => {
        wait();
        if (!locked.peek()) grab(e, true);
      }, HOLD);
      row.addEventListener("pointermove", stir);
      row.addEventListener("pointerup", wait);
      row.addEventListener("pointercancel", wait);
    });
    // Takes the row up and has it follow the pointer, from where it went down, till it's let go. `held`: taken up by a
    // long press, which says so (a lift and a tap's sound), and, let go without a move, is a tap: the row picked up.
    const grab = (e: PointerEvent, held: boolean) => {
      dragged = false;
      const from = arrangement.indexOf(item);
      const first = rows[arrangement[0] ?? 0] as HTMLElement;
      const second = rows[arrangement[1] ?? 0] as HTMLElement;
      const pitch = n > 1 ? second.offsetTop - first.offsetTop : row.offsetHeight;
      const y0 = e.clientY;
      let to = from;
      row.setPointerCapture(e.pointerId);
      row.classList.add("dragging");
      list.classList.add("sorting");
      holding = e.pointerType !== "mouse";
      if (held) play("tap");
      const follow = (ev: PointerEvent) => {
        if (Math.abs(ev.clientY - y0) > 4) dragged = true;
        const dy = Math.max(-from * pitch, Math.min((n - 1 - from) * pitch, ev.clientY - y0));
        row.style.transform = `translateY(${dy}px)`;
        to = from + Math.round(dy / pitch);
        arrangement.forEach((other, place) => {
          if (other === item) return;
          const shift = from < place && place <= to ? -pitch : to <= place && place < from ? pitch : 0;
          (rows[other] as HTMLElement).style.transform = shift ? `translateY(${shift}px)` : "";
        });
      };
      const drop = () => {
        row.removeEventListener("pointermove", follow);
        row.removeEventListener("pointerup", drop);
        row.removeEventListener("pointercancel", drop);
        row.removeEventListener("lostpointercapture", drop);
        row.classList.remove("dragging");
        list.classList.remove("sorting");
        holding = false;
        if (dragged) {
          picked.set(-1);
          swallow = true;
        } else if (held) {
          swallow = true; // the click a long press may still bring is this tap's
          return tap(item);
        }
        if (to !== from && !locked.peek()) move(from, to);
        else if (dragged) lay(); // back where it was (left alone on a tap: laying the rows anew would lose its click)
      };
      row.addEventListener("pointermove", follow);
      row.addEventListener("pointerup", drop);
      row.addEventListener("pointercancel", drop);
      // The row let go of the pointer before it was lifted (WebKit does as the page scrolls under it): the drag ends
      // there, where it got to, and nothing is left half-dragged.
      row.addEventListener("lostpointercapture", drop);
    };
    row.addEventListener("keydown", (e: KeyboardEvent) => {
      if (locked.peek()) return;
      // A row is a button: Enter or Space taps it.
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        return tap(item);
      }
      const at = arrangement.indexOf(item);
      const to = e.key === "ArrowUp" ? at - 1 : e.key === "ArrowDown" ? at + 1 : -1;
      if (to < 0 || to >= n) return;
      e.preventDefault();
      move(at, to);
      row.focus();
    });
  });
  lay();
  const done = h(
    "button",
    {
      class: "btn primary big",
      disabled: locked,
      onclick: () => {
        if (locked.peek()) return;
        play("tap");
        submit({ order: [...arrangement] });
      },
    },
    "Готово",
  );
  const hint = display
    ? h("p", { class: "hint", id: how, hidden: true })
    : h(
        "p",
        { class: "hint", id: how },
        mouse()
          ? "Щракни ред, после новото му място, или го плъзни. Стрелките ↑ ↓ също го местят."
          : [
              "Докосни ред, после новото му място, или го плъзни.",
              h("span", { class: "sr" }, " Стрелките нагоре и надолу също го местят."),
            ],
      );
  return {
    node: h("div", { class: "stack" }, hint, list, said, display ? null : done),
    pending: () => (moved ? { order: [...arrangement] } : null),
    // The right order, as the answer; on each thing, whether the player had it in its place, and if not, where.
    // Nothing put in order (the time ran out first): the right order alone.
    reveal(reveal, given) {
      // The line over the list stays, saying what it shows now, so the answers don't move under the player's eye.
      hint.replaceChildren("Верният ред:");
      hint.hidden = false;
      done.hidden = true;
      const mine = given && "order" in given ? given.order : null;
      const unit = reveal.unit ? ` ${reveal.unit}` : "";
      // Values that are only the places (1, 2, 3…) aren't said again beside the places' own numbers.
      const said = !!unit || (reveal.order ?? []).some((item, place) => reveal.values?.[item] !== place + 1);
      list.replaceChildren(
        ...(reveal.order ?? []).map((item, place) => {
          const at = mine ? mine.indexOf(item) : -1;
          const how = !mine ? "" : at === place ? " right" : " amiss";
          return h(
            "li",
            { class: `option${how}` },
            h("span", { class: "letter" }, String(place + 1)),
            h(
              "span",
              { class: "row-words" },
              wholeWords(view.items[item] ?? ""),
              how === " amiss" && at >= 0
                ? h("small", { class: "match-gave" }, `при теб: ${ordinal(at + 1, "n")}`)
                : null,
            ),
            // The value and the ✓ or ✕ in one box: under the words, where they don't fit beside them, together.
            h(
              "span",
              { class: "row-end" },
              said ? h("span", { class: "value" }, `${formatValue(reveal.values?.[item] ?? 0)}${unit}`) : null,
              how ? sign() : null,
            ),
          );
        }),
      );
    },
  };
}

/** „Вярно или невярно“: two answers, side by side (keys 1 and 2 too). */
function truefalse(
  _view: TrueFalseView,
  submit: (a: Answer) => void,
  locked: Signal<boolean>,
  display: boolean,
): Asked {
  const pick = (truth: boolean) => {
    if (locked.peek()) return;
    (truth ? yes : no).classList.add("picked");
    play("tap");
    submit({ truth });
  };
  const button = (truth: boolean) =>
    h(
      "button",
      {
        class: "option tf",
        type: "button",
        "aria-disabled": locked,
        onclick: () => pick(truth),
      },
      h("span", { class: "tf-line" }, h("span", { class: "tf-word" }, truth ? "Вярно" : "Невярно")),
    );
  const yes = button(true);
  const no = button(false);
  if (!display)
    listen(document, "keydown", (e: KeyboardEvent) => {
      if (locked.peek() || e.metaKey || e.ctrlKey || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "1") pick(true);
      else if (e.key === "2") pick(false);
    });
  return {
    node: h("div", { class: "tf-options" }, yes, no),
    pending: () => null,
    // As every answer is marked: the right one's ✓ (solid if it was the player's), the player's wrong one's ✕ and
    // „ти“, beside the word.
    reveal(reveal, given, at = atOnce) {
      const mine = given && "truth" in given ? given.truth : null;
      const mark = (b: HTMLElement, truth: boolean) => {
        b.classList.remove("picked");
        const how = truth === reveal.truth ? "right" : truth === mine ? "wrong" : "dim";
        b.classList.add(how);
        if (truth === mine) b.classList.add("mine");
        const line = b.querySelector(".tf-line");
        if (how !== "dim") line?.append(sign());
        if (how === "wrong") line?.after(yours());
      };
      if (mine !== null) mark(mine ? yes : no, mine);
      let crowd = () => {};
      at(beats.right, () => {
        if (mine !== true) mark(yes, true);
        if (mine !== false) mark(no, false);
        crowd = crowdOnAll([yes, no], reveal.crowd, mine === null ? -1 : mine ? 0 : 1);
      });
      at(beats.crowd, () => crowd());
    },
  };
}

/** „Свържи“: tap a thing on the left, then its pair on the right (or the other way round); a line joins them. A
 * joined one tapped again comes apart. */
function match(view: MatchView, submit: (a: Answer) => void, locked: Signal<boolean>, display: boolean): Asked {
  const pairs = signal<number[]>(view.left.map(() => -1)); // for each left, its right (-1: none yet)
  const stack = h("div", { class: "stack" });
  const chosen = signal<{ side: "left" | "right"; i: number } | null>(null);
  const said = h("p", { class: "sr", "aria-live": "polite" });
  const leftOf = (j: number) => pairs().indexOf(j);

  const join = (i: number, j: number) => {
    pairs.update((p) => p.map((r, k) => (k === i ? j : r === j ? -1 : r)));
    chosen.set(null);
    play("key");
    said.textContent = `„${view.left[i]}“ — „${view.right[j]}“.`;
  };
  const tap = (side: "left" | "right", i: number) => {
    if (locked.peek()) return;
    const c = chosen.peek();
    if (c && c.side === side && c.i === i) return chosen.set(null);
    if (c && c.side !== side) return side === "left" ? join(i, c.i) : join(c.i, i);
    // A joined one comes apart, and is chosen again.
    const joined = side === "left" ? pairs.peek()[i] !== -1 : pairs.peek().includes(i);
    if (joined) pairs.update((p) => p.map((r, k) => (side === "left" ? (k === i ? -1 : r) : r === i ? -1 : r)));
    chosen.set({ side, i });
    stack.classList.add("touched");
    play("tap");
  };

  const cell = (side: "left" | "right", i: number, text: string) => {
    const pairOf = () => (side === "left" ? (pairs()[i] === -1 ? -1 : i) : leftOf(i));
    return h(
      "button",
      {
        class: () => {
          const k = pairOf();
          const c = chosen();
          return ["option", "match-item", k >= 0 && "joined", c && c.side === side && c.i === i && "chosen"]
            .filter(Boolean)
            .join(" ");
        },
        type: "button",
        disabled: locked,
        "aria-pressed": () => {
          const c = chosen();
          return !!c && c.side === side && c.i === i;
        },
        "aria-label": () => {
          const k = pairOf();
          const other = side === "left" ? view.right[pairs()[i] ?? -1] : view.left[k];
          return k >= 0 && other ? `${text}, свързано ${withWord(other)}` : text;
        },
        onclick: () => tap(side, i),
      },
      // A left one is its letter; a right one, joined, takes its left one's: the pair is tied by the letter.
      h("span", { class: "letter", "aria-hidden": "true" }, () => {
        if (side === "left") return letters[i] ?? "";
        const k = pairOf();
        return k >= 0 ? (letters[k] ?? "") : "";
      }),
      h("span", null, wholeWords(text)),
    );
  };
  const lefts = view.left.map((t, i) => cell("left", i, t));
  const rights = view.right.map((t, j) => cell("right", j, t));
  const lines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  lines.setAttribute("class", "match-lines");
  lines.setAttribute("aria-hidden", "true");
  const grid = h(
    "div",
    { class: "match" },
    lines,
    h("div", { class: "match-col" }, lefts),
    h("div", { class: "match-col" }, rights),
  );
  // A line from each joined left to its right, redrawn as pairs change or the screen does.
  const draw = () => {
    const box = grid.getBoundingClientRect();
    lines.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    lines.replaceChildren(
      ...pairs().flatMap((j, i) => {
        const a = lefts[i]?.getBoundingClientRect();
        const b = j >= 0 ? rights[j]?.getBoundingClientRect() : undefined;
        if (!a || !b) return [];
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(a.right - box.left));
        line.setAttribute("y1", String(a.top + a.height / 2 - box.top));
        line.setAttribute("x2", String(b.left - box.left));
        line.setAttribute("y2", String(b.top + b.height / 2 - box.top));
        return [line];
      }),
    );
  };
  effect(() => {
    pairs();
    requestAnimationFrame(draw);
  });
  const resized = new ResizeObserver(() => draw());
  resized.observe(grid);
  onCleanup(() => resized.disconnect());

  const done = h(
    "button",
    {
      class: "btn primary big",
      disabled: () => locked() || pairs().includes(-1),
      onclick: () => {
        if (locked.peek()) return;
        play("tap");
        submit({ pairs: [...pairs.peek()] });
      },
    },
    "Готово",
  );
  const spare = view.right.length > view.left.length;
  const hint = h(
    "p",
    { class: "hint", hidden: display },
    mouse() ? "Щракни нещо вляво, после двойката му вдясно." : "Докосни нещо вляво, после двойката му вдясно.",
    spare ? " Едно вдясно остава без двойка." : null,
  );
  const result = h("ol", { class: "options match-result", hidden: true });
  const decoy = h("p", { class: "hint match-decoy", hidden: true });
  append(stack, [hint, grid, said, display ? null : done, result, decoy]);
  return {
    node: stack,
    pending: () => (pairs.peek().some((j) => j !== -1) ? { pairs: [...pairs.peek()] } : null),
    reveal(reveal, given) {
      stack.classList.remove("touched");
      hint.replaceChildren("Верните двойки:");
      hint.hidden = false;
      grid.hidden = true;
      done.hidden = true;
      result.hidden = false;
      const mine = given && "pairs" in given ? given.pairs : [];
      result.replaceChildren(
        ...view.left.map((left, i) => {
          const j = reveal.pairs?.[i] ?? -1;
          // Nothing given (the time ran out): the right pairs alone, none a miss of anyone's.
          const ok = !given || mine[i] === j;
          const gave = mine[i] ?? -1;
          return h(
            "li",
            // Nothing given: right, but none of it the player's (a ✓ in a ring, not a solid one: app.css).
            { class: !given ? "option right untaken" : ok ? "option right" : "option amiss" },
            h(
              "span",
              { class: "match-pair" },
              h("strong", null, wholeWords(left)),
              " — ",
              wholeWords(view.right[j] ?? ""),
              ok
                ? null
                : h("small", { class: "match-gave" }, gave >= 0 ? `при теб: ${view.right[gave]}` : "без двойка"),
            ),
            sign(),
          );
        }),
      );
      const spareText = reveal.decoy === undefined ? undefined : view.right[reveal.decoy];
      if (spareText) {
        decoy.hidden = false;
        decoy.replaceChildren("Без двойка: ", h("strong", null, spareText));
      }
    },
  };
}

/** How far a card must be dragged to go to a side, in px: past it, it goes when let go. */
const flingAt = 72;

/** „Раздели“: the things one by one on a card, each sent to its group by a swipe left or right, a tap on the group, or
 * the arrow keys. The last one sent sends the answer; until then the last one can be taken back. */
function split(view: SplitView, submit: (a: Answer) => void, locked: Signal<boolean>, display: boolean): Asked {
  const n = view.items.length;
  const sides = signal<number[]>([]); // the groups the items were sent to, in order
  const said = h("p", { class: "sr", "aria-live": "polite" });
  const deck = h("div", { class: "split-deck" });
  const pips = h(
    "div",
    { class: "split-pips", "aria-hidden": "true" },
    view.items.map(() => h("b")),
  );
  const send = (side: number) => {
    const at = sides.peek().length;
    if (locked.peek() || at >= n) return;
    const card = deck.querySelector<HTMLElement>(".split-card.top");
    if (card) {
      card.classList.add("gone", side === 0 ? "went-left" : "went-right");
      card.style.transform = "";
    }
    play("key");
    // Said here, once: what went where, and what's next on the card (the card itself is drawn anew each time).
    const next = view.items[at + 1];
    said.textContent = `„${view.items[at]}“: ${view.groups[side]}.${next === undefined ? "" : ` Следва „${next}“.`}`;
    sides.update((s) => [...s, side]);
    if (at + 1 === n) {
      // The last one sent: the answer goes, and says so at once, its pips full, the groups done with (sent).
      for (const p of pips.children) p.classList.add("done");
      undo.hidden = true;
      deck.parentElement?.classList.add("sent");
      deck.append(sent);
      submit({ sides: [...sides.peek()] });
    } else window.setTimeout(lay, 180);
  };
  const sent = h("p", { class: "split-sent", role: "status" }, "Отговорът е изпратен.");
  // Refused (the options free again, the question still open): the last one can be taken back again.
  effect(() => {
    if (locked() || !sent.isConnected) return;
    deck.parentElement?.classList.remove("sent");
    sent.remove();
    undo.hidden = false;
  });
  const back = () => {
    if (locked.peek() || sides.peek().length === 0) return;
    sides.update((s) => s.slice(0, -1));
    play("tap");
    lay();
    said.textContent = `Върнато: „${view.items[sides.peek().length]}“.`;
  };
  const sideButton = (side: number) =>
    h(
      "button",
      {
        class: `option split-side ${side === 0 ? "to-left" : "to-right"}`,
        type: "button",
        disabled: locked,
        "aria-label": `Към „${view.groups[side]}“`,
        onclick: () => send(side),
      },
      // The arrow beside the group's name, on its side, never wrapped away from it.
      side === 0 ? h("span", { class: "split-arrow", "aria-hidden": "true" }, "←") : null,
      h("span", { class: "split-label" }, wholeWords(view.groups[side] ?? "")),
      side === 1 ? h("span", { class: "split-arrow", "aria-hidden": "true" }, "→") : null,
    );
  const undo = h("button", { class: "link split-back", type: "button", onclick: back }, "Върни последното");
  // Lays the deck: the next thing on top, the one after it under it.
  const lay = () => {
    const at = sides.peek().length;
    for (const [i, p] of [...pips.children].entries()) p.classList.toggle("done", i < at);
    undo.hidden = at === 0 || at >= n;
    const cards: HTMLElement[] = [];
    const nextText = view.items[at + 1];
    if (nextText !== undefined)
      cards.push(h("div", { class: "split-card under", "aria-hidden": "true" }, wholeWords(nextText)));
    const text = view.items[at];
    if (text !== undefined) {
      const card = h(
        "div",
        { class: "split-card top" },
        h("span", { class: "split-lean on-left", "aria-hidden": "true" }, view.groups[0]),
        h("span", { class: "split-lean on-right", "aria-hidden": "true" }, view.groups[1]),
        h("span", { class: "split-text" }, wholeWords(text)),
      );
      drag(card);
      cards.push(card);
    }
    deck.replaceChildren(...cards);
  };
  const drag = (card: HTMLElement) => {
    card.addEventListener("pointerdown", (e: PointerEvent) => {
      if (locked.peek() || e.button !== 0) return;
      const x0 = e.clientX;
      let dx = 0;
      card.setPointerCapture(e.pointerId);
      card.classList.add("dragging");
      const follow = (ev: PointerEvent) => {
        dx = ev.clientX - x0;
        card.style.transform = `translateX(${dx}px) rotate(${dx / 16}deg)`;
        card.classList.toggle("lean-left", dx < -flingAt / 2);
        card.classList.toggle("lean-right", dx > flingAt / 2);
      };
      const drop = () => {
        card.removeEventListener("pointermove", follow);
        card.removeEventListener("pointerup", drop);
        card.removeEventListener("pointercancel", drop);
        card.classList.remove("dragging", "lean-left", "lean-right");
        if (Math.abs(dx) >= flingAt) send(dx < 0 ? 0 : 1);
        else card.style.transform = "";
      };
      card.addEventListener("pointermove", follow);
      card.addEventListener("pointerup", drop);
      card.addEventListener("pointercancel", drop);
    });
  };
  if (!display)
    listen(document, "keydown", (e: KeyboardEvent) => {
      if (locked.peek() || e.metaKey || e.ctrlKey || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") send(0);
      else if (e.key === "ArrowRight") send(1);
      else if (e.key === "Backspace") back();
      else return;
      e.preventDefault();
    });
  lay();
  const hint = h(
    "p",
    { class: "hint" },
    mouse()
      ? "Прати всяка карта наляво или надясно: плъзни я или натисни стрелките ← →."
      : ["Плъзни всяка карта наляво или надясно", h("span", { class: "sr" }, " или натисни групата ѝ отдолу"), "."],
  );
  // Looked at, not answered: the two groups and every thing to put in them, all at once.
  const board = display
    ? h(
        "div",
        { class: "split split-shown" },
        h(
          "div",
          { class: "split-sides", "aria-hidden": "true" },
          view.groups.map((g, side) =>
            h(
              "span",
              { class: `option split-side ${side === 0 ? "to-left" : "to-right"}` },
              h("span", { class: "split-label" }, wholeWords(g)),
            ),
          ),
        ),
        h(
          "ul",
          { class: "options split-items", "aria-label": `${view.groups[0]} или ${view.groups[1]}?` },
          view.items.map((text) => h("li", { class: "option" }, wholeWords(text))),
        ),
      )
    : h(
        "div",
        { class: "split" },
        hint,
        deck,
        h("div", { class: "split-sides" }, sideButton(0), sideButton(1)),
        h("div", { class: "split-foot" }, pips, undo),
        said,
      );
  const result = h("ol", { class: "options split-result", hidden: true });
  return {
    node: h("div", null, board, result),
    pending: () => {
      const s = sides.peek();
      return s.length ? { sides: view.items.map((_, i) => s[i] ?? -1) } : null;
    },
    reveal(reveal, given) {
      board.hidden = true;
      result.hidden = false;
      const mine = given && "sides" in given ? given.sides : [];
      result.replaceChildren(
        ...view.items.map((text, i) => {
          const group = reveal.sides?.[i] ?? 0;
          const gave = mine[i] ?? -1;
          const ok = !given || gave === group; // nothing given: the right groups alone, as for pairs
          return h(
            "li",
            // Nothing given: right, but none of it the player's (a ✓ in a ring, not a solid one: app.css).
            { class: !given ? "option right untaken" : ok ? "option right" : "option amiss" },
            h(
              "span",
              { class: "split-pair" },
              h("strong", null, wholeWords(text)),
              " — ",
              wholeWords(view.groups[group] ?? ""),
              ok
                ? null
                : h("small", { class: "match-gave" }, gave >= 0 ? `при теб: ${view.groups[gave]}` : "без отговор"),
            ),
            sign(),
          );
        }),
      );
    },
  };
}

/** „Подсказки“: the clues one under another, each with its number (a right answer is right whichever clue it came by: no worth is shown); the
 * ones still to come count down. The four options are there from the start: answer as soon as you know. */
function clues(
  view: CluesView,
  submit: (a: Answer) => void,
  locked: Signal<boolean>,
  say?: (s: string) => void,
  display = false,
): Asked {
  let now = view;
  // A clue come out is said once (the list itself only counts down, and says nothing every second).
  const said = say ? null : h("p", { class: "sr", "aria-live": "polite" });
  const tell = (s: string) => {
    if (say) say(s);
    else if (said) said.textContent = s;
  };
  const born = performance.now() - view.sinceMs; // when the question showed, on this screen's clock
  const rows = Array.from({ length: view.total }, (_, i) =>
    h("li", { class: "clue" }, h("span", { class: "clue-worth" }, String(i + 1)), h("span", { class: "clue-text" })),
  );
  const list = h("ol", { class: "clues" }, rows);
  // The clues still to come, in one line under those out: „Още 2 подсказки: след 10 с и 20 с“.
  const coming = h("p", { class: "clues-next" });
  const paint = (all?: string[]) => {
    const out = all ?? now.clues;
    const elapsed = performance.now() - born;
    const when: string[] = [];
    rows.forEach((row, i) => {
      const text = out[i];
      row.hidden = text === undefined;
      row.className = `clue${!all && i === out.length - 1 ? " now" : all ? "" : " past"}`;
      (row.lastChild as HTMLElement).textContent = text ?? "";
      if (text !== undefined) return;
      const left = Math.ceil(((now.stepsMs[i] ?? 0) - elapsed) / 1000);
      when.push(left > 0 ? `${left}\u00a0с` : "миг");
    });
    const n = when.length;
    coming.hidden = n === 0;
    coming.textContent = `Още ${n === 1 ? "1 подсказка" : `${n} подсказки`}: след ${listWords(when)}`;
  };
  paint();
  // Shown only (display), the clues still come: it's never locked out of them by an answer of its own.
  const open = () => display || !locked.peek();
  const tick = setInterval(() => {
    if (open()) paint();
  }, 1000);
  onCleanup(() => clearInterval(tick));
  const buttons = view.choices.map((text, i) =>
    h(
      "button",
      {
        class: "option",
        type: "button",
        "aria-disabled": locked,
        onclick: () => {
          if (locked.peek()) return;
          buttons[i]?.classList.add("picked");
          play("tap");
          submit({ pick: i });
        },
      },
      h("span", { class: "letter", "aria-hidden": "true" }, letters[i]),
      h("span", { class: "option-words" }, wholeWords(text)),
    ),
  );
  if (!display) answerKeys(buttons, locked);
  return {
    node: h("div", { class: "stack" }, list, coming, said, h("div", { class: "options choices" }, buttons)),
    pending: () => null,
    update(next) {
      if (next.type !== "clues" || next.clues.length <= now.clues.length || !open()) return;
      now = next;
      paint();
      play("key");
      const n = next.clues.length;
      tell(`Подсказка ${n}: ${next.clues[n - 1] ?? ""}`);
    },
    reveal(reveal, given, at = atOnce) {
      clearInterval(tick);
      paint(reveal.clues ?? now.clues);
      const mine = given && "pick" in given ? given.pick : -1;
      const mark = (b: HTMLElement, i: number) => {
        b.classList.remove("picked");
        const how = i === reveal.pick ? "right" : i === mine ? "wrong" : "dim";
        b.classList.add(how);
        if (i === mine) b.classList.add("mine");
        // „ти“, the share and the ✓ or ✕ in one box at the row's end, as a choice's (choice).
        if (how === "dim") return;
        const end = h("span", { class: "row-end" }) as HTMLElement;
        if (how === "wrong") end.append(yours());
        end.append(sign());
        b.append(end);
      };
      const own = buttons[mine];
      if (own) mark(own, mine);
      let crowd = () => {};
      at(beats.right, () => {
        buttons.forEach((b, i) => {
          if (b !== own) mark(b, i);
        });
        crowd = crowdOnAll(buttons, reveal.crowd, mine);
      });
      at(beats.crowd, () => crowd());
    },
  };
}

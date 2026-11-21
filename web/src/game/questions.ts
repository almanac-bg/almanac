// Each question type's screen: how it's asked, how it's answered, and how its answer is shown. One renderer per type,
// as the server has one Go file per type (internal/bank).

import { append, type Child, h, listen, type Signal, signal } from "../lib/dom.ts";
import { ordinal } from "../lib/ordinal.ts";
import { play } from "../lib/sound.ts";
import { hyphenate } from "../lib/words.ts";
import { formatNumber, formatValue, type VerdictKind } from "../ui.ts";
import { percent, rare, withOwn } from "./numbers.ts";
import { optionSizes, overSizes } from "./sizes.ts";
import type {
  Answer,
  ChoiceView,
  Credit,
  Crowd,
  NumberView,
  OrderView,
  Picture,
  Reveal,
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
}

/** A cell's words (an option, a thing to sort): each that may break (hyphenate) held whole in a `.word`, so that
 * it goes to the next line whole where it fits there („Ангел / Каралийчев“, not „Ангел Каралий-/чев“), and breaks, at
 * its syllables, only where it's wider than the cell itself. */
export function wholeWords(text: string): Child {
  return hyphenate(text)
    .split(/(\S*­\S*)/)
    .map((part, i) => (i % 2 ? h("span", { class: "word" }, part) : part));
}

/** How everyone did with a question, in one quiet line under its verdict, as each kind of question counts right:
 * „Вярно отговарят 34% от играчите днес.“ for the day's ten (its players today), without „днес“ for everyone ever;
 * the player among them (withOwn), as on the answers' shares. A right answer few others got stands out, said as the feat it is („Познаха го само 12% от играчите днес.“), and
 * nobody else right is said as such, never as „0%“. Nothing while the question has too few answers to say. */
export function crowdLine(type: View["type"], c: Crowd | undefined, right: boolean): Child {
  if (!c) return null;
  const all = withOwn(c, -1, right).right;
  const s = `${percent(all)} от играчите${c.today ? " днес" : ""}`;
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
  // Near enough to count is right for a number too; „близо“ is only the close answer that isn't.
  const says = type === "order" ? `Изцяло вярно подреждат ${s}.` : `Вярно отговарят ${s}.`;
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
  return () => {
    for (const { b, share, x } of shares) {
      b.classList.add("crowd");
      share.classList.remove("unseen");
      requestAnimationFrame(() => b.style.setProperty("--share", `${Math.round(x * 1000) / 10}%`));
    }
  };
}

/** Draws a question's answering part; submit sends an answer once, and locked stops input. With the answer it shows
 * how everyone else has answered each option (once the question has had enough answers to say); the sentence that
 * sums it up goes under the verdict (crowdLine). `display`: drawn to be looked at, never answered here (a review's):
 * no keys, no line on how to answer, no „Готово“, no grips. A kind the client doesn't know (one retired since a game
 * was played) is its text alone, with nothing to answer. */
export function ask(view: View, submit: (a: Answer) => void, locked: Signal<boolean>, display = false): Asked {
  switch (view.type) {
    case "choice":
      return choice(view, submit, locked, display);
    case "number":
      return number(view, submit, locked, display);
    case "order":
      return order(view, submit, locked, display);
    case "truefalse":
      return truefalse(view, submit, locked, display);
  }
  return { node: null, reveal: () => {}, pending: () => null };
}

/** Draws a question as it was answered, for going over it once the question is past (a review). „Вярно“ and „Невярно“ carry no ✓ while asked; here the right one says it is, for whoever can't tell
 * colours. */
export function answered(view: View, reveal: Reveal, given: Answer | null, how?: VerdictKind): Child {
  const a = ask(view, () => {}, signal(true), true);
  a.reveal(reveal, given, undefined, how);
  if (a.node instanceof Element)
    a.node.querySelector(".option.tf.right")?.append(h("small", { class: "tf-right" }, "верният отговор"));
  return a.node;
}

/** An answer named inside a sentence, in quotes unless it brings its own. */
const quoted = (name: string) => (/^[„"«]/.test(name) ? name : `„${name}“`);

/** The right answer as a screen reader says it after a miss, where one short sentence holds it: „Верният отговор е „Бийтълс“.“
 * (none for an order: its rows say it). */
export function spokenAnswer(view: View, reveal: Reveal): string {
  if (view.type === "truefalse") return reveal.truth ? "Твърдението е вярно." : "Твърдението е невярно.";
  const name = answerWords(view, reveal);
  if (!name) return "";
  return `Верният отговор е ${view.type === "number" ? name : quoted(name)}.`;
}

/** The right answer in a few words, where a few words hold it: a choice's option, a number with its unit, „Вярно“ or
 * „Невярно“ for a statement; "" for an order (its rows say it). */
export function answerWords(view: View, reveal: Reveal): string {
  switch (view.type) {
    case "choice": {
      const pick = reveal.pick ?? -1;
      return reveal.names?.[pick] ?? view.choices?.[pick] ?? view.pictures?.[pick]?.alt ?? "";
    }
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
      // Answered, the answer sizes it (run.ts, room).
      if (!img.isConnected || !below || img.closest(".answered")) return;
      const box = img.getBoundingClientRect();
      const under = below.getBoundingClientRect();
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

/** The key that gives an answer, beside it while it's asked (shown on a computer only: app.css): 1–4, the same on
 * every keyboard layout, Latin or Cyrillic. */
const keyHint = (key: string) => h("kbd", { class: "key-hint", "aria-hidden": "true" }, key);

/** Keys 1–4 press the answer they mark, while the question waits for one (never in a field, never with a modifier). */
function answerKeys(buttons: HTMLElement[], locked: Signal<boolean>): void {
  listen(document, "keydown", (e: KeyboardEvent) => {
    if (locked.peek() || e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.target instanceof HTMLInputElement) return;
    buttons[Number(e.key) - 1]?.click();
  });
}

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
            display ? null : keyHint(String(i + 1)),
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
              display ? null : keyHint(String(i + 1)),
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
        h("p", { class: "number-answer" }, "Верният отговор: ", h("strong", null, `${said(answer)}${unit}`), "."),
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
 * two ends named: the answer a filled square; the player's a filled disc when it was near enough to be right, half
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
 * the guesses beyond it, the answer's part in the colour of a right answer and the player's own in theirs. */
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
  const theirs = mine === null ? -1 : column(mine);
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
      said.textContent = `Взе „${view.items[item]}“. Докосни мястото, където да отиде.`;
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
        "Докосни ред, после новото му място, или го плъзни.",
        h("span", { class: "sr" }, " Стрелките нагоре и надолу също го местят."),
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
                ? h("small", { class: "row-gave" }, `при теб: ${ordinal(at + 1, "n")}`)
                : null,
            ),
            // The value and the ✓ or ✕ in one box: under the words, where they don't fit beside them, together.
            h(
              "span",
              { class: "row-end" },
              h("span", { class: "value" }, `${formatValue(reveal.values?.[item] ?? 0)}${unit}`),
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
      display ? null : keyHint(truth ? "1" : "2"),
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

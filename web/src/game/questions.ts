// Each question type's screen: how it's asked, how it's answered, and how its answer is shown. One renderer per type,
// as the server has one Go file per type (internal/bank).

import { append, type Child, effect, h, listen, onCleanup, type Signal, signal } from "../lib/dom.ts";
import { ordinal } from "../lib/ordinal.ts";
import { play } from "../lib/sound.ts";
import { formatNumber } from "../ui.ts";
import type {
  Answer,
  ChoiceView,
  CluesView,
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

export interface Asked {
  /** The answering part, under the question. */
  node: Child;
  /** Shows the answer: what was right, and how what was given compares. */
  reveal(reveal: Reveal, given: Answer | null): void;
  /** What's been put in but not sent yet (a typed number, things moved into an order): it counts when time runs out. */
  pending(): Answer | null;
  /** Takes a newer view of the same question, as more of it shows (the next clue). */
  update?(view: View): void;
}

/** Draws a question's answering part; submit sends an answer once, and locked stops input. With the answer it tells
 * how everyone else has answered (once the question has had enough answers to say). */
export function ask(view: View, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
  const a = askType(view, submit, locked);
  const says = h("p", { class: "crowd-says", hidden: true });
  return {
    node: h("div", { class: "stack" }, a.node, says),
    pending: a.pending,
    update: a.update,
    reveal(reveal, given) {
      a.reveal(reveal, given);
      const line = reveal.crowd ? crowdSays(view.type, reveal.crowd) : "";
      says.textContent = line;
      says.hidden = !line;
    },
  };
}

/** A share as the game writes it: „58%“, and „под 1%“ for what rounds to nothing but isn't. */
export function share(x: number): string {
  return x > 0 && x < 0.005 ? "под 1%" : `${Math.round(x * 100)}%`;
}

/** How everyone else did, in one sentence, as each kind of question counts right. */
function crowdSays(type: View["type"], c: Crowd): string {
  const s = share(c.right);
  switch (type) {
    case "choice":
    case "truefalse":
    case "clues":
      return `Вярно отговарят ${s} от играчите.`;
    case "number":
      return `Достатъчно близо са ${s} от играчите.`;
    case "order":
      return `Изцяло вярно подреждат ${s} от играчите.`;
    case "match":
      return `Всички двойки свързват ${s} от играчите.`;
    case "split":
      return `Всичко на място слагат ${s} от играчите.`;
  }
}

/** Shows on an answer what share of players gave it: a bar behind it, filling in, and the share beside it. */
function crowdOn(button: HTMLElement, x: number): void {
  button.classList.add("crowd");
  button.append(h("span", { class: "value crowd-share" }, share(x)));
  requestAnimationFrame(() => button.style.setProperty("--share", `${Math.round(x * 1000) / 10}%`));
}

function askType(view: View, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
  switch (view.type) {
    case "choice":
      return choice(view, submit, locked);
    case "number":
      return number(view, submit, locked);
    case "order":
      return order(view, submit, locked);
    case "truefalse":
      return truefalse(view, submit, locked);
    case "match":
      return match(view, submit, locked);
    case "split":
      return split(view, submit, locked);
    case "clues":
      return clues(view, submit, locked);
  }
}

/** Draws a question as it was answered, for going over a run. */
export function answered(view: View, reveal: Reveal, given: Answer | null): Child {
  const a = ask(view, () => {}, signal(true));
  a.reveal(reveal, given);
  return a.node;
}

/** How the question's picture and a choice's pictures are drawn: the size each takes on the screen, for the browser
 * to pick a file by. */
const overSizes = "(max-width: 36rem) 100vw, 36rem";
const optionSizes = "(max-width: 36rem) 46vw, 18rem";

/** The least a question's picture is drawn at, however little room the screen has. */
const pictureFloor = 128;

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
    sizes: overSizes,
    width: im.w,
    height: im.h,
    alt: im.alt,
    decoding: "async",
  });
  if (fit) {
    // The answering part follows the picture; the room it leaves is the screen's height less the question's height
    // without the picture (as if the page were at its top, where a question opens), and a margin under it.
    const size = () => {
      const below = img.nextElementSibling;
      if (!img.isConnected || !below) return;
      const end = below.getBoundingClientRect().bottom + scrollY - img.getBoundingClientRect().height;
      img.style.setProperty("--fit", `${Math.max(pictureFloor, Math.floor(innerHeight - end - 16))}px`);
    };
    requestAnimationFrame(size);
    listen(window, "resize", size);
  }
  return img;
}

/** Loads a question's pictures as its screen will show them, so that its time can start once they're in: done when
 * each is decoded (or has failed), or after `ms` at most. */
export function picturesIn(view: View, ms: number): Promise<void> {
  const files: [Picture, string][] = [];
  if (view.image) files.push([view.image, overSizes]);
  if (view.type === "choice") for (const p of view.pictures ?? []) files.push([p, optionSizes]);
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

const letters = ["А", "Б", "В", "Г"];

/** The ✓ or ✕ on a revealed answer (its colour and words say the same). */
const sign = () => h("span", { class: "sign", "aria-hidden": "true" });

function choice(view: ChoiceView, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
  const pictures = view.pictures;
  const names = pictures?.map(() => h("span", { class: "pic-name" })) ?? [];
  const buttons = (pictures ?? view.choices ?? []).map((option, i) =>
    h(
      "button",
      {
        class: pictures ? "option pic-option" : "option",
        type: "button",
        disabled: locked,
        "aria-label": typeof option === "string" ? null : `${letters[i]}: ${option.alt}`,
        onclick: () => {
          if (locked.peek()) return;
          buttons[i]?.classList.add("picked");
          play("tap");
          submit({ pick: i });
        },
      },
      typeof option === "string"
        ? [h("span", { class: "letter", "aria-hidden": "true" }, letters[i]), h("span", null, option)]
        : [
            h("img", {
              class: "pic-option-img",
              src: option.src,
              srcset: option.srcset,
              sizes: optionSizes,
              width: option.w,
              height: option.h,
              alt: "",
              decoding: "async",
            }),
            h(
              "span",
              { class: "pic-foot" },
              h("span", { class: "letter pic-letter", "aria-hidden": "true" }, letters[i]),
              names[i],
            ),
          ],
    ),
  );
  const credits = h("p", { class: "credit pic-credits", hidden: true });
  return {
    node: h("div", null, h("div", { class: pictures ? "options pic-options" : "options" }, buttons), credits),
    pending: () => null,
    reveal(reveal, given) {
      buttons.forEach((b, i) => {
        b.classList.remove("picked");
        const how = i === reveal.pick ? "right" : given && "pick" in given && given.pick === i ? "wrong" : "dim";
        b.classList.add(how);
        const name = reveal.names?.[i];
        if (name) {
          names[i]?.replaceChildren(name);
          b.setAttribute("aria-label", `${letters[i]}: ${name}`);
        }
        const picked = reveal.crowd?.picks?.[i];
        if (picked !== undefined) crowdOn(b, picked);
        if (how !== "dim") (b.querySelector(".pic-foot") ?? b).append(sign());
      });
      if (reveal.credits?.length) {
        credits.hidden = false;
        credits.replaceChildren(
          "Снимки: ",
          ...reveal.credits.flatMap((c, i) => [
            i ? " · " : "",
            h("a", { href: c.source, target: "_blank", rel: "noopener" }, `${letters[i]} ${c.credit}`),
            ` (${c.license})`,
          ]),
        );
      }
    },
  };
}

/** The keys of the number pad, row by row ("" is a gap, "," a decimal comma). */
function keys(view: NumberView): string[] {
  const decimal = view.step < 1;
  return ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimal ? "," : "", "0", "⌫"];
}

/** A number, typed on a pad of its own (no phone keyboard over the question) or on a computer's keys. */
function number(view: NumberView, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
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
              "aria-label": "Под нулата",
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
    reveal(reveal, given) {
      pad.hidden = true;
      result.hidden = false;
      const right = `${formatNumber(reveal.value ?? 0, view.step)}${unit}`;
      append(result, [
        h("p", { class: "number-answer" }, h("span", { class: "kicker" }, "Отговор"), " ", h("strong", null, right)),
        given && "value" in given
          ? h("p", { class: "muted" }, `Ти каза ${formatNumber(given.value, view.step)}${unit}.`)
          : h("p", { class: "muted" }, "Без отговор."),
        reveal.crowd?.guesses
          ? spread(reveal.crowd.guesses, reveal.value ?? 0, given && "value" in given ? given.value : null, view)
          : null,
      ]);
    },
  };
}

/** Where everyone's guesses at a number fell: a bar for each part of the range a guess scores in, one at each end for
 * the guesses beyond it, the answer's part in the colour of a right answer and the player's own in theirs. */
function spread(s: Spread, answer: number, mine: number | null, view: NumberView): Child {
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
      class: "spread-bars",
      role: "img",
      "aria-label": `${share(inRange)} от догадките са между ${formatNumber(s.lo, view.step)} и ${formatNumber(s.hi, view.step)}${unit}.`,
      style: { "grid-template-columns": `0.6fr repeat(${n}, 1fr) 0.6fr` },
    },
    shares.map((x, k) =>
      h("span", {
        class: ["spread-bar", (k === 0 || k === n + 1) && "edge", k === theirs && "mine", k === theAnswer && "answer"]
          .filter(Boolean)
          .join(" "),
        style: { height: `${Math.max(3, (x / top) * 100)}%` },
      }),
    ),
  );
  return h(
    "div",
    { class: "spread" },
    h("span", { class: "kicker" }, "Догадките на играчите"),
    bars,
    h(
      "div",
      { class: "spread-axis", "aria-hidden": "true" },
      h("span", null, formatNumber(s.lo, view.step)),
      h("span", null, `${formatNumber(s.hi, view.step)}${unit}`),
    ),
    h(
      "div",
      { class: "spread-key", "aria-hidden": "true" },
      h("span", null, h("i", { class: "spread-swatch answer" }), "отговорът"),
      mine === null ? null : h("span", null, h("i", { class: "spread-swatch mine" }), "твоята"),
      h("span", null, h("i", { class: "spread-swatch edge" }), "извън целта"),
    ),
  );
}

let orders = 0; // for each order's hint its own id

/** Things to put in order: dragged into place (or moved with the arrow keys), then sent with „Готово“. */
function order(view: OrderView, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
  const how = `order-how-${++orders}`;
  const n = view.items.length;
  const arrangement = view.items.map((_, i) => i); // the item at each place
  let moved = false;
  const said = h("p", { class: "sr", "aria-live": "polite" });
  const rows = view.items.map((text) =>
    h(
      "li",
      { class: "option sortable", tabindex: 0, "aria-describedby": how },
      h("span", { class: "letter", "aria-hidden": "true" }),
      h("span", null, text),
      h("span", { class: "grip", "aria-hidden": "true" }),
    ),
  );
  const list = h("ol", { class: "options sortable-list" });
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
  rows.forEach((row, item) => {
    row.addEventListener("pointerdown", (e: PointerEvent) => {
      if (locked.peek() || e.button !== 0) return;
      const from = arrangement.indexOf(item);
      const first = rows[arrangement[0] ?? 0] as HTMLElement;
      const second = rows[arrangement[1] ?? 0] as HTMLElement;
      const pitch = n > 1 ? second.offsetTop - first.offsetTop : row.offsetHeight;
      const y0 = e.clientY;
      let to = from;
      row.setPointerCapture(e.pointerId);
      row.classList.add("dragging");
      list.classList.add("sorting");
      const follow = (ev: PointerEvent) => {
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
        row.classList.remove("dragging");
        list.classList.remove("sorting");
        if (to !== from && !locked.peek()) move(from, to);
        else lay();
      };
      row.addEventListener("pointermove", follow);
      row.addEventListener("pointerup", drop);
      row.addEventListener("pointercancel", drop);
    });
    row.addEventListener("keydown", (e: KeyboardEvent) => {
      if (locked.peek()) return;
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
      class: "btn primary",
      disabled: locked,
      onclick: () => {
        if (locked.peek()) return;
        play("tap");
        submit({ order: [...arrangement] });
      },
    },
    "Готово",
  );
  const hint = h(
    "p",
    { class: "hint", id: how },
    "Плъзни ги в правилния ред",
    h("span", { class: "sr" }, " или ги мести със стрелките нагоре и надолу"),
    ".",
  );
  return {
    node: h("div", { class: "stack" }, hint, list, said, done),
    pending: () => (moved ? { order: [...arrangement] } : null),
    reveal(reveal, given) {
      hint.hidden = true;
      done.hidden = true;
      const mine = given && "order" in given ? given.order : [];
      const unit = reveal.unit ? ` ${reveal.unit}` : "";
      list.replaceChildren(
        ...(reveal.order ?? []).map((item, place) =>
          h(
            "li",
            { class: mine[place] === item ? "option right" : "option wrong" },
            h("span", { class: "letter" }, String(place + 1)),
            h("span", null, view.items[item] ?? ""),
            h("span", { class: "value" }, `${formatNumber(reveal.values?.[item] ?? 0, 0.01)}${unit}`),
            sign(),
          ),
        ),
      );
    },
  };
}

/** „Вярно или невярно“: two answers, side by side (keys 1 and 2 too). */
function truefalse(_view: TrueFalseView, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
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
        class: `option tf ${truth ? "tf-yes" : "tf-no"}`,
        type: "button",
        disabled: locked,
        onclick: () => pick(truth),
      },
      h("span", { class: "tf-mark", "aria-hidden": "true" }),
      h("span", null, truth ? "Вярно" : "Невярно"),
    );
  const yes = button(true);
  const no = button(false);
  listen(document, "keydown", (e: KeyboardEvent) => {
    if (locked.peek() || e.metaKey || e.ctrlKey || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "1") pick(true);
    else if (e.key === "2") pick(false);
  });
  return {
    node: h("div", { class: "tf-options" }, yes, no),
    pending: () => null,
    reveal(reveal, given) {
      for (const [b, truth] of [
        [yes, true],
        [no, false],
      ] as const) {
        b.classList.remove("picked");
        const how =
          truth === reveal.truth ? "right" : given && "truth" in given && given.truth === truth ? "wrong" : "dim";
        b.classList.add(how);
        const said = reveal.crowd?.picks?.[truth ? 0 : 1];
        if (said !== undefined) crowdOn(b, said);
        if (how !== "dim") b.append(sign());
      }
    },
  };
}

/** The tone each pair of a match is drawn in, by its left's place (with its number, for whoever can't tell colours). */
const pairTones = ["tone-gold", "tone-sky", "tone-rose", "tone-lilac"];

/** „Свържи“: tap a thing on the left, then its pair on the right (or the other way round); a line joins them. A
 * joined one tapped again comes apart. */
function match(view: MatchView, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
  const pairs = signal<number[]>(view.left.map(() => -1)); // for each left, its right (-1: none yet)
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
          return [
            "option",
            "match-item",
            k >= 0 && `joined ${pairTones[k]}`,
            c && c.side === side && c.i === i && "chosen",
          ]
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
          return k >= 0 && other ? `${text}, свързано с ${other}` : text;
        },
        onclick: () => tap(side, i),
      },
      h("span", { class: "letter", "aria-hidden": "true" }, () => {
        const k = pairOf();
        return k >= 0 ? String(k + 1) : "";
      }),
      h("span", null, text),
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
        line.setAttribute("class", pairTones[i] ?? "");
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
      class: "btn primary",
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
    { class: "hint" },
    "Докосни нещо отляво, после двойката му отдясно.",
    spare ? " Едно отдясно е без двойка." : null,
  );
  const result = h("ol", { class: "options match-result", hidden: true });
  const decoy = h("p", { class: "hint match-decoy", hidden: true });
  return {
    node: h("div", { class: "stack" }, hint, grid, said, done, result, decoy),
    pending: () => (pairs.peek().some((j) => j !== -1) ? { pairs: [...pairs.peek()] } : null),
    reveal(reveal, given) {
      hint.hidden = true;
      grid.hidden = true;
      done.hidden = true;
      result.hidden = false;
      const mine = given && "pairs" in given ? given.pairs : [];
      result.replaceChildren(
        ...view.left.map((left, i) => {
          const j = reveal.pairs?.[i] ?? -1;
          const ok = mine[i] === j;
          const gave = mine[i] ?? -1;
          return h(
            "li",
            { class: ok ? "option right" : "option wrong" },
            h(
              "span",
              { class: "match-pair" },
              h("strong", null, left),
              " — ",
              view.right[j] ?? "",
              ok ? null : h("small", { class: "match-gave" }, gave >= 0 ? `ти: ${view.right[gave]}` : "без връзка"),
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
function split(view: SplitView, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
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
    said.textContent = `„${view.items[at]}“: ${view.groups[side]}.`;
    sides.update((s) => [...s, side]);
    if (at + 1 === n) submit({ sides: [...sides.peek()] });
    else window.setTimeout(lay, 180);
  };
  const back = () => {
    if (locked.peek() || sides.peek().length === 0) return;
    sides.update((s) => s.slice(0, -1));
    play("tap");
    lay();
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
      h(
        "span",
        { class: "split-label" },
        side === 0 ? h("span", { class: "split-arrow", "aria-hidden": "true" }, "← ") : null,
        view.groups[side],
        side === 1 ? h("span", { class: "split-arrow", "aria-hidden": "true" }, " →") : null,
      ),
    );
  const undo = h("button", { class: "link split-back", type: "button", onclick: back }, "Върни последното");
  // Lays the deck: the next thing on top, the one after it under it.
  const lay = () => {
    const at = sides.peek().length;
    for (const [i, p] of [...pips.children].entries()) p.classList.toggle("done", i < at);
    undo.hidden = at === 0 || at >= n;
    const cards: HTMLElement[] = [];
    const nextText = view.items[at + 1];
    if (nextText !== undefined) cards.push(h("div", { class: "split-card under", "aria-hidden": "true" }, nextText));
    const text = view.items[at];
    if (text !== undefined) {
      const card = h(
        "div",
        { class: "split-card top", "aria-live": "polite" },
        h("span", { class: "split-lean on-left", "aria-hidden": "true" }, view.groups[0]),
        h("span", { class: "split-lean on-right", "aria-hidden": "true" }, view.groups[1]),
        h("span", { class: "split-text" }, text),
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
    "Плъзни всяко наляво или надясно",
    h("span", { class: "sr" }, " или натисни групата му отдолу"),
    ".",
  );
  const board = h(
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
          const ok = gave === group;
          return h(
            "li",
            { class: ok ? "option right" : "option wrong" },
            h(
              "span",
              { class: "split-pair" },
              h("strong", null, text),
              " — ",
              view.groups[group] ?? "",
              ok ? null : h("small", { class: "match-gave" }, gave >= 0 ? `ти: ${view.groups[gave]}` : "без отговор"),
            ),
            sign(),
          );
        }),
      );
    },
  };
}

/** What a right answer to a clues question is worth after each number of clues (bank.ClueWorth). */
const clueWorth = [1, 0.6, 0.3];

/** „Подсказки“: the clues one under another, each with what a right answer is worth while it's the last one out; the
 * ones still to come count down. The four options are there from the start: answer as soon as you know. */
function clues(view: CluesView, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
  let now = view;
  const born = performance.now() - view.sinceMs; // when the question showed, on this screen's clock
  const rows = Array.from({ length: view.total }, (_, i) =>
    h(
      "li",
      { class: "clue" },
      h("span", { class: "clue-worth" }, share(clueWorth[i] ?? 0)),
      h("span", { class: "clue-text" }),
    ),
  );
  const list = h("ol", { class: "clues", "aria-live": "polite" }, rows);
  const paint = (all?: string[]) => {
    const out = all ?? now.clues;
    const elapsed = performance.now() - born;
    rows.forEach((row, i) => {
      const text = out[i];
      row.className = `clue${text === undefined ? " locked" : !all && i === out.length - 1 ? " now" : all ? "" : " past"}`;
      const left = Math.ceil(((now.stepsMs[i] ?? 0) - elapsed) / 1000);
      (row.lastChild as HTMLElement).textContent =
        text ?? (left > 0 ? `Подсказка ${i + 1} идва след ${left} с` : `Подсказка ${i + 1} идва…`);
    });
  };
  paint();
  const tick = setInterval(() => {
    if (!locked.peek()) paint();
  }, 1000);
  onCleanup(() => clearInterval(tick));
  const buttons = view.choices.map((text, i) =>
    h(
      "button",
      {
        class: "option",
        type: "button",
        disabled: locked,
        onclick: () => {
          if (locked.peek()) return;
          buttons[i]?.classList.add("picked");
          play("tap");
          submit({ pick: i });
        },
      },
      h("span", { class: "letter", "aria-hidden": "true" }, letters[i]),
      h("span", null, text),
    ),
  );
  return {
    node: h("div", { class: "stack" }, list, h("div", { class: "options" }, buttons)),
    pending: () => null,
    update(next) {
      if (next.type !== "clues" || next.clues.length <= now.clues.length || locked.peek()) return;
      now = next;
      paint();
      play("key");
    },
    reveal(reveal, given) {
      clearInterval(tick);
      paint(reveal.clues ?? now.clues);
      buttons.forEach((b, i) => {
        b.classList.remove("picked");
        const how = i === reveal.pick ? "right" : given && "pick" in given && given.pick === i ? "wrong" : "dim";
        b.classList.add(how);
        const picked = reveal.crowd?.picks?.[i];
        if (picked !== undefined) crowdOn(b, picked);
        if (how !== "dim") b.append(sign());
      });
    },
  };
}

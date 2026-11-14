// Each question type's screen: how it's asked, how it's answered, and how its answer is shown. One renderer per type,
// as the server has one Go file per type (internal/bank).

import { append, type Child, effect, h, listen, onCleanup, type Signal, signal } from "../lib/dom.ts";
import { ordinal } from "../lib/ordinal.ts";
import { play } from "../lib/sound.ts";
import { formatNumber } from "../ui.ts";
import type { Answer, ChoiceView, MatchView, NumberView, OrderView, Reveal, TrueFalseView, View } from "./types.ts";

export interface Asked {
  /** The answering part, under the question. */
  node: Child;
  /** Shows the answer: what was right, and how what was given compares. */
  reveal(reveal: Reveal, given: Answer | null): void;
  /** What's been put in but not sent yet (a typed number, things moved into an order): it counts when time runs out. */
  pending(): Answer | null;
}

/** Draws a question's answering part; submit sends an answer once, and locked stops input. */
export function ask(view: View, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
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
  }
}

/** Draws a question as it was answered, for going over a run. */
export function answered(view: View, reveal: Reveal, given: Answer | null): Child {
  const a = ask(view, () => {}, signal(true));
  a.reveal(reveal, given);
  return a.node;
}

export function picture(view: View): Child {
  const im = view.image;
  if (!im) return null;
  return h("img", {
    class: "picture",
    src: im.src,
    srcset: im.srcset,
    sizes: "(max-width: 36rem) 100vw, 36rem",
    width: im.w,
    height: im.h,
    alt: im.alt,
    decoding: "async",
  });
}

const letters = ["А", "Б", "В", "Г"];

/** The ✓ or ✕ on a revealed answer (its colour and words say the same). */
const sign = () => h("span", { class: "sign", "aria-hidden": "true" });

function choice(view: ChoiceView, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
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
    node: h("div", { class: "options" }, buttons),
    pending: () => null,
    reveal(reveal, given) {
      buttons.forEach((b, i) => {
        b.classList.remove("picked");
        const how = i === reveal.pick ? "right" : given && "pick" in given && given.pick === i ? "wrong" : "dim";
        b.classList.add(how);
        if (how !== "dim") b.append(sign());
      });
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
                class: k === "⌫" ? "key back" : "key",
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
      ]);
    },
  };
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
  const hint = h("p", { class: "hint" }, "Докосни нещо отляво, после двойката му отдясно.");
  const result = h("ol", { class: "options match-result", hidden: true });
  return {
    node: h("div", { class: "stack" }, hint, grid, said, done, result),
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
    },
  };
}

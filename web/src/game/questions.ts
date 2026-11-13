// Each question type's screen: how it's asked, how it's answered, and how its answer is shown. One renderer per type,
// as the server has one Go file per type (internal/bank).

import { append, type Child, h, type Signal, signal } from "../lib/dom.ts";
import { play } from "../lib/sound.ts";
import type { Answer, ChoiceView, NumberView, OrderView, Reveal, View } from "./types.ts";

export interface Asked {
  /** The answering part, under the question. */
  node: Child;
  /** Shows the answer: what was right, and how what was given compares. */
  reveal(reveal: Reveal, given: Answer | null): void;
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

/** A number as people write it in Bulgarian: a space between thousands, a decimal comma. */
export function formatNumber(n: number, step = 1): string {
  const decimals = Math.max(0, (String(step).split(".")[1] ?? "").length);
  return new Intl.NumberFormat("bg", { maximumFractionDigits: decimals, useGrouping: Math.abs(n) >= 10000 }).format(n);
}

function number(view: NumberView, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
  const text = signal("");
  const value = () => Number(text().replace(/\s/g, "").replace(",", "."));
  const valid = () => text().trim() !== "" && Number.isFinite(value());
  const unit = view.unit ? ` ${view.unit}` : "";
  const result = h("div", { class: "number-result", hidden: true });
  const form = h(
    "form",
    {
      class: "number",
      onsubmit: (e: SubmitEvent) => {
        e.preventDefault();
        if (!locked.peek() && valid()) {
          play("tap");
          submit({ value: value() });
        }
      },
    },
    h(
      "label",
      { class: "field" },
      h(
        "span",
        { class: "muted" },
        `Между ${formatNumber(view.min, view.step)} и ${formatNumber(view.max, view.step)}${unit}`,
      ),
      h(
        "span",
        { class: "number-input" },
        h("input", {
          inputmode: view.step < 1 ? "decimal" : "numeric",
          autocomplete: "off",
          enterkeyhint: "done",
          "aria-label": "Твоят отговор",
          disabled: locked,
          oninput: (e: Event) => text.set((e.target as HTMLInputElement).value),
          ref: (el) => queueMicrotask(() => el.focus({ preventScroll: true })),
        }),
        view.unit ? h("span", { class: "unit" }, view.unit) : null,
      ),
    ),
    h("button", { class: "btn primary", disabled: () => locked() || !valid() }, "Отговори"),
  );
  return {
    node: h("div", null, form, result),
    reveal(reveal, given) {
      form.hidden = true;
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

function order(view: OrderView, submit: (a: Answer) => void, locked: Signal<boolean>): Asked {
  const placed = signal<number[]>([]);
  const toggle = (i: number) => {
    if (locked.peek()) return;
    play("tap");
    placed.update((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  };
  const rows = view.items.map((text, i) =>
    h(
      "button",
      {
        class: () => (placed().includes(i) ? "option placed" : "option"),
        type: "button",
        disabled: locked,
        "aria-pressed": () => placed().includes(i),
        onclick: () => toggle(i),
      },
      h("span", { class: "letter", "aria-hidden": "true" }, () => {
        const at = placed().indexOf(i);
        return at < 0 ? "" : String(at + 1);
      }),
      h("span", null, text),
    ),
  );
  const list = h("div", { class: "options" }, rows);
  const done = h(
    "button",
    {
      class: "btn primary",
      disabled: () => locked() || placed().length !== view.items.length,
      onclick: () => submit({ order: placed.peek() }),
    },
    "Готово",
  );
  const hint = h("p", { class: "hint" }, "Докосни ги подред. Второ докосване маха избора.");
  return {
    node: h("div", { class: "stack" }, hint, list, done),
    reveal(reveal, given) {
      hint.hidden = true;
      done.hidden = true;
      const mine = given && "order" in given ? given.order : [];
      const unit = reveal.unit ? ` ${reveal.unit}` : "";
      list.replaceChildren(
        ...(reveal.order ?? []).map((item, place) =>
          h(
            "div",
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

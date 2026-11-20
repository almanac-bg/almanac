// The ways to play with others, as small cards two by two: each with its picture, its name, a few words about it, and
// its colour.

import { picture } from "../art/picture.ts";
import { type Child, h } from "../lib/dom.ts";

type Mode = "duel";

const all: Record<Mode, { href: string; name: string; about: string; tone: string }> = {
  duel: {
    href: "/duel",
    name: "Дуел",
    about: "Един срещу един",
    tone: "tone-rose",
  },
};

export function modes(which: Mode[], heading?: string): Child {
  return h(
    "section",
    { class: "stack" },
    heading ? h("h2", { class: "section-title" }, heading) : null,
    h(
      "ul",
      { class: "modes" },
      which.map((m) => {
        const it = all[m];
        return h(
          "li",
          null,
          h(
            "a",
            { class: `mode ${it.tone}`, href: it.href },
            picture(`mode-${m}`, "mode-pic"),
            h(
              "span",
              { class: "mode-text" },
              h("span", { class: "mode-name" }, it.name),
              h("span", { class: "mode-about" }, it.about),
            ),
          ),
        );
      }),
    ),
  );
}

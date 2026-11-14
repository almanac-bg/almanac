// The ways to play with others, as cards: each with its picture, its name, a line about it, and its colour.

import { picture } from "../art/picture.ts";
import { type Child, h } from "../lib/dom.ts";

type Mode = "duel" | "arena" | "royal" | "room";

const all: Record<Mode, { href: string; name: string; about: string; tone: string }> = {
  duel: {
    href: "/duel",
    name: "Дуел",
    about: "Ти срещу друг играч, на живо.",
    tone: "tone-rose",
  },
  arena: {
    href: "/arena",
    name: "Арена",
    about: "От трима до петима играчи, на живо.",
    tone: "tone-sky",
  },
  royal: {
    href: "/royal",
    name: "Роял",
    about: "Всяка вечер в 21:00, на живо. Грешката те изважда.",
    tone: "tone-gold",
  },
  room: { href: "/room", name: "Стая", about: "Всички на един въпрос, на живо.", tone: "tone-lilac" },
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
            h("span", { class: "mode-name" }, it.name),
            h("span", { class: "mode-about" }, it.about),
          ),
        );
      }),
    ),
  );
}

// The ways to play, as cards: each with its name, a line about it, and its colour.

import { type Child, h } from "../lib/dom.ts";

type Mode = "topics" | "duel" | "royal" | "room";

const all: Record<Mode, { href: string; name: string; about: string; tone: string; icon: string }> = {
  topics: { href: "/play", name: "Теми", about: "Десет въпроса от една тема.", tone: "tone-sky", icon: "play" },
  duel: {
    href: "/duel",
    name: "Дуел",
    about: "Ти срещу друг играч, на живо.",
    tone: "tone-rose",
    icon: "bolt",
  },
  royal: {
    href: "/royal",
    name: "Роял",
    about: "До двадесет играчи. Грешката те изважда.",
    tone: "tone-gold",
    icon: "crown",
  },
  room: { href: "/room", name: "Стая", about: "Всички на един въпрос, на живо.", tone: "tone-lilac", icon: "users" },
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
            h("span", { class: `mode-icon i i-${it.icon}`, "aria-hidden": "true" }),
            h("span", { class: "mode-name" }, it.name),
            h("span", { class: "mode-about" }, it.about),
          ),
        );
      }),
    ),
  );
}

// Стая: a room for many at once — on everyone's phone, around a table or across a classroom. Here one is opened, or
// joined by its code.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { categories, player } from "../state.ts";
import { back, pageArt, segmented, toneOf, topicMark } from "../ui.ts";

/** How hard a room's questions are, as its host chooses: Лесни are easy and medium, Трудни medium and hard. */
export const mixes: [Mix, string][] = [
  ["easy", "Лесни"],
  ["mixed", "Смесени"],
  ["hard", "Трудни"],
];
export type Mix = "easy" | "mixed" | "hard";

export function rooms() {
  title("Стая");
  const error = signal("");
  const codeError = signal("");
  const code = signal("");
  const length = signal(10);
  const mix = signal<Mix>("mixed");
  const open = async (category: string) => {
    error.set("");
    try {
      await player();
      const r = await api<{ code: string }>("POST", "/api/rooms", {
        category,
        length: length.peek(),
        mix: mix.peek(),
      });
      go(`/r/${r.code}`);
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  // Opening a room is an action, not a place: a button per topic.
  const topic = (id: string, name: string): Child =>
    h(
      "li",
      null,
      h(
        "button",
        { class: `chip ${id ? toneOf(id) : "tone-gold"}`, type: "button", onclick: () => open(id) },
        topicMark(id),
        name,
      ),
    );
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      back("/", "Начало"),
      pageArt("room", "tone-lilac"),
      h("h1", null, "Стая"),
      h(
        "p",
        { class: "lead" },
        "За приятели, семейство или клас: всички получават един и същ въпрос в един и същ момент, всеки на телефона си.",
      ),
    ),
    h(
      "section",
      { class: "card" },
      h("h2", { class: "card-title" }, "Влез с код"),
      h(
        "form",
        {
          class: "join",
          onsubmit: (e: SubmitEvent) => {
            e.preventDefault();
            const c = code.peek().replace(/\D/g, "");
            if (c.length === 6) go(`/r/${c}`);
            else codeError.set("Кодът е от 6 цифри.");
          },
        },
        h("input", {
          class: "code",
          inputmode: "numeric",
          autocomplete: "off",
          maxlength: 7,
          placeholder: "6 цифри",
          "aria-label": "Код на стаята",
          oninput: (e: Event) => {
            code.set((e.target as HTMLInputElement).value);
            codeError.set("");
          },
        }),
        h("button", { class: "btn" }, "Влез"),
      ),
      () => codeError() && h("p", { class: "bad", role: "alert" }, codeError()),
    ),
    h(
      "section",
      { class: "card" },
      h("h2", { class: "card-title" }, "Отвори нова стая"),
      h("p", { class: "muted" }, "Колко въпроса и колко трудни, после тема. Накрая дай кода на другите."),
      setting(
        "Въпроси",
        segmented(
          "Въпроси",
          [5, 10, 15, 20].map((n) => [n, String(n)]),
          length,
          length.set,
          false,
          true,
        ),
      ),
      setting("Трудност", segmented("Трудност", mixes, mix, mix.set, false, true)),
      h(
        "ul",
        { class: "chips" },
        topic("", "Всички теми"),
        categories.map((c) => topic(c.id, c.name)),
      ),
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** A setting of a room: its name over its choices. */
function setting(name: string, control: Child): Child {
  return h("div", { class: "field" }, h("span", { "aria-hidden": "true" }, name), control);
}

// Стая: a room for many at once — on everyone's phone, around a table or across a classroom. Here one is opened, or
// joined by its code.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { categories, player } from "../state.ts";
import { toneOf } from "../ui.ts";

export function rooms() {
  title("Стая");
  const error = signal("");
  const code = signal("");
  const open = async (category: string) => {
    error.set("");
    try {
      await player();
      const r = await api<{ code: string }>("POST", "/api/rooms", { category });
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
        h("span", { class: "dot", "aria-hidden": "true" }),
        name,
      ),
    );
  return h(
    "section",
    { class: "screen" },
    h("h1", null, "Стая"),
    h(
      "section",
      { class: "card" },
      h("h2", null, "Стая"),
      h(
        "p",
        { class: "muted" },
        "За приятели, семейство или клас: всички получават един и същ въпрос в един и същ момент, всеки на телефона си.",
      ),
      h(
        "form",
        {
          class: "join",
          onsubmit: (e: SubmitEvent) => {
            e.preventDefault();
            const c = code.peek().replace(/\D/g, "");
            if (c.length === 6) go(`/r/${c}`);
            else error.set("Кодът е от 6 цифри.");
          },
        },
        h("input", {
          class: "code",
          inputmode: "numeric",
          autocomplete: "off",
          maxlength: 7,
          placeholder: "123 456",
          "aria-label": "Код на стаята",
          oninput: (e: Event) => code.set((e.target as HTMLInputElement).value),
        }),
        h("button", { class: "btn" }, "Влез"),
      ),
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
      h("h3", null, "Отвори нова стая"),
      h("p", { class: "muted" }, "Избери тема. После дай кода на другите."),
      h(
        "ul",
        { class: "chips" },
        topic("", "Всички теми"),
        categories.map((c) => topic(c.id, c.name)),
      ),
    ),
  );
}

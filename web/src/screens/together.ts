// Заедно: playing at the same time, in one room — on everyone's phone, around a table or across a classroom.

import { findDuel } from "../game/duel.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { categories, player } from "../state.ts";

export function together() {
  title("Заедно");
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
  // Opening a room is an action, not a place: a button (that reads like the topic list on Игра).
  const topic = (id: string, name: string): Child =>
    h("li", null, h("button", { class: "link", type: "button", onclick: () => open(id) }, name));
  return h(
    "section",
    { class: "screen" },
    h("h1", null, "Заедно"),
    h("h2", null, "Дуел"),
    h(
      "p",
      null,
      "Ти срещу някого, сега: десет въпроса от всички теми. Ако в момента никой друг не търси, играеш срещу запис на истинска игра.",
    ),
    findDuel(),
    h("h2", null, "Стая"),
    h(
      "p",
      null,
      "За приятели, семейство или клас: всички получават един и същ въпрос в един и същ момент, всеки на телефона си.",
    ),
    h("h3", null, "Влез в стая"),
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
    h("h3", null, "Отвори стая"),
    h("p", { class: "muted" }, "Избери тема. После дай кода на другите."),
    h(
      "ul",
      { class: "topics" },
      topic("", "Всички теми"),
      categories.map((c) => topic(c.id, c.name)),
    ),
  );
}

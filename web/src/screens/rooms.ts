// Стая: a room for many at once — on everyone's phone, around a table or across a classroom. Here one is opened (how
// many questions, how hard, and its topics: all of them unless some are chosen), or joined by its code (checked before
// anything is asked); and its host chooses again between games (changeGame).

import { type ApiError, api, errorText } from "../lib/api.ts";
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
  const topics = signal<string[]>([]); // none: all of them
  const busy = signal(false);
  const open = async () => {
    error.set("");
    busy.set(true);
    try {
      await player();
      const r = await api<{ code: string }>("POST", "/api/rooms", {
        categories: topics.peek(),
        length: length.peek(),
        mix: mix.peek(),
      });
      go(`/r/${r.code}`);
    } catch (err) {
      error.set(errorText(err));
    } finally {
      busy.set(false);
    }
  };
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
          onsubmit: async (e: SubmitEvent) => {
            e.preventDefault();
            const c = code.peek().replace(/\D/g, "");
            if (c.length !== 6) return codeError.set("Кодът е от 6 цифри.");
            // A wrong code is said here, before anything is asked of the player.
            try {
              await api("GET", `/api/rooms/${c}`);
              go(`/r/${c}`);
            } catch (err) {
              codeError.set(
                (err as ApiError).code === "no_room"
                  ? "Няма отворена стая с този код. Провери цифрите."
                  : errorText(err),
              );
            }
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
      h("p", { class: "muted" }, "Избери колко въпроса, колко трудни и от кои теми. После дай кода на другите."),
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
      setting("Теми", topicChoice(topics, topics.set)),
      h("button", { class: "btn primary big", type: "button", disabled: busy, onclick: open }, "Отвори стаята"),
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** What a room plays: its topics (none: all of them), how many questions, how hard. */
export interface Game {
  categories: string[];
  length: number;
  mix: Mix;
}

/** A room's topics to choose: „Всички теми“, on while none is chosen (and a tap on it chooses none again), then each
 * topic, a tap choosing it or letting it go. Every topic chosen is all of them. */
function topicChoice(now: () => string[], choose: (ids: string[]) => void): Child {
  const toggle = (id: string) => {
    const was = now();
    const ids = was.includes(id) ? was.filter((x) => x !== id) : [...was, id];
    choose(ids.length === categories.length ? [] : categories.map((c) => c.id).filter((c) => ids.includes(c)));
  };
  const chip = (id: string, name: string, on: () => boolean, tap: () => void): Child =>
    h(
      "li",
      null,
      h(
        "button",
        {
          class: `chip ${id ? toneOf(id) : "tone-gold"}`,
          type: "button",
          "aria-pressed": () => String(on()),
          onclick: tap,
        },
        topicMark(id),
        name,
      ),
    );
  return h(
    "div",
    { role: "group", "aria-label": "Теми" },
    h(
      "ul",
      { class: "chips" },
      chip(
        "",
        "Всички теми",
        () => now().length === 0,
        () => choose([]),
      ),
      categories.map((c) =>
        chip(
          c.id,
          c.name,
          () => now().includes(c.id),
          () => toggle(c.id),
        ),
      ),
    ),
  );
}

/** Between a room's games, its host chooses again what it plays, the code and the players kept: how many questions,
 * how hard and its topics, each tap making it the next game's (`change`, which says what went wrong, if anything).
 * Folded: the next game as it was is one tap away. */
export function changeGame(now: Game, change: (g: Game) => Promise<string>): Child {
  const length = signal(now.length);
  const mix = signal<Mix>(now.mix);
  const topics = signal(now.categories);
  const error = signal("");
  const pick = async (ids: string[]) => {
    error.set(await change({ categories: ids, length: length.peek(), mix: mix.peek() }));
    if (!error.peek()) topics.set(ids);
  };
  const again = (g: Partial<Game>) =>
    change({ categories: topics.peek(), length: length.peek(), mix: mix.peek(), ...g });
  return h(
    "details",
    { class: "more" },
    h("summary", null, "Промени играта"),
    setting(
      "Въпроси",
      segmented(
        "Въпроси",
        [5, 10, 15, 20].map((n) => [n, String(n)]),
        length,
        async (n) => {
          length.set(n);
          error.set(await again({ length: n }));
        },
        false,
        true,
      ),
    ),
    setting(
      "Трудност",
      segmented(
        "Трудност",
        mixes,
        mix,
        async (m) => {
          mix.set(m);
          error.set(await again({ mix: m }));
        },
        false,
        true,
      ),
    ),
    setting("Теми", topicChoice(topics, pick)),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** A setting of a room: its name over its choices. */
function setting(name: string, control: Child): Child {
  return h("div", { class: "field" }, h("span", { "aria-hidden": "true" }, name), control);
}

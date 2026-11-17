// Стая: a room for many at once — on everyone's phone, around a table or across a classroom. Here one is opened, or
// joined by its code (checked before anything is asked); and its host chooses again between games (changeGame).

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
  // The host plays too, or leads from a big screen (host.ts) and doesn't.
  const leads = signal(false);
  const open = async (category: string) => {
    error.set("");
    try {
      await player();
      const r = await api<{ code: string }>("POST", "/api/rooms", {
        category,
        length: length.peek(),
        mix: mix.peek(),
        lead: leads.peek(),
      });
      // A host who only leads isn't in the room as a player: no name to ask for.
      if (leads.peek())
        try {
          sessionStorage.setItem(`named:${r.code}`, "1");
        } catch {
          // asked, then: the lesser loss
        }
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
                  : (err as ApiError).message,
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
      setting(
        "Ти",
        segmented(
          "Ти",
          [
            [false, "Играя и аз"],
            [true, "Само водя (за голям екран)"],
          ],
          leads,
          leads.set,
          false,
          true,
        ),
      ),
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

/** What a room plays: a topic ("" for all), how many questions, how hard. */
export interface Game {
  category: string;
  length: number;
  mix: Mix;
}

/** Between a room's games, its host chooses again what it plays, the code and the players kept: how many questions and
 * how hard, then the topic, a tap on which makes it the next game's (`change`, which says what went wrong, if
 * anything). Folded: the next game as it was is one tap away. */
export function changeGame(now: Game, change: (g: Game) => Promise<string>): Child {
  const length = signal(now.length);
  const mix = signal<Mix>(now.mix);
  const category = signal(now.category);
  const error = signal("");
  const pick = async (id: string) => {
    error.set(await change({ category: id, length: length.peek(), mix: mix.peek() }));
    if (!error.peek()) category.set(id);
  };
  const again = (g: Partial<Game>) =>
    change({ category: category.peek(), length: length.peek(), mix: mix.peek(), ...g });
  const topic = (id: string, name: string): Child =>
    h(
      "li",
      null,
      h(
        "button",
        {
          class: `chip ${id ? toneOf(id) : "tone-gold"}`,
          type: "button",
          "aria-pressed": () => String(category() === id),
          onclick: () => pick(id),
        },
        topicMark(id),
        name,
      ),
    );
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
    h(
      "ul",
      { class: "chips" },
      topic("", "Всички теми"),
      categories.map((c) => topic(c.id, c.name)),
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** A setting of a room: its name over its choices. */
function setting(name: string, control: Child): Child {
  return h("div", { class: "field" }, h("span", { "aria-hidden": "true" }, name), control);
}

// Теми: questions by topic, as many as you like, shaped by how well you know the topic. Everyone plays the same
// game. The tiles live on Начало (all the topics at once first, then each topic, and one for „България“, the
// questions about Bulgaria from every topic, while the bank has them); a run of one is /play/<topic>.

import { picture } from "../art/picture.ts";
import { type Mastery, masteryBadge } from "../game/mastery.ts";
import { news } from "../game/news.ts";
import { summary } from "../game/results.ts";
import { getReady, playRun } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, slot } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { bulgaria, type Category, categories, player, user } from "../state.ts";
import { meter, questions, stakeLine, toneOf } from "../ui.ts";
import { loadStats, type Stats } from "./stats.ts";

/** The topics as tiles, each with how well the player knows it: a run across all of them first, „България“ across
 * them after (no mastery of its own: its answers count in their own topics). */
export function topics(): Child {
  const stats = signal<Stats | null>(null);
  const waiting = signal(0);
  if (user.peek()) {
    loadStats().then(stats.set, () => {});
    loadMistakes().then(
      (m) => waiting.set(m.waiting >= m.from ? m.waiting : 0),
      () => {},
    );
  }
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, "Теми"),
    h("ul", { class: "topics" }, () => {
      const mine = stats()?.mastery ?? [];
      return [
        // First, where a thumb lands first: a tile in the corner reads as „all of them“, so it's this one.
        h(
          "li",
          { class: "topic-all" },
          h(
            "a",
            { href: "/play/all", class: "topic tone-gold" },
            h(
              "span",
              { class: "topic-text" },
              h("span", { class: "topic-name" }, "Всички теми"),
              h("span", { class: "topic-meta" }, "Въпроси от всички теми"),
            ),
          ),
        ),
        ...categories.map((c) =>
          h(
            "li",
            null,
            tile(
              c,
              mine.find((m) => m.category === c.id),
            ),
          ),
        ),
        bulgaria.open
          ? h(
              "li",
              { class: "topic-all" },
              h(
                "a",
                { href: `/play/${bulgaria.id}`, class: "topic tone-mint" },
                picture(`topic-${bulgaria.id}`, "topic-pic"),
                h(
                  "span",
                  { class: "topic-text" },
                  h("span", { class: "topic-name" }, bulgaria.name),
                  h("span", { class: "topic-meta" }, "Въпроси за България от всяка тема"),
                ),
              ),
            )
          : null,
        waiting() ? h("li", { class: "topic-all" }, secondChance(waiting())) : null,
      ];
    }),
  );
}

/** How many questions wait for the player's second chance, and from how many it opens. */
export const loadMistakes = () => api<{ waiting: number; from: number }>("GET", "/api/mistakes");

/** The way into a second chance: the questions the player got wrong, asked again (/mistakes). */
export function secondChance(waiting: number): Child {
  return h(
    "a",
    { href: "/mistakes", class: "topic tone-rose" },
    h(
      "span",
      { class: "topic-text" },
      h("span", { class: "topic-name" }, "Втори шанс"),
      h("span", { class: "topic-meta" }, `${questions(waiting)}, ${waiting === 1 ? "на който" : "на които"} сгреши`),
    ),
  );
}

/** A topic: its picture and colour, its name, and how well the player knows it (once they've played enough of it to
 * tell: a first estimate as a share alone, its tier once the mark is sure; Профил has the rest). */
function tile(c: Category, m?: Mastery): Child {
  const sure = m?.sure ? m : null;
  const first = m?.first ? m : null;
  return h(
    "a",
    { href: `/play/${c.id}`, class: `topic ${toneOf(c.id)}` },
    picture(`topic-${c.id}`, "topic-pic"),
    h(
      "span",
      { class: "topic-text" },
      h("span", { class: "topic-name" }, c.name),
      sure
        ? h("span", { class: "topic-meta" }, masteryBadge(sure), h("b", { class: "num" }, `${sure.known}%`))
        : first
          ? h("span", { class: "topic-meta" }, `първа оценка · ${first.known}%`)
          : null,
    ),
    sure ? meter(sure.known, `знаеш ${sure.known}% от темата`) : null,
  );
}

export function topic([id = ""]: string[]) {
  const category = id === "all" ? "" : id;
  const name = !category
    ? "Всички теми"
    : category === bulgaria.id
      ? bulgaria.open
        ? bulgaria.name
        : undefined
      : categories.find((c) => c.id === category)?.name;
  if (name === undefined) {
    go("/", true);
    return null;
  }
  title(name);
  // While the day's ten wait, a topic's result points to them (the habit comes first), with the streak at stake.
  // Asked as each game starts (a new player is a player only then), so it's in long before the game ends.
  let day: DayWaits | null = null;
  return run(
    name,
    async () => {
      const s = await api<State>("POST", "/api/topic", { category });
      dayWaits().then(
        (d) => {
          day = d;
        },
        () => {},
      );
      return s;
    },
    (s, again) =>
      h(
        "div",
        { class: "screen" },
        // What was played, where the day's result has its date: every result laid out the same. (The day's state is
        // in long before a game ends: as it was then, never drawing the result again.)
        summary(s, h("div", { class: "day-line" }, h("span", { class: "kicker" }, name)), nextOf(day, again), [
          news(s.id),
        ]),
      ),
  );
}

/** A topic's result's buttons: „Още десет“, gold; or, while the day's ten wait, the way to them, gold, with the streak
 * at stake under it, and „Още десет“ plain. */
function nextOf(d: DayWaits | null, again: () => void): { main: Child; also: Child[] } {
  if (!d)
    return {
      main: h("button", { class: "btn primary big", onclick: again }, "Още десет"),
      also: [h("a", { class: "btn", href: "/" }, "Към Начало")], // where the day and the other topics are
    };
  return {
    main: [h("a", { class: "btn primary big", href: "/" }, "Към въпросите на деня"), stakeLine(d.streak, d.reserve)],
    also: [h("button", { class: "btn", onclick: again }, "Още десет")],
  };
}

/** The day's ten, while they wait for the player: the streak (to yesterday) and the reserve days in hand. */
interface DayWaits {
  streak: number;
  reserve: number;
}

/** Whether the day's ten still wait for the player (null once played), from Начало's state. */
async function dayWaits(): Promise<DayWaits | null> {
  const t = await api<{ streak: number; reserve?: number; run: State | null }>("GET", "/api/day");
  return t.run?.done ? null : { streak: t.streak, reserve: t.reserve ?? 0 };
}

/** Plays a run that `begin` starts (a topic's, a second chance), and what finished draws at its end (again: another
 * run). Each run starts after a short count, which the player can cut short or back out of. */
export function run(
  name: string,
  begin: () => Promise<State>,
  finished: (s: State, again: () => void) => Child,
): Child {
  const screen = slot();
  const ready = () => screen.show(() => getReady(name, start, () => go("/")));
  const start = async () => {
    screen.show(() => h("p", { class: "muted" }, "…"));
    try {
      await player();
      const s = await begin();
      screen.show(() => playRun(s, (end) => finished(end, ready)));
    } catch (err) {
      screen.show(() =>
        h(
          "div",
          { class: "stack" },
          h("p", { role: "alert" }, (err as ApiError).message),
          h("button", { class: "btn primary", onclick: start }, "Опитай пак"),
        ),
      );
    }
  };
  ready();
  return h("div", null, screen);
}

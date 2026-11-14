// Класации: where players stand — on the day's ten (first: it's what most play), by rating this season (with its
// division), by level, and by knowledge (over every topic, or one) — among everyone, or among you and your friends.

import { emblem } from "../art/emblem.ts";
import { seasonName } from "../art/season.ts";
import { board, boardRow } from "../game/results.ts";
import type { Board, Score } from "../game/types.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, type Signal, signal } from "../lib/dom.ts";
import { ordinal } from "../lib/ordinal.ts";
import { title } from "../lib/router.ts";
import { categories, user } from "../state.ts";
import { type Tier, toneOf, topicMark } from "../ui.ts";
import type { Standing } from "./duel.ts";

interface Ranked {
  name: string;
  tag: string;
  value: number;
  division?: Standing["division"];
  answers?: number;
  me?: boolean;
  avatar?: string;
  title?: string;
  titleTier?: Tier;
  level?: number;
}

interface Ranking {
  top: Ranked[];
  place?: number;
  mine?: Ranked;
}

/** The rating's season: a calendar month; placed with minGames rated games in it. */
export interface Season {
  id: string;
  daysLeft: number;
  minGames: number;
  games: number;
  place?: number;
  of: number;
  /** Seasons ended first, second and third. */
  podium: [number, number, number];
  past: { id: string; place: number; of: number; rating: number; division: Standing["division"] }[];
}

interface Answer {
  board: Ranking;
  season?: Season;
  least?: number;
}

/** The day's boards, as /api/day has them. */
interface Day {
  board: Board;
  friends?: Score[] | null;
}

type By = "day" | "rating" | "level" | "knowledge";

const tabs: [By, string][] = [
  ["day", "Днес"],
  ["rating", "Рейтинг"],
  ["level", "Ниво"],
  ["knowledge", "Знания"],
];

const n = (x: number) => x.toLocaleString("bg");

/** How long is left of a season. */
export const daysLeft = (d: number) => `още ${d} ${d === 1 ? "ден" : "дни"}`;

export function ranks() {
  title("Класации");
  const by = signal<By>("day");
  const friends = signal(false);
  const topic = signal("");
  const data = signal<Answer | null>(null);
  const day = signal<Day | null>(null);
  const error = signal("");
  // The board asked for now; an older answer arriving late is dropped.
  const current = () => {
    const q = new URLSearchParams({ by: by() });
    if (friends()) q.set("among", "friends");
    if (by() === "knowledge" && topic()) q.set("topic", topic());
    return q.toString();
  };
  const load = () => {
    data.set(null);
    error.set("");
    if (by() === "day") {
      if (!day.peek()) api<Day>("GET", "/api/day").then(day.set, (err) => error.set((err as ApiError).message));
      return;
    }
    const asked = current();
    api<Answer>("GET", `/api/ranks?${asked}`).then(
      (a) => {
        if (current() === asked) data.set(a);
      },
      (err) => error.set((err as ApiError).message),
    );
  };
  load();
  const pick = <T>(s: Signal<T>, v: T) => {
    if (s() === v) return;
    s.set(v);
    load();
  };
  return h(
    "section",
    { class: "screen" },
    h("h1", null, "Класации"),
    h(
      "div",
      { class: "board-filters" },
      segmented("Класация", tabs, by, (v) => pick(by, v)),
      user.peek()
        ? segmented(
            "Сред кого",
            [
              [false, "Всички"],
              [true, "Приятели"],
            ],
            friends,
            (v) => pick(friends, v),
            true,
          )
        : null,
      () =>
        by() === "knowledge"
          ? h(
              "ul",
              { class: "chips scroll", "aria-label": "Тема" },
              h(
                "li",
                null,
                h(
                  "button",
                  { class: "chip", type: "button", "aria-pressed": () => !topic(), onclick: () => pick(topic, "") },
                  "Всички теми",
                ),
              ),
              categories.map((c) =>
                h(
                  "li",
                  null,
                  h(
                    "button",
                    {
                      class: `chip ${toneOf(c.id)}`,
                      type: "button",
                      "aria-pressed": () => topic() === c.id,
                      onclick: () => pick(topic, c.id),
                    },
                    topicMark(c.id),
                    c.name,
                  ),
                ),
              ),
            )
          : null,
    ),
    (): Child => {
      if (error()) return h("p", { role: "alert" }, error());
      if (by() === "day") {
        const t = day();
        if (!t) return h("p", { class: "muted" }, "…");
        if (friends())
          return t.friends?.length
            ? board("Днес · приятели", t.friends)
            : h("p", { class: "board-empty" }, "Още никой от приятелите ти не е играл днес.");
        return t.board.top.length
          ? board(
              `Днес · ${t.board.players} ${t.board.players === 1 ? "играч" : "играчи"}`,
              t.board.top,
              t.board.place,
              t.board.mine,
            )
          : h("p", { class: "board-empty" }, "Още никой не е играл днешните въпроси.");
      }
      const d = data();
      if (!d) return h("p", { class: "muted" }, "…");
      const among = (name: string) => (friends() ? `${name} · приятели` : name);
      switch (by()) {
        case "level":
          return ranking(
            among("Най-високо ниво"),
            d.board,
            (r) => [h("small", { class: "sub" }, `${n(r.value)} XP · `), `ниво ${r.level ?? 1}`],
            "Още никой няма XP.",
            "Цялото XP от игри и дневни цели, откакто играеш.",
          );
        case "knowledge": {
          const name = categories.find((c) => c.id === topic())?.name;
          return ranking(
            among(name ? `Най-знаещи: ${name}` : "Най-знаещи"),
            d.board,
            (r) => [h("small", { class: "sub" }, `${n(r.answers ?? 0)} отг. · `), `${r.value}%`],
            `Още никой няма ${d.least ?? 100} отговора${name ? " в тази тема" : ""}.`,
            `Делът на верните отговори след поне ${d.least ?? 100}${name ? " в темата" : ""}. Изтеклото време се брои за грешен отговор.`,
          );
        }
      }
      const s = d.season;
      return [
        s ? seasonHead(s) : null,
        ranking(
          among("Рейтинг"),
          d.board,
          (r) => [r.division ? emblem(r.division.id, "s") : null, String(r.value)],
          s ? `Още никой няма ${s.minGames} игри за рейтинг този сезон.` : "Още никой няма игри за рейтинг този сезон.",
        ),
      ];
    },
  );
}

/** The season above its board: which month, the days left, the viewer's way onto it, and what the end brings. */
function seasonHead(s: Season): Child {
  const mine = user.peek()
    ? s.place
      ? `Ти си ${ordinal(s.place)} от ${s.of}.`
      : `Твоите игри този сезон: ${s.games} от ${s.minGames}.`
    : "";
  return h(
    "section",
    { class: "card season-card" },
    h(
      "div",
      { class: "season-head" },
      h("h2", null, `Сезон ${seasonName(s.id)}`),
      h("span", { class: "muted" }, daysLeft(s.daysLeft)),
    ),
    mine ? h("p", { class: "season-mine" }, mine) : null,
    h(
      "p",
      { class: "board-note" },
      `Класират се играчите с поне ${s.minGames} игри за рейтинг (дуели и Роял). В края на месеца първите трима печелят медал, рамка и титла, а всеки рейтинг се връща наполовина към 1000.`,
    ),
  );
}

/** A segmented switch of a few choices. */
function segmented<T>(
  label: string,
  options: [T, string][],
  now: () => T,
  choose: (v: T) => void,
  small = false,
): Child {
  return h(
    "div",
    { class: small ? "segmented small" : "segmented", role: "tablist", "aria-label": label },
    options.map(([id, text]) =>
      h(
        "button",
        { type: "button", role: "tab", "aria-selected": () => now() === id, onclick: () => choose(id) },
        text,
      ),
    ),
  );
}

/** A board: the best, and the viewer's own row (below a gap) if they're further down. */
function ranking(heading: string, r: Ranking, score: (x: Ranked) => Child, empty: string, note?: string): Child {
  const inTop = r.top.some((x) => x.me);
  return h(
    "section",
    { class: "board" },
    h("h2", null, heading),
    note ? h("p", { class: "board-note" }, note) : null,
    r.top.length
      ? h(
          "ol",
          null,
          r.top.map((x, i) => boardRow(i + 1, x.name, score(x), { me: x.me, look: x, tag: x.tag })),
          !inTop && r.mine && r.place
            ? boardRow(r.place, r.mine.name, score(r.mine), { me: true, gap: true, look: r.mine, tag: r.mine.tag })
            : null,
        )
      : h("p", { class: "board-empty" }, empty),
  );
}

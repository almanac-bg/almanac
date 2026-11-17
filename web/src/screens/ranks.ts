// Класации: where players stand — on the day's ten (first: it's what most play), in the week's league (the player's
// own group), by rating (with its division), and by knowledge (over every topic, or one) — among everyone, or among
// you and your friends.

import { emblem } from "../art/emblem.ts";
import { board, boardRow } from "../game/results.ts";
import type { Board, Score } from "../game/types.ts";
import { api } from "../lib/api.ts";
import { type Child, h, type Signal, signal } from "../lib/dom.ts";
import { type By, boardHash, readBoard } from "../lib/hash.ts";
import { rename, title } from "../lib/router.ts";
import { categories, user } from "../state.ts";
import { failure, type Open, type Standing, segmented, type Tier, toneOf, topicMark } from "../ui.ts";
import { type LeagueView, leagueBoard, loadLeague } from "./league.ts";

interface Ranked {
  name: string;
  tag: string;
  value: number;
  division?: Standing["division"];
  /** On a board of knowledge: how many answers the mastery is from, and its tier's name. */
  answers?: number;
  tier?: string;
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

interface Answer {
  board: Ranking;
  least?: number;
}

/** The day's boards, as /api/day has them. */
interface Day {
  board: Board;
  friends?: Score[] | null;
  open?: Open;
}

const tabs: [By, string][] = [
  ["day", "Днес"],
  ["league", "Лига"],
  ["rating", "Рейтинг"],
  ["knowledge", "Знания"],
];

/** Whether a board shows to a viewer who has met these of the game's systems: the league's and the rating's wait for
 * them. */
const shows = (by: By, open?: Open) => (by === "league" ? !!open?.league : by === "rating" ? !!open?.rating : true);

export function ranks() {
  title("Класации");
  // Which board, among whom and of which topic, in the address (lib/hash.ts): back to the page, a reload or a link
  // opens the same one („#league“; „#friends“, the day's among friends, from Начало's „Всички“).
  const at = readBoard(
    location.hash,
    categories.map((c) => c.id),
  );
  const by = signal<By>(at.by);
  const friends = signal(at.friends);
  const topic = signal(at.topic);
  const data = signal<Answer | null>(null);
  const day = signal<Day | null>(null);
  const league = signal<LeagueView | null>(null);
  const error = signal<unknown>(null);
  // The board asked for now; an older answer arriving late is dropped.
  const current = () => {
    const q = new URLSearchParams({ by: by() });
    if (friends()) q.set("among", "friends");
    if (by() === "knowledge" && topic()) q.set("topic", topic());
    return q.toString();
  };
  // The day's boards come first, and say which of the others the viewer has met: a board of a league or a rating not
  // theirs yet waits (play/unfold.go).
  const loadDay = () =>
    api<Day>("GET", "/api/day").then((d) => {
      day.set(d);
      if (!shows(by.peek(), d.open)) pick(by, "day");
    }, error.set);
  loadDay();
  const load = () => {
    data.set(null);
    error.set(null);
    if (by() === "day") return;
    if (by() === "league") {
      if (!league.peek()) loadLeague().then(league.set, error.set);
      return;
    }
    const asked = current();
    api<Answer>("GET", `/api/ranks?${asked}`).then((a) => {
      if (current() === asked) data.set(a);
    }, error.set);
  };
  load();
  const pick = <T>(s: Signal<T>, v: T) => {
    if (s() === v) return;
    s.set(v);
    rename(location.pathname + boardHash({ by: by.peek(), friends: friends.peek(), topic: topic.peek() }));
    load();
  };
  return h(
    "section",
    { class: "screen" },
    h("h1", null, "Класации"),
    h(
      "div",
      { class: "board-filters" },
      () =>
        segmented(
          "Класация",
          tabs.filter(([id]) => shows(id, day()?.open)),
          by,
          (v) => pick(by, v),
        ),
      () =>
        user.peek() && by() !== "league"
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
      if (error())
        return failure(error(), () => {
          if (!day.peek()) loadDay();
          load();
        });
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
      if (by() === "league") {
        const v = league();
        return v ? leagueBoard(v) : h("p", { class: "muted" }, "…");
      }
      const d = data();
      if (!d) return h("p", { class: "muted" }, "…");
      const among = (name: string) => (friends() ? `${name} · приятели` : name);
      switch (by()) {
        case "knowledge": {
          const name = categories.find((c) => c.id === topic())?.name;
          return ranking(
            among(name ? `Най-знаещи: ${name}` : "Най-знаещи"),
            d.board,
            // „72% · Експерт“: the mastery, as a topic's tile says it (play/knowledge.go).
            (r) => [`${r.value}%`, r.tier ? h("small", { class: "sub" }, ` · ${r.tier}`) : null],
            `Още никой няма ${d.least ?? 100} отговора${name ? " в тази тема" : ""}.`,
            `Колко от ${name ? "въпросите в темата" : "всички въпроси"} знае всеки по всичките си отговори, като по-трудните тежат повече. В класацията са тези с поне ${d.least ?? 100} отговора${name ? " в темата" : ""}.`,
          );
        }
      }
      const least = d.least ?? 10;
      return ranking(
        among("Рейтинг"),
        d.board,
        (r) => [r.division ? emblem(r.division.id, "s") : null, String(r.value)],
        `Още никой няма ${least} игри за рейтинг.`,
        `Играчите с поне ${least} игри за рейтинг: дуели и Роял.`,
      );
    },
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

// Класации: where players stand — on the day's ten (first: it's what most play), on yesterday's as it ended (its
// winner, and Начало's line of how it ended leads here), in the week's league (the player's own group), by rating
// (with its division), and by knowledge (over every topic, or one) — among everyone, or among you and your friends.

import type { Board, Score } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { Child, Signal } from "../lib/dom.ts";
import { type By, boardHash, readBoard } from "../lib/hash.ts";
import type { Open, Standing, Tier } from "../ui.ts";
import type { LeagueView } from "./league.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  emblem,
  board,
  boardRow,
  api,
  h,
  signal,
  rename,
  title,
  categories,
  user,
  failure,
  formatNumber,
  segmented,
  toneOf,
  topicMark,
  leagueBoard,
  loadLeague,
  issueWords,
  shareButton,
} = {} as Kit;

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
  board: Ranking & { answers?: number };
  least?: number;
}

/** The day's boards, as /api/day has them. */
interface Day {
  day: string;
  board: Board;
  friends?: Score[] | null;
  /** No friend has played: whether the player has any at all. */
  befriended?: boolean;
  open?: Open;
}

/** A day's board as /api/day/{day}/board has it: its issue, and whether it's final (its first, the day's winner). */
interface Past {
  issue: number;
  final: boolean;
  board: Board;
  friends?: Score[] | null;
}

const tabs: [By, string][] = [
  ["day", "Днес"],
  ["yesterday", "Вчера"],
  ["league", "Лига"],
  ["rating", "Рейтинг"],
  ["knowledge", "Знания"],
];

/** Whether a board shows to a viewer who has met these of the game's systems: the league's and the rating's wait for
 * them. */
const shows = (by: By, open?: Open) => (by === "league" ? !!open?.league : by === "rating" ? !!open?.rating : true);

export function ranks(kit: Kit) {
  ({
    emblem,
    board,
    boardRow,
    api,
    h,
    signal,
    rename,
    title,
    categories,
    user,
    failure,
    formatNumber,
    segmented,
    toneOf,
    topicMark,
    leagueBoard,
    loadLeague,
    issueWords,
    shareButton,
  } = kit);
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
  const past = signal<Past | null>(null);
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
  let dayIn: Promise<Day | undefined> = Promise.resolve(undefined);
  const loadDay = () => {
    dayIn = api<Day>("GET", "/api/day").then(
      (d) => {
        day.set(d);
        if (!shows(by.peek(), d.open)) pick(by, "day");
        return d;
      },
      (err) => {
        error.set(err);
        return undefined;
      },
    );
  };
  loadDay();
  const load = () => {
    data.set(null);
    error.set(null);
    if (by() === "day") return;
    if (by() === "yesterday") {
      if (!past.peek())
        dayIn.then((d) => {
          if (d) api<Past>("GET", `/api/day/${dayBefore(d.day)}/board`).then(past.set, error.set);
        });
      return;
    }
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
            : t.befriended === false
              ? noFriends()
              : h("p", { class: "board-empty" }, "Още никой от приятелите ти не е играл днес.");
        return t.board.top.length
          ? board(
              `Днес · ${formatNumber(t.board.players)} ${t.board.players === 1 ? "играч" : "играчи"}`,
              t.board.top,
              t.board.place,
              t.board.mine,
            )
          : h("p", { class: "board-empty" }, "Още никой не е играл днешните въпроси.");
      }
      if (by() === "yesterday") {
        const p = past();
        if (!p) return h("p", { class: "muted" }, "…");
        if (friends())
          return p.friends?.length
            ? board(`${issueWords(p.issue, p.board.day)} · приятели`, p.friends)
            : day()?.befriended === false
              ? noFriends()
              : h("p", { class: "board-empty" }, "Никой от приятелите ти не е играл вчера.");
        return p.board.top.length
          ? [
              winner(p),
              board(
                `${issueWords(p.issue, p.board.day)} · ${formatNumber(p.board.players)} ${p.board.players === 1 ? "играч" : "играчи"}`,
                p.board.top,
                p.board.place,
                p.board.mine,
              ),
            ]
          : h("p", { class: "board-empty" }, "Вчера никой не е играл въпросите на деня.");
      }
      if (by() === "league") {
        const v = league();
        return v ? leagueBoard(v) : h("p", { class: "muted" }, "…");
      }
      const d = data();
      if (!d) return h("p", { class: "muted" }, "…");
      if (friends() && day()?.befriended === false) return noFriends();
      const among = (name: string) => (friends() ? `${name} · приятели` : name);
      switch (by()) {
        case "knowledge": {
          const name = categories.find((c) => c.id === topic())?.name;
          const least = d.least ?? 100;
          const have = d.board.answers;
          return [
            ranking(
              among(name ? `Най-знаещи: ${name}` : "Най-знаещи"),
              d.board,
              // „72% · Експерт“: the mastery, as a topic's tile says it (play/knowledge.go).
              (r) => [`${r.value}%`, r.tier ? h("small", { class: "sub" }, ` · ${r.tier}`) : null],
              `Още никой няма ${d.least ?? 100} отговора${name ? " в тази тема" : ""}.`,
              `Каква част от ${name ? "въпросите в темата" : "всички въпроси"} знае всеки, според всичките му отговори. По-трудните тежат повече. В класацията са играчите с поне ${d.least ?? 100} отговора${name ? " в темата" : ""}.`,
            ),
            // The viewer short of it: how far they are.
            have !== undefined
              ? h(
                  "p",
                  { class: "board-note" },
                  `Имаш ${formatNumber(have)} от ${least} отговора${name ? " в темата" : ""}. Още ${formatNumber(least - have)} и влизаш в класацията.`,
                )
              : null,
          ];
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

/** The day before a day (YYYY-MM-DD). */
function dayBefore(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** How long a game took, as its winner's line says it: „48 сек.“, „1:12 мин.“ */
function took(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} сек.` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} мин.`;
}

/** Who won a day: its board's first, once the board is final („Брой 6 спечели Мария: 10 от 10 за 1:12 мин.“); until
 * then, that its last games are still being finished. */
function winner(p: Past): Child {
  const first = p.board.top[0];
  if (!first) return null;
  if (!p.final) return h("p", { class: "board-note" }, "Последните игри от вчера още се довършват.");
  return h(
    "p",
    { class: "board-winner" },
    `Брой ${p.issue} спечели ${first.name}: ${first.rights} от 10 за ${took(first.ms)}`,
  );
}

/** Among friends, with none yet: what the board would be, and the way to invite one (the player's own link). */
function noFriends(): Child {
  return h(
    "div",
    { class: "board-empty stack" },
    h("p", null, "Още нямаш приятели. Покани някого и сравнявайте резултатите си всеки ден."),
    shareButton(
      "Покани с връзка",
      () => "Ела да сме приятели в АЛМАНАХ:",
      async () => (await api<{ invite: string }>("GET", "/api/friends")).invite,
      true,
      undefined,
      true,
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

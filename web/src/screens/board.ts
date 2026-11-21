// The day's board (`/board`), a page of Днес's (DESIGN.md, Places): the way back to Днес, „Класация · Брой N“, and
// the board among the player and their friends, or of all България (its spread and the player's place first, then the
// top rows). Reached from the day's result: „Приятели днес“'s „Класация“ opens it among friends, „България днес“'s
// among everyone (`?tab=bulgaria`).

import type { Board, Score } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let { api, back, h, signal, title, failure, formatNumber, ordinal, segmented, scoreRow } = {} as Kit;

/** The day's boards, as /api/day has them. */
interface Day {
  day: string;
  issue?: number;
  board: Board;
  /** The player's day: the board of everyone names its players only to one who has finished it (server/game.go). */
  run?: { done: boolean } | null;
  friends?: Score[] | null;
  /** No friend has played: whether the player has any at all. */
  befriended?: boolean;
}

type Among = "friends" | "all";

export function board(kit: Kit): Child {
  ({ api, back, h, signal, title, failure, formatNumber, ordinal, segmented, scoreRow } = kit);
  title("Класация");
  const day = signal<Day | null>(null);
  const failed = signal<unknown>(null);
  // Where to look: as the link asked (?tab=), else among friends once there are any (a first one just accepted too).
  const asked = new URLSearchParams(location.search).get("tab");
  const among = signal<Among | null>(asked === "bulgaria" ? "all" : asked === "friends" ? "friends" : null);
  const load = () =>
    api<Day>("GET", "/api/day").then(
      (d) => {
        failed.set(null);
        day.set(d);
        if (!among.peek()) among.set(d.friends?.length || d.befriended ? "friends" : "all");
      },
      (err) => failed.set(err),
    );
  load();
  return h(
    "section",
    { class: "screen board-page" },
    h(
      "div",
      { class: "intro" },
      back("/", "Днес"),
      // „Класация · Брой 31“; with large text „Брой 31“ a line of its own, no dot hung at a line's end (app.css).
      h("h1", null, "Класация", () => {
        const d = day();
        return d?.issue
          ? [h("span", { class: "board-dot" }, " · "), h("span", { class: "board-issue" }, `Брой ${d.issue}`)]
          : null;
      }),
    ),
    h(
      "section",
      { class: "sect day-board" },
      () =>
        day()
          ? segmented<Among>(
              "Класация сред",
              [
                ["friends", "Приятели"],
                ["all", "България"],
              ],
              () => among() ?? "friends",
              (v) => among.set(v),
            )
          : null,
      (): Child => {
        const d = day();
        if (!d) return failed() ? failure(failed(), () => void load(), null) : h("p", { class: "muted" }, "…");
        return among() === "all" ? everyone(d) : ofFriends(d);
      },
    ),
  );
}

/** The day among the player's friends: each who played, best first. A row says what places it: the right answers
 * („8 от 10“; a tie between them broken as play/board.go says, never by time: those still equal share a place, the
 * server's); the player's own row washed, „ти“ after the name. */
function ofFriends(d: Day): Child {
  const rows = d.friends ?? [];
  if (!rows.length) {
    // No friend has played yet: the player's own day on the board all the same, once played, and why it's alone.
    const mine = d.run?.done ? (d.board.mine ?? d.board.top.find((s) => s.me)) : undefined;
    return [
      mine ? h("ol", { class: "rows ranks" }, scoreRow({ ...mine, me: true }, 1)) : null,
      d.befriended === false
        ? h(
            "p",
            { class: "board-empty" },
            "Още нямаш приятели тук. ",
            h("a", { href: "/friends" }, "Добави ги в Приятели"),
            " и сравнявайте резултатите си всеки ден.",
          )
        : h("p", { class: "board-empty" }, "Още никой от приятелите ти не е играл днес."),
    ];
  }
  return h(
    "ol",
    { class: "rows ranks" },
    rows.map((s, i) => scoreRow(s, s.place ?? i + 1)),
  );
}

/** The day among everyone who played it: the best twenty, and the player's own place under them if further down; to
 * one who hasn't played it, how many have (the names come with their own result). */
function everyone(d: Day): Child {
  const b = d.board;
  if (!d.run?.done)
    return h(
      "p",
      { class: "board-empty" },
      b.players
        ? `${b.players === 1 ? "Днес игра 1 човек" : `Днес играха ${formatNumber(b.players)} души`}. Изиграй днешния брой и ще видиш класацията.`
        : "Още никой не е играл днешния брой.",
    );
  if (!b.top.length) return h("p", { class: "board-empty" }, "Още никой не е играл днешния брой.");
  const mine = b.mine && b.place && !b.top.some((s) => s.me) ? b.mine : null;
  return [
    // First how all of България did and where the player stands (alone on the board, a place says nothing; with none
    // right, it would only rub the day in: how many played instead); then the top rows.
    spreadOf(b),
    b.players < 2
      ? null
      : b.place && b.mine?.rights
        ? h(
            "p",
            { class: "board-note" },
            `В България си на ${ordinal(b.place, "n")} място от ${formatNumber(b.players)}.`,
          )
        : h("p", { class: "board-note" }, `Днес играха ${formatNumber(b.players)} души.`),
    h(
      "ol",
      { class: "rows ranks" },
      b.top.map((s, i) => scoreRow(s, s.place ?? i + 1)),
      mine && b.place ? scoreRow(mine, b.place, b.place > b.top.length + 1) : null,
    ),
  ];
}

/** How all of България did with the day: how many got each count of right answers, 0 to 10, the player's in ink.
 * From ten players (play.Board.Spread). */
function spreadOf(b: Board): Child {
  const spread = b.spread;
  if (!spread?.length) return null;
  const most = Math.max(1, ...spread);
  const mine = b.mine ? Math.min(b.mine.rights, spread.length - 1) : -1;
  return h(
    "div",
    {
      class: "board-spread",
      role: "img",
      "aria-label": `Колко играчи имат по колко верни отговора: най-много имат ${spread.indexOf(Math.max(...spread))}.${mine >= 0 ? ` Ти: ${mine}.` : ""}`,
    },
    h(
      "div",
      { class: "board-bars" },
      spread.map((n, i) =>
        h("i", { class: i === mine ? "me" : undefined, style: { height: `${Math.max(2, (100 * n) / most)}%` } }),
      ),
    ),
    h(
      "div",
      { class: "board-ticks", "aria-hidden": "true" },
      spread.map((_, i) => h("span", { class: i === mine ? "me" : undefined }, String(i))),
    ),
  );
}

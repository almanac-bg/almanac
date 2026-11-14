// The week's league: every week, a race on the XP a player earns, in a group of up to twenty of their league — when
// the week ends the first go up a league and the last go down, and the first three are paid XP. Класации has the
// group („Лига“); Профил a line with where the player stands, once they've been in a league.

import { leagueEmblem } from "../art/league.ts";
import { boardRow } from "../game/results.ts";
import { api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { ordinal, place } from "../lib/ordinal.ts";
import { user } from "../state.ts";
import { formatNumber, type Look } from "../ui.ts";

/** A league: its tier (0, Странджа, the lowest) and its name. */
export interface League {
  tier: number;
  name: string;
}

/** How a week ended: the league it was played in, the place, the move (-1, 0, 1), the XP it paid. */
export interface LeagueEnd {
  week: string;
  from: League;
  now: League;
  place: number;
  of: number;
  moved: number;
  xp: number;
}

interface Row extends Look {
  name: string;
  tag: string;
  xp: number;
  me?: boolean;
}

/** The week as the player sees it: their league and group, or (not in one yet) what puts them in. */
export interface LeagueView {
  week: string;
  daysLeft: number;
  league: League;
  in: boolean;
  group: Row[];
  place?: number;
  /** How many of the group go up and down as it stands. */
  up: number;
  down: number;
  pay: [number, number, number];
  /** How many a group needs to be a race: fewer, and nobody goes up or is paid for a place. */
  race: number;
  last?: LeagueEnd;
}

export const loadLeague = () => api<LeagueView>("GET", "/api/league");

/** How long is left of the week. */
const daysLeft = (d: number) => `още ${d} ${d === 1 ? "ден" : "дни"}`;

/** A week's move, said: up, down, or staying. */
export function moveWords(e: LeagueEnd): string {
  if (e.moved > 0) return `Качваш се в ${e.now.name}`;
  if (e.moved < 0) return `Слизаш в ${e.now.name}`;
  return `Оставаш в ${e.now.name}`;
}

/** The league's head: its mountain and name, and the days left of the week. */
function head(v: LeagueView): Child {
  return h(
    "div",
    { class: "league-head" },
    leagueEmblem(v.league.tier, "m"),
    h(
      "div",
      { class: "league-name" },
      h("p", { class: "kicker" }, "Лига"),
      h("strong", { class: `lg-${v.league.tier}` }, v.league.name),
    ),
    h("span", { class: "muted" }, daysLeft(v.daysLeft)),
  );
}

/** What the week is: who races, how, and what the end brings. */
function rules(v: LeagueView): string {
  return `Всяка седмица играчите се състезават в групи до 20 души по XP, което печелят. В неделя в полунощ първите се качват в по-висока лига, последните слизат, а първите трима печелят ${v.pay[0]}, ${v.pay[1]} и ${v.pay[2]} XP. В група под ${v.race} души няма качване и награди.`;
}

/** Класации' „Лига“: the viewer's group this week, with who goes up and who goes down; or what puts them in one. */
export function leagueBoard(v: LeagueView): Child {
  if (!user.peek() || !v.in)
    return h(
      "section",
      { class: "card league-card" },
      head(v),
      h(
        "p",
        null,
        user.peek()
          ? "Изиграй игра тази седмица и влизаш в група от своята лига."
          : "Изиграй игра и влизаш в лига: Странджа е първата, Рила е върхът.",
      ),
      v.last ? lastWeek(v.last) : null,
      h("p", { class: "board-note" }, rules(v)),
    );
  const n = v.group.length;
  const rows: Child[] = [];
  v.group.forEach((r, i) => {
    if (v.down && i === n - v.down) rows.push(h("li", { class: "league-line down" }, "Оттук слизат"));
    const row = boardRow(i + 1, r.name, [formatNumber(r.xp), h("small", { class: "sub" }, " XP")], {
      me: r.me,
      look: r,
      tag: r.tag,
    }) as HTMLElement;
    if (i < v.up) row.classList.add("up");
    else if (i >= n - v.down) row.classList.add("down");
    rows.push(row);
    if (v.up && i === v.up - 1 && i < n - 1) rows.push(h("li", { class: "league-line up" }, "Дотук се качват"));
  });
  return [
    h("section", { class: "card league-card" }, head(v), h("p", { class: "board-note" }, rules(v))),
    h("section", { class: "board league-board" }, h("h2", null, `Групата ти · ${n}`), h("ol", null, rows)),
  ];
}

/** How the last week ended, in a line. */
function lastWeek(e: LeagueEnd): Child {
  return h("p", { class: "muted" }, `Миналата седмица: ${place(e.place, e.of)} в ${e.from.name}.`);
}

/** Профил's line: the league, the place in the group (and its zone) and the days left, a tap from the group (the
 * whole of it is Класации' „Лига“); shown once the player has been in a league. */
export function leagueLine(): Child {
  const data = signal<LeagueView | null>(null);
  loadLeague().then(data.set, () => {});
  return () => {
    const v = data();
    if (!v || (!v.in && !v.last)) return null;
    const n = v.group.length;
    const at = v.place ?? 0;
    const zone = !v.in
      ? null
      : at <= v.up
        ? h("span", { class: "league-zone up" }, "зона за качване")
        : at > n - v.down
          ? h("span", { class: "league-zone down" }, "зона за слизане")
          : null;
    return h(
      "a",
      { class: "league-link", href: "/ranks#league" },
      leagueEmblem(v.league.tier, "m"),
      h(
        "span",
        { class: "league-link-text" },
        h("strong", { class: "league-link-name" }, h("span", { class: "sr" }, "Лига "), v.league.name),
        h(
          "span",
          { class: "league-link-more" },
          v.in ? `${ordinal(at, "n")} място от ${n} · ` : "Още не си в група тази седмица · ",
          zone,
          zone ? " · " : null,
          daysLeft(v.daysLeft),
        ),
      ),
      h("span", { class: "i i-left league-link-i", "aria-hidden": "true" }),
    );
  };
}

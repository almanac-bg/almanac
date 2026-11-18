// The week's league: every week, a race on the day's right answers added up over the week (on equal ones, the
// points), in a group of up to twenty of their league — when the week ends the first go up a league and the last go
// down, and the first three are paid XP (play/leagues.go). A league's last group, under five, races with the one
// before it; a league's one group under five isn't a race: it's gathering, and shows nobody. Класации has
// the group („Лига“); Профил a line with where the player stands, once they've been in a league; and the day's result
// a quiet line of where the day just played leaves them.

import { leagueEmblem } from "../art/league.ts";
import { boardRow } from "../game/results.ts";
import { fresh, last } from "../lib/api.ts";
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
  /** The week's right answers on the day's questions, which place a row, and its points, which decide a tie. */
  rights: number;
  points: number;
  me?: boolean;
}

/** The week as the player sees it: their league and group, or (not in one yet) what puts them in. */
export interface LeagueView {
  week: string;
  /** The days left of the week, today too; 0 once it's over, its last games still coming in before it closes. */
  daysLeft: number;
  league: League;
  in: boolean;
  /** How many race with the player; who (`group`) once it's a race (`race` or more), none while it's gathering. */
  size: number;
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

/** The week as it stands: the server asked again, while what it said last is drawn (last). */
export const loadLeague = () => fresh<LeagueView>("/api/league");

/** How long is left of the week: days, or (its days over, minutes before it closes) that it's ending. */
const daysLeft = (d: number) => (d > 0 ? `още ${d} ${d === 1 ? "ден" : "дни"}` : "седмицата приключва");

/** A week's move, said: up, down, or staying. */
export function moveWords(e: LeagueEnd): string {
  if (e.moved > 0) return `Качваш се в ${e.now.name}`;
  if (e.moved < 0) return `Слизаш в ${e.now.name}`;
  return `Оставаш в ${e.now.name}`;
}

/** The league's head: its mountain and name, and (`days`) the days left of the week. */
function head(v: LeagueView, days = true): Child {
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
    days ? h("span", { class: "muted" }, daysLeft(v.daysLeft)) : null,
  );
}

/** Where the rules were opened by themselves once, on this device: a first visit reads them, later ones don't. */
const rulesSeen = "almanac.leagueRules";

/** What the week is, folded under „Как работи лигата“ (open on the first visit): who races, how, and what the end
 * brings. */
function rules(v: LeagueView): Child {
  let first = false;
  try {
    first = !localStorage.getItem(rulesSeen);
    if (first) localStorage.setItem(rulesSeen, "1");
  } catch {
    // no storage here: folded
  }
  return h(
    "details",
    { class: "more league-rules", open: first },
    h("summary", null, "Как работи лигата"),
    h(
      "p",
      { class: "board-note" },
      `Всяка седмица играчите се състезават в групи до 20 души. Мястото ти в групата се решава от верните отговори на въпросите на деня за седмицата, а при равенство от точките. Пропуснат ден не носи нищо. В полунощ срещу понеделник първите се качват в по-висока лига, последните слизат, а първите трима печелят ${v.pay[0]}, ${v.pay[1]} и ${v.pay[2]} XP. Група под ${v.race} души се състезава с групата преди нея. Ако е единствената в лигата, няма нито качване, нито награди.`,
    ),
  );
}

/** The right answers or points between two rows (`a` ahead of `b`, or level), said: the right answers when they
 * differ, else the points; "" when both are level. */
function lead(a: Pick<Row, "rights" | "points">, b: Pick<Row, "rights" | "points">): string {
  const rights = a.rights - b.rights;
  if (rights) return rights === 1 ? "1 верен отговор" : `${rights} верни отговора`;
  const points = a.points - b.points;
  if (points > 0) return `${formatNumber(points)} ${points === 1 ? "точка" : "точки"}`;
  return "";
}

/** The week as it stands for the player, in two lines: the days left and who goes up („Още 6 дни · първите 5 се
 * качват“); and the gap that's worth playing for: the lead over the second, the right answers (or, level on them, the
 * points) to the place above, or out of the zone that goes down. */
function standing(v: LeagueView): Child {
  const n = v.group.length;
  const at = v.place ?? 0;
  const mine = v.group[at - 1];
  const safe = n - v.down; // the last place that doesn't go down
  let gap = "";
  const second = v.group[1];
  if (mine && at === 1 && second) {
    const by = lead(mine, second);
    gap = by ? `Водиш с ${by}.` : "Наравно с 2-ро място.";
  } else if (mine && at > safe && safe > 0) {
    // Out of the zone for sure: one right answer more than the last safe place has.
    const need = (v.group[safe - 1]?.rights ?? 0) - mine.rights + 1;
    gap = `Още ${need === 1 ? "1 верен отговор" : `${need} верни отговора`} и излизаш от зоната за слизане.`;
  } else if (mine && at > 1) {
    const above = v.group[at - 2];
    const by = above ? lead(above, mine) : "";
    gap = by ? `До ${ordinal(at - 1, "n")} място: ${by}.` : `Наравно с ${ordinal(at - 1, "n")} място.`;
  }
  const days = daysLeft(v.daysLeft);
  return h(
    "div",
    { class: "league-now" },
    h(
      "p",
      { class: "league-when" },
      days.charAt(0).toUpperCase() + days.slice(1),
      v.up ? ` · първите ${v.up} се качват` : "",
    ),
    gap ? h("p", { class: "league-gap" }, gap) : null,
  );
}

/** Whether the player's group is still gathering: they're in it, and it isn't a race yet. */
const gathering = (v: LeagueView) => v.in && v.size < v.race;

/** Класации' „Лига“: the viewer's group this week, with who goes up and who goes down; or what puts them in one, or
 * that it's still gathering. */
export function leagueBoard(v: LeagueView): Child {
  if (!user.peek() || !v.in || gathering(v))
    return h(
      "section",
      { class: "card league-card" },
      head(v),
      h(
        "p",
        gathering(v) ? { class: "league-gathering" } : null,
        gathering(v)
          ? "Групата ти още се събира."
          : user.peek()
            ? "Изиграй въпросите на деня и влизаш в група от своята лига."
            : "Изиграй въпросите на деня и влизаш в лига: Странджа е първата, Рила е върхът.",
      ),
      v.last ? lastWeek(v.last) : null,
      rules(v),
    );
  const n = v.group.length;
  const rows: Child[] = [];
  v.group.forEach((r, i) => {
    if (v.down && i === n - v.down) rows.push(h("li", { class: "league-line down" }, "Оттук слизат"));
    // The right answers, which place the row, and the points under them, which decide a tie.
    const score = [
      String(r.rights),
      h("small", { class: "sub" }, ` ${r.rights === 1 ? "верен" : "верни"}`),
      h("small", { class: "sub league-pts" }, `${formatNumber(r.points)} ${r.points === 1 ? "точка" : "точки"}`),
    ];
    const row = boardRow(i + 1, r.name, score, {
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
    h("section", { class: "card league-card" }, head(v, false), standing(v), rules(v)),
    h("section", { class: "board league-board" }, h("h2", null, `Групата ти · ${n}`), h("ol", null, rows)),
  ];
}

/** How the last week ended, in a line. */
function lastWeek(e: LeagueEnd): Child {
  return h("p", { class: "muted" }, `Миналата седмица: ${place(e.place, e.of)} в ${e.from.name}.`);
}

/** The day's result: where the week's race stands, in one quiet line, a tap from the group („Лига Странджа: 2-ро място
 * · зона за качване“); nothing while the group is gathering or the player isn't in one. */
export function leagueNote(): Child {
  const data = signal<LeagueView | null>(last<LeagueView>("/api/league") ?? null);
  loadLeague().then(data.set, () => {});
  return () => {
    const v = data();
    if (!v?.in || gathering(v) || !v.place) return null;
    const n = v.group.length;
    const zone = v.place <= v.up ? " · зона за качване" : v.place > n - v.down ? " · зона за слизане" : "";
    return h(
      "p",
      { class: "day-next league-note" },
      h("a", { href: "/ranks#league" }, `Лига ${v.league.name}: ${place(v.place, n)}${zone}`),
    );
  };
}

/** Профил's line: the league, the place in the group (and its zone; or that it's still gathering) and the days left,
 * a tap from the group (the whole of it is Класации' „Лига“); shown once the player has been in a league. */
export function leagueLine(): Child {
  const data = signal<LeagueView | null>(last<LeagueView>("/api/league") ?? null);
  loadLeague().then(data.set, () => {});
  return () => {
    const v = data();
    if (!v || (!v.in && !v.last)) return null;
    const n = v.group.length;
    const at = v.place ?? 0;
    const zone =
      !v.in || gathering(v)
        ? null
        : at <= v.up
          ? h("span", { class: "league-zone up" }, "зона за качване")
          : at > n - v.down
            ? h("span", { class: "league-zone down" }, "зона за слизане")
            : null;
    return h(
      "a",
      { class: "place-link league-link", href: "/ranks#league" },
      leagueEmblem(v.league.tier, "m"),
      h(
        "span",
        { class: "place-link-text" },
        h("strong", { class: "place-link-name" }, h("span", { class: "sr" }, "Лига "), v.league.name),
        h(
          "span",
          { class: "place-link-more" },
          !v.in
            ? "Още не си в група тази седмица · "
            : gathering(v)
              ? "Групата ти още се събира · "
              : `${ordinal(at, "n")} място от ${n} · `,
          zone,
          zone ? " · " : null,
          daysLeft(v.daysLeft),
        ),
      ),
      h("span", { class: "i i-left place-link-i", "aria-hidden": "true" }),
    );
  };
}

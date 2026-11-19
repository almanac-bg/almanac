// How a player has done: the streak (and their longest) and this week, their numbers, how their days' ten have gone
// (from the third day played), the facts in their almanac, how well they know each topic (each a way to play it), their
// latest games (today's each a way to go over it: /games/<id>) and the way to all of them (/games).

import { picture } from "../art/picture.ts";
import { type Mastery, masteryCard } from "../game/mastery.ts";
import { api } from "../lib/api.ts";
import { dayInBulgaria } from "../lib/day.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { topics } from "../state.ts";
import { figure, formatNumber, streak } from "../ui.ts";

export interface Stats {
  streak: number;
  /** The longest streak the player has had. */
  best: number;
  week: boolean[];
  saved: boolean[];
  reserve: number;
  /** Days in a row to the next reserve day (0: they are full). */
  next: number;
  days: number;
  games: number;
  answers: number;
  right: number;
  /** Facts in Моят Алманах. */
  facts: number;
  /** How the day's ten have gone over the days played: how many days had 0 right, 1, … 10; and today's (-1: not yet). */
  spread: number[];
  today: number;
  duels: number;
  won: number;
  mastery: Mastery[];
  recent: Played[];
}

/** A finished game, as a list of them has it. */
export interface Played {
  id: number;
  kind: "day" | "topic" | "challenge" | "duel" | "royal" | "mistakes" | "room"; // challenge: from when there were challenges
  day?: string;
  /** The day's ten's: the day's issue. */
  issue?: number;
  category?: string;
  rights: number;
  total: number;
  points: number;
  at: number;
  opponent?: string;
  recorded?: boolean;
  outcome?: "won" | "lost" | "draw";
}

export const loadStats = () => api<Stats>("GET", "/api/me/stats");

const percent = (right: number, of: number) => (of ? Math.round((100 * right) / of) : 0);
const topicName = (id?: string) => (id ? (topics.find((c) => c.id === id)?.name ?? id) : "Всички теми");
const date = (ms: number) => new Intl.DateTimeFormat("bg", { day: "numeric", month: "long" }).format(new Date(ms));
const outcome = { won: "победа", lost: "загуба", draw: "равенство" };

/** What a game was, as a list of games says it (its date beside it, or over it): the day's ten by their issue
 * („Брой 7“). */
function what(p: Played): string {
  switch (p.kind) {
    case "day":
      return p.issue ? `Брой ${p.issue}` : "Въпросите на деня";
    case "duel":
      // A friend's challenge has its opponent and result once both have played: until then (or if it was declined or
      // ran out), only that it was a duel.
      return p.outcome ? `Дуел срещу ${p.opponent}${p.recorded ? " (запис)" : ""}, ${outcome[p.outcome]}` : "Дуел";
    case "royal":
      return "Роял";
    case "mistakes":
      return "Втори шанс";
    case "room":
      return `Стая · ${topicName(p.category)}`;
    default:
      return topicName(p.category);
  }
}

/** Профил's line of Моят Алманах: how many facts it has, a tap from them. */
function almanacLine(facts: number): Child {
  return h(
    "a",
    { class: "place-link", href: "/almanac" },
    picture("mode-almanac", "mode-pic tone-gold"),
    h(
      "span",
      { class: "place-link-text" },
      h("strong", { class: "place-link-name" }, `${formatNumber(facts)} ${facts === 1 ? "факт" : "факта"} в Алманаха`),
      h("span", { class: "place-link-more" }, "Фактът към всеки въпрос, на който отговори вярно"),
    ),
    h("span", { class: "i i-left place-link-i", "aria-hidden": "true" }),
  );
}

/** Профил's numbers: the streak and this week; how well and how much they've played, in one card (the day's place
 * is Начало's and Класации'); the facts in their almanac; how well they know each topic (once one has a mark); their
 * latest games. */
export function stats(): Child {
  const data = signal<Stats | null>(null);
  loadStats().then(data.set, () => {});
  return () => {
    const s = data();
    if (!s) return null;
    if (s.games === 0)
      return [
        streak(s.streak, s.week, s.saved, s.reserve, s.next, s.best),
        h("p", { class: "muted" }, "Още няма изиграни игри."),
      ];
    return [
      streak(s.streak, s.week, s.saved, s.reserve, s.next, s.best),
      h(
        "section",
        { class: "card figures" },
        figure(
          `${percent(s.right, s.answers)}%`,
          `верни от ${formatNumber(s.answers)} ${s.answers === 1 ? "отговор" : "отговора"}`,
        ),
        figure(String(s.games), s.games === 1 ? "изиграна игра" : "изиграни игри"),
        s.duels > 0
          ? figure(`${s.won}/${s.duels}`, "победи в дуели")
          : figure(String(s.days), s.days === 1 ? "изигран ден" : "изиграни дни"),
      ),
      // From the third day played, how the days' ten have gone: a day's ten is one result, and its spread the progress.
      s.days >= 3 ? issuesCard(s.spread, s.today) : null,
      s.facts ? almanacLine(s.facts) : null,
      // „Колко знаеш“ once a topic has a first estimate: a first day's one answer a topic tells nothing.
      s.mastery.some((m) => m.sure || m.first) ? masteryCard(s.mastery) : null,
      h(
        "section",
        { class: "stack" },
        h("h2", { class: "section-title" }, "Последни игри"),
        h(
          "ol",
          { class: "games" },
          s.recent.slice(0, 5).map((p) => gameRow(p, date(p.at))),
        ),
        s.games > 5 ? h("a", { class: "link", href: "/games" }, "Всички игри") : null,
      ),
    ];
  };
}

/** A game in a list of them: what it was, when (`when`, if said), and its score; one of today's, a way to go over it
 * (a game is gone over on its day only: play.Review). */
export function gameRow(p: Played, when: string | null): HTMLElement {
  const today = dayInBulgaria(new Date(p.at)) === dayInBulgaria();
  return h(
    "li",
    null,
    h(
      today ? "a" : "div",
      today ? { class: "game", href: `/games/${p.id}` } : { class: "game" },
      h(
        "div",
        { class: "game-text" },
        h("strong", { class: "game-what" }, what(p)),
        when ? h("span", { class: "game-when" }, when) : null,
      ),
      h("b", { class: "game-score" }, String(p.rights), h("span", { class: "num-word" }, " от "), String(p.total)),
    ),
  );
}

/** „Твоите броеве“: how the day's ten have gone over the days played, a column for each score from 0 to 10 (today's in
 * gold), how many days had it over each; and the best, the average and how many, in a line. */
function issuesCard(spread: number[], today: number): Child {
  const days = spread.reduce((a, n) => a + n, 0);
  if (!days) return null;
  const most = Math.max(...spread);
  const best = spread.reduce((b, n, i) => (n ? i : b), 0);
  const average = spread.reduce((a, n, i) => a + n * i, 0) / days;
  return h(
    "section",
    { class: "card issues" },
    h("h2", { class: "card-title" }, "Твоите броеве"),
    h(
      "ol",
      { class: "issues-bars", "aria-label": "Дни по верни отговори" },
      spread.map((n, i) =>
        h(
          "li",
          {
            class: i === today ? "issues-bar today" : "issues-bar",
            title: `${i} от 10: ${n} ${n === 1 ? "ден" : "дни"}${i === today ? " (днес)" : ""}`,
          },
          h("span", { class: "issues-n" }, n ? String(n) : ""),
          h("span", { class: "issues-fill", style: { "--tall": String(most ? n / most : 0) } }),
          h("span", { class: "issues-score", "aria-hidden": "true" }, String(i)),
          h("span", { class: "sr" }, `${i} от 10: ${n} ${n === 1 ? "ден" : "дни"}`),
        ),
      ),
    ),
    h(
      "p",
      { class: "muted issues-line" },
      `Най-добър: ${best} от 10 · Средно: ${formatNumber(average, 0.1)} · Изиграни: ${formatNumber(days)}`,
    ),
  );
}

// How a player stands, as Профил shows them their own: their seal, the streak (and their longest) and this week, their
// latest games (today's each a way to go over it: /games/<id>) and the way to all of them (/games). No lifetime
// totals (play/stats.go).

import { api } from "../lib/api.ts";
import { dayInBulgaria } from "../lib/day.ts";
import { h } from "../lib/dom.ts";
import { withWord } from "../lib/words.ts";
import { topics } from "../state.ts";

export interface Stats {
  /** The player's avatar, as others see it ("shape-tone"). */
  avatar: string;
  /** The seal they wear (play.Seal): a chapter's rank. */
  seal?: { chapter: string; level: number; name: string; quarter: number };
  streak: number;
  /** The longest streak the player has had. */
  best: number;
  week: boolean[];
  /** This week's day missed that the streak forgave, Monday first. */
  forgiven: boolean[];
  /** Whether this week would still forgive a day missed. */
  spare: boolean;
  /** How many missed days a week the streak forgives the player. */
  perWeek: number;
  recent: Played[];
}

/** A finished game, as a list of them has it. */
export interface Played {
  id: number;
  kind: "day" | "topic" | "duel";
  day?: string;
  /** The day's ten's: the day's issue. */
  issue?: number;
  category?: string;
  rights: number;
  total: number;
  at: number;
  opponent?: string;
  recorded?: boolean;
  outcome?: "won" | "lost" | "draw";
}

export const loadStats = () => api<Stats>("GET", "/api/me/stats");

const topicName = (id?: string) => (id ? (topics.find((c) => c.id === id)?.name ?? id) : "Всички теми");
const outcome = { won: "победа", lost: "загуба", draw: "равенство" };

/** What a game was, as a list of games says it (its date beside it, or over it): the day's ten by their issue
 * („Брой 7“). */
function what(p: Played): string {
  switch (p.kind) {
    case "day":
      return p.issue ? `Брой ${p.issue}` : "Въпросите на деня";
    case "duel":
      // A duel cut off has no result: only that it was a duel.
      if (!p.outcome) return "Дуел";
      return `${p.recorded ? `Срещу запис на ${p.opponent}` : `Дуел ${withWord(p.opponent ?? "")}`}, ${outcome[p.outcome]}`;
    default:
      return topicName(p.category);
  }
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

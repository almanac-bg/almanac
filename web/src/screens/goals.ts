// The day's goals: three a day, each one game at most — the day's questions, another game drawn for the player, and a
// game played well (8 of 10) — each worth XP once done, and each a way to where it's done (play/goals.go). All three
// done earn a reserve day, which keeps the streak through a day missed: one a week at most, from the streak's third day
// (play/runs.go); the card says when they won't. Начало has them in a card; the day's result, just played, has those
// still open, quietly, as what's next.

import { picture } from "../art/picture.ts";
import { fresh, last } from "../lib/api.ts";
import { type Child, h, type Signal, signal } from "../lib/dom.ts";
import { user } from "../state.ts";
import { meter, reserveWords } from "../ui.ts";

export interface DayGoal {
  id: string;
  name: string;
  target: number;
  /** Where it's done; none: anywhere, or right here. */
  href?: string;
  progress: number;
  done: boolean;
  xp: number;
}

export interface Goals {
  goals: DayGoal[];
  /** Reserve days in hand, of the most there can be: all three goals done earns one. */
  reserve: number;
  reserveMax: number;
  /** What all three done today bring the streak: a reserve day (""), or nothing, as all are in hand ("full"), this
   * week's is earned ("week") or the streak is under three days ("soon"). */
  reserveBy: "" | "full" | "week" | "soon";
}

/** The day's goals: the server asked again, while what it said last is drawn (keptGoals). */
export const loadGoals = () => fresh<Goals>("/api/goals");

/** What the server said last of the day's goals, if anything (lib/api.ts, last). */
export const keptGoals = () => last<Goals>("/api/goals") ?? null;

/** A goal: its mark, its name (until done, the way to where it's done), the XP it earns, and how far along. */
function goalRow(g: DayGoal): Child {
  return h(
    "li",
    { class: g.done ? "goal done" : "goal" },
    h("span", { class: "goal-mark", "aria-hidden": "true" }),
    g.href && !g.done
      ? h("a", { class: "goal-name", href: g.href }, g.name)
      : h("span", { class: "goal-name" }, g.name),
    h("span", { class: "goal-xp num" }, `+${g.xp} XP`),
    g.target > 1 && !g.done ? meter(Math.round((100 * g.progress) / g.target), `${g.progress} от ${g.target}`) : null,
    g.target > 1 && !g.done ? h("span", { class: "goal-n num" }, `${g.progress}/${g.target}`) : null,
    h("span", { class: "sr" }, g.done ? "изпълнена" : "още не"),
  );
}

/** The day's result, just played: the goals still open, as what's next, quietly (no card), each the way to where it's
 * done; nothing once all three are done. */
export function openGoals(goals: Signal<Goals | null>): Child {
  return () => {
    const open = goals()?.goals.filter((g) => !g.done) ?? [];
    if (!open.length) return null;
    return h(
      "section",
      { class: "open-goals", "aria-label": "Цели за деня" },
      h("p", { class: "kicker" }, open.length === 1 ? "Още една цел днес" : "Още цели днес"),
      h("ul", { class: "goal-list" }, open.map(goalRow)),
    );
  };
}

/** Начало's card: today's three goals, how far along each is, the XP each earns, and (until done) the way to it. */
export function goalsCard(): Child {
  if (!user.peek()) return null;
  const data = signal<Goals | null>(keptGoals());
  loadGoals().then(data.set, () => {});
  return () => {
    const d = data();
    if (!d) return null;
    const goals = d.goals;
    const all3 = goals.every((g) => g.done);
    const earned = goals.filter((g) => g.done).reduce((n, g) => n + g.xp, 0);
    const all = goals.reduce((n, g) => n + g.xp, 0);
    return h(
      "section",
      { class: "card goals" },
      h(
        "div",
        { class: "card-head" },
        h("h2", { class: "card-title" }, "Цели за деня"),
        h("span", { class: "tag num" }, `${earned} от ${all} XP`),
      ),
      h("ul", { class: "goal-list" }, goals.map(goalRow)),
      // All three keep the streak through a missed day, or why not now.
      h(
        "p",
        { class: all3 ? "goals-reserve done" : "goals-reserve" },
        picture("shield", "reserve-pic"),
        d.reserveBy === "full"
          ? `Имаш всички резервни дни: ${d.reserve} от ${d.reserveMax}.`
          : d.reserveBy === "week"
            ? all3
              ? `И трите са изпълнени. Резервният ден за седмицата е спечелен: имаш ${reserveWords(d.reserve)}.`
              : "Резервният ден за седмицата е спечелен."
            : d.reserveBy === "soon"
              ? "Резервен ден за серията идва на третия ден поред."
              : "Изпълни и трите: +1 резервен ден за серията.",
      ),
    );
  };
}

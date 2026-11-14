// The day's goals: three a day — the day's questions, a goal drawn for the player and a harder one — each worth XP
// once done (more for the harder), and each a way to where it's done. All three done earn a reserve day, which keeps
// the streak through a day missed.

import { picture } from "../art/picture.ts";
import { api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { user } from "../state.ts";
import { meter, reserveWords } from "../ui.ts";

interface DayGoal {
  id: string;
  name: string;
  target: number;
  /** Where it's done; none: anywhere, or right here. */
  href?: string;
  progress: number;
  done: boolean;
  xp: number;
}

interface Goals {
  goals: DayGoal[];
  /** Reserve days in hand, of the most there can be: all three goals done earns one. */
  reserve: number;
  reserveMax: number;
}

/** Начало's card: today's three goals, how far along each is, the XP each earns, and (until done) the way to it. */
export function goalsCard(): Child {
  if (!user.peek()) return null;
  const data = signal<Goals | null>(null);
  api<Goals>("GET", "/api/goals").then(data.set, () => {});
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
        h("h2", { class: "card-title" }, "Днешни цели"),
        h("span", { class: "tag gold num" }, `${earned} от ${all} XP`),
      ),
      h(
        "ul",
        { class: "goal-list" },
        goals.map((g) =>
          h(
            "li",
            { class: g.done ? "goal done" : "goal" },
            h("span", { class: "goal-mark", "aria-hidden": "true" }),
            g.href && !g.done
              ? h("a", { class: "goal-name", href: g.href }, g.name)
              : h("span", { class: "goal-name" }, g.name),
            h("span", { class: "goal-xp num" }, `+${g.xp} XP`),
            g.target > 1 && !g.done
              ? meter(Math.round((100 * g.progress) / g.target), `${g.progress} от ${g.target}`)
              : null,
            g.target > 1 && !g.done ? h("span", { class: "goal-n num" }, `${g.progress}/${g.target}`) : null,
            h("span", { class: "sr" }, g.done ? "изпълнена" : "още не"),
          ),
        ),
      ),
      // All three keep the streak through a missed day.
      h(
        "p",
        { class: all3 ? "goals-reserve done" : "goals-reserve" },
        picture("shield", "reserve-pic"),
        all3
          ? `И трите са изпълнени: имаш ${reserveWords(d.reserve)} за серията.`
          : d.reserve >= d.reserveMax
            ? `Резервните ти дни са пълни: ${d.reserve} от ${d.reserveMax}.`
            : "Изпълни и трите: +1 резервен ден за серията.",
      ),
    );
  };
}

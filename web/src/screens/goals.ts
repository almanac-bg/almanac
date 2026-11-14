// The day's goals: three a day — the day's questions, a goal drawn for the player and a harder one — each worth XP
// once done (more for the harder), and each a way to where it's done.

import { api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { user } from "../state.ts";
import { meter } from "../ui.ts";

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

/** Начало's card: today's three goals, how far along each is, the XP each earns, and (until done) the way to it. */
export function goalsCard(): Child {
  if (!user.peek()) return null;
  const data = signal<DayGoal[] | null>(null);
  api<{ goals: DayGoal[] }>("GET", "/api/goals").then(
    (r) => data.set(r.goals),
    () => {},
  );
  return () => {
    const goals = data();
    if (!goals) return null;
    const earned = goals.filter((g) => g.done).reduce((n, g) => n + g.xp, 0);
    const all = goals.reduce((n, g) => n + g.xp, 0);
    return h(
      "section",
      { class: "card goals" },
      h(
        "div",
        { class: "card-head" },
        h("h2", null, "Днешни цели"),
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
    );
  };
}

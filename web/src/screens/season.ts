// The day's goals and the season: three goals a day, each a star; a season (a calendar month) counts the stars, and
// enough of them earn its medal — bronze, silver, gold, and with gold its frame.

import { seasonBanner, seasonMedal, seasonName } from "../art/season.ts";
import { api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { user } from "../state.ts";
import { meter } from "../ui.ts";

interface DayGoal {
  id: string;
  name: string;
  target: number;
  progress: number;
  done: boolean;
}

interface Season {
  id: string;
  stars: number;
  daysLeft: number;
  hue: number;
  tiers: { stars: number; id: string; name: string }[];
  past: { id: string; stars: number; medal?: string; hue: number }[];
}

const load = () => api<{ goals: DayGoal[]; season: Season }>("GET", "/api/season");

/** The next medal of a season, and how many stars it takes; none once gold is in. */
function nextTier(s: Season) {
  return s.tiers.find((t) => s.stars < t.stars);
}

/** Начало's card: today's three goals, and the season's stars. */
export function goalsCard(): Child {
  if (!user.peek()) return null;
  const data = signal<{ goals: DayGoal[]; season: Season } | null>(null);
  load().then(data.set, () => {});
  return () => {
    const d = data();
    if (!d) return null;
    const next = nextTier(d.season);
    return h(
      "section",
      { class: "card goals" },
      h(
        "div",
        { class: "card-head" },
        h("h2", null, "Днешни цели"),
        h("span", { class: "tag gold" }, `★ ${d.goals.filter((g) => g.done).length} от ${d.goals.length}`),
      ),
      h(
        "ul",
        { class: "goal-list" },
        d.goals.map((g) =>
          h(
            "li",
            { class: g.done ? "goal done" : "goal" },
            h("span", { class: "goal-mark", "aria-hidden": "true" }),
            h("span", { class: "goal-name" }, g.name),
            g.target > 1 && !g.done ? h("span", { class: "goal-n num" }, `${g.progress}/${g.target}`) : null,
            g.target > 1 && !g.done
              ? meter(Math.round((100 * g.progress) / g.target), `${g.progress} от ${g.target}`)
              : null,
            h("span", { class: "sr" }, g.done ? "изпълнена" : "още не"),
          ),
        ),
      ),
      h(
        "a",
        { class: "season-strip", href: "/rewards" },
        h("span", null, `${seasonName(d.season.id)}: `, h("b", null, `${d.season.stars} ★`)),
        h("span", { class: "muted" }, next ? `${next.name} медал при ${next.stars} ★` : "Златният медал е твой"),
      ),
    );
  };
}

/** Награди's season: its banner, the stars, the three medals on the way, the days left, and the seasons before. */
export function seasonSection(): Child {
  const data = signal<Season | null>(null);
  load().then(
    (r) => data.set(r.season),
    () => {},
  );
  return () => {
    const s = data();
    if (!s) return null;
    const top = s.tiers[s.tiers.length - 1]?.stars ?? 1;
    return h(
      "section",
      { class: "stack" },
      h("h2", { class: "section-title" }, "Сезон"),
      h(
        "div",
        { class: "card season-card" },
        seasonBanner(s.id),
        h(
          "div",
          { class: "season-head" },
          h("h3", null, seasonName(s.id)),
          h("span", { class: "muted" }, `още ${s.daysLeft} ${s.daysLeft === 1 ? "ден" : "дни"}`),
        ),
        h("p", { class: "season-stars" }, h("b", null, String(s.stars)), " ★"),
        meter(Math.min(100, Math.round((100 * s.stars) / top)), `${s.stars} от ${top} звезди`),
        h(
          "ol",
          { class: "season-track" },
          s.tiers.map((t) =>
            h(
              "li",
              { class: s.stars >= t.stars ? "reached" : "" },
              seasonMedal(t.id, s.stars >= t.stars),
              h("span", null, h("b", null, `${t.name} медал`), h("span", { class: "muted" }, ` · ${t.stars} ★`)),
              t.id === "gold" ? h("span", { class: "muted small" }, "и рамката на сезона") : null,
            ),
          ),
        ),
        h("p", { class: "muted" }, "Звезда за всяка изпълнена дневна цел: до три на ден."),
      ),
      s.past.length
        ? h(
            "ul",
            { class: "season-past" },
            s.past.map((p) =>
              h(
                "li",
                null,
                p.medal ? seasonMedal(p.medal, true) : null,
                h("span", null, seasonName(p.id), h("span", { class: "muted" }, ` · ${p.stars} ★`)),
              ),
            ),
          )
        : null,
    );
  };
}

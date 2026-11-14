// Профил's season: the rating's month as the player stands in it — their games, their place — the podium medals
// they've won, and how the seasons before ended for them.

import { emblem } from "../art/emblem.ts";
import { metal, podiumMedal, seasonName } from "../art/season.ts";
import { api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { ordinal, place } from "../lib/ordinal.ts";
import { games, meter } from "../ui.ts";
import { daysLeft, type Season } from "./ranks.ts";

const places = ["Шампион", "Вицешампион", "Бронзов медалист"];

export function seasonCard(): Child {
  const data = signal<Season | null>(null);
  api<Season>("GET", "/api/season").then(data.set, () => {});
  return () => {
    const s = data();
    if (!s) return null;
    const won = s.podium.some((x) => x > 0);
    return h(
      "section",
      { class: "card season-card" },
      h(
        "div",
        { class: "season-head" },
        h("h2", null, `Сезон ${seasonName(s.id)}`),
        h("span", { class: "muted" }, daysLeft(s.daysLeft)),
      ),
      s.place
        ? h(
            "p",
            { class: "season-place" },
            h("b", null, ordinal(s.place, "n")),
            h("span", { class: "muted" }, ` място от ${s.of}`),
          )
        : [
            h("p", null, `Още ${games(s.minGames - s.games)} за рейтинг и влизаш в класирането на сезона.`),
            meter(Math.round((100 * s.games) / s.minGames), `${s.games} от ${s.minGames} игри`),
          ],
      won
        ? h(
            "ul",
            { class: "podium", "aria-label": "Медали от сезони" },
            s.podium.map((count, i) =>
              h(
                "li",
                { class: count ? "" : "none" },
                podiumMedal(i + 1, count > 0),
                h("span", null, places[i], h("b", { class: "num" }, ` ×${count}`)),
              ),
            ),
          )
        : h("p", { class: "board-note" }, "Първите трима в края на сезона печелят медал, рамка и титла."),
      s.past.length
        ? h(
            "ul",
            { class: "season-past", "aria-label": "Минали сезони" },
            s.past.map((p) =>
              h(
                "li",
                { class: `d-${metal(p.place)}` },
                p.place <= 3 ? podiumMedal(p.place, true, "s") : emblem(p.division.id, "s"),
                h(
                  "span",
                  null,
                  h("b", null, `Сезон ${seasonName(p.id)}`),
                  h("span", { class: "muted" }, ` · ${place(p.place, p.of)} · ${p.division.name}, ${p.rating}`),
                ),
              ),
            ),
          )
        : null,
    );
  };
}

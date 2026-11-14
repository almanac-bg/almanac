// „Твоята 2026“: a player's year in the game, one card at a time — the days they played and their longest streak,
// their answers, their strongest topic, the facts they learned (and the first of them), their duels and who they
// played most, their best Роял, the highest league they reached, the XP of it all — and, at the end, a few lines to
// share. It opens on Начало from mid-December into January (yearCard) and stays in Профил after (yearLink).

import { leagueEmblem } from "../art/league.ts";
import { shareButton } from "../game/results.ts";
import { count, yearShareText } from "../game/share.ts";
import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { ordinal } from "../lib/ordinal.ts";
import { title } from "../lib/router.ts";
import { yearNow } from "../lib/year.ts";
import { categories, user } from "../state.ts";
import { fact, formatNumber } from "../ui.ts";
import type { League } from "./league.ts";

interface Year {
  year: number;
  days: number;
  streak: number;
  games: number;
  answers: number;
  right: number;
  topic?: { category: string; known: number; name: string };
  facts: number;
  first?: { question: string; answer: string; fact: string };
  duels: number;
  won: number;
  royal?: number;
  royalOf?: number;
  league?: League;
  rival?: string;
  rivalGames?: number;
  xp: number;
}

/** A topic's name, by its id. */
const topicName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

/** Начало's way in, while the year's look back is fresh. */
export function yearCard(): Child {
  const { year, fresh } = yearNow();
  if (!year || !fresh || !user.peek()) return null;
  return h(
    "a",
    { class: "card year-card", href: `/year/${year}` },
    h("p", { class: "kicker" }, "Годината ти в играта"),
    h("strong", null, `Твоята ${year}`),
    h("span", { class: "muted" }, "Дни, отговори, научени факти и още. Виж ги."),
  );
}

/** Профил's way in, once a year's look back has opened. */
export function yearLink(): Child {
  const { year } = yearNow();
  return year ? h("a", { class: "link", href: `/year/${year}` }, `Твоята ${year}`) : null;
}

/** One card of the year: a word above, a big figure, and what it means. */
function slide(kicker: string, big: Child, ...more: Child[]): Child {
  return h(
    "div",
    { class: "year-slide" },
    h("p", { class: "kicker" }, kicker),
    h("div", { class: "year-big" }, big),
    ...more.map((m) => (typeof m === "string" ? h("p", null, m) : m)),
  );
}

/** The cards of a year, only those it has something for. */
function slides(y: Year): Child[] {
  const out: Child[] = [
    slide(
      `Твоята ${y.year}`,
      "АЛМАНАХ",
      y.days ? "Ето какво свърши в играта тази година." : "Тази година още нямаш игри. Има време.",
    ),
  ];
  if (!y.days) return out;
  out.push(
    slide(
      "Дни игра",
      formatNumber(y.days),
      y.streak > 1
        ? `Най-дългата ти серия: ${count(y.streak, "ден", "дни")} поред с въпросите на деня.`
        : `${count(y.games, "игра", "игри")} до край.`,
    ),
  );
  const share = y.answers ? Math.round((100 * y.right) / y.answers) : 0;
  out.push(slide("Отговори", formatNumber(y.answers), `${share}% от тях верни, в ${count(y.games, "игра", "игри")}.`));
  if (y.topic)
    out.push(
      slide(
        "Най-силната ти тема",
        topicName(y.topic.category),
        `Знаеш ${y.topic.known}% от въпросите в нея: ${y.topic.name}.`,
      ),
    );
  if (y.facts)
    out.push(
      slide(
        "Научи",
        count(y.facts, "факт", "факта"),
        "Всички са в Моят Алманах. Първият:",
        y.first ? fact(y.first.fact) : null,
      ),
    );
  if (y.duels)
    out.push(
      slide(
        "Дуели",
        `${formatNumber(y.won)} от ${formatNumber(y.duels)}`,
        "спечелени.",
        y.rival && (y.rivalGames ?? 0) > 1
          ? `Най-често срещу ${y.rival}: ${count(y.rivalGames ?? 0, "дуел", "дуела")}.`
          : null,
      ),
    );
  if (y.royal)
    out.push(
      slide("Роял", `${ordinal(y.royal, "n")} място`, `Най-доброто ти от ${count(y.royalOf ?? 0, "играч", "играчи")}.`),
    );
  if (y.league)
    out.push(
      slide(
        "Лигата",
        h("span", { class: "year-league" }, leagueEmblem(y.league.tier, "l"), y.league.name),
        "Най-високо, докъдето стигна.",
      ),
    );
  out.push(slide("XP за годината", `+${formatNumber(y.xp)}`, "Благодарим, че игра."));
  return out;
}

export function year([which = ""]: string[]) {
  const n = Number(which);
  title(`Твоята ${n}`);
  const data = signal<Year | null>(null);
  const error = signal("");
  const at = signal(0);
  if (user.peek()) api<Year>("GET", `/api/year/${n}`).then(data.set, (err) => error.set((err as ApiError).message));
  return h("section", { class: "screen year" }, (): Child => {
    if (!user()) return h("p", { class: "muted" }, "Изиграй първите си въпроси и годината ти ще се събира тук.");
    if (error()) return h("p", { role: "alert" }, error());
    const y = data();
    if (!y) return h("p", { class: "muted" }, "…");
    const all = slides(y);
    const i = Math.min(at(), all.length - 1);
    const last = i === all.length - 1;
    return [
      h(
        "ol",
        { class: "year-pips", "aria-label": `${i + 1} от ${all.length}` },
        all.map((_, k) => h("li", { class: k <= i ? "on" : "" })),
      ),
      h("div", { class: "card year-story", "aria-live": "polite" }, all[i]),
      last
        ? h(
            "div",
            { class: "actions" },
            y.days
              ? shareButton(
                  "Сподели годината",
                  () => yearShareText({ ...y, topic: y.topic ? topicName(y.topic.category) : undefined }),
                  undefined,
                  true,
                )
              : null,
            h("a", { class: "btn", href: "/" }, "Към началото"),
          )
        : h(
            "div",
            { class: "actions" },
            h("button", { class: "btn primary big", type: "button", onclick: () => at.set(i + 1) }, "Напред"),
            i > 0 ? h("button", { class: "btn", type: "button", onclick: () => at.set(i - 1) }, "Назад") : null,
          ),
    ];
  });
}

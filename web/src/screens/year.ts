// „Твоята 2026“: a player's year in the game, one card at a time — the days they played and their longest streak,
// their answers, their strongest topic, the facts they learned (and the first of them), their duels and who they
// played most, their best Роял, the highest league they reached, the XP of it all — and, at the end, a few lines to
// share. It opens on Начало from mid-December into January (screens/today.ts) and stays in Профил after (screens/me.ts).

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { League } from "./league.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  loading,
  leagueEmblem,
  shareButton,
  count,
  yearShareText,
  api,
  h,
  signal,
  ordinal,
  title,
  categories,
  user,
  fact,
  failure,
  formatNumber,
} = {} as Kit;

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
      y.days ? "Ето годината ти в играта." : "Тази година още нямаш игри. Има време.",
    ),
  ];
  if (!y.days) return out;
  out.push(
    slide(
      "Дни игра",
      formatNumber(y.days),
      y.streak > 1
        ? `Най-дългата ти серия: ${count(y.streak, "ден", "дни")} поред с въпросите на деня.`
        : `${count(y.games, "изиграна игра", "изиграни игри")}.`,
    ),
  );
  const share = y.answers ? Math.round((100 * y.right) / y.answers) : 0;
  out.push(slide("Отговори", formatNumber(y.answers), `${share}% от тях верни, в ${count(y.games, "игра", "игри")}.`));
  if (y.topic)
    out.push(
      slide(
        "Най-силната ти тема",
        topicName(y.topic.category),
        `Знаеш ${y.topic.known}% от въпросите в нея. Степен: ${y.topic.name}.`,
      ),
    );
  if (y.facts)
    out.push(
      slide(
        "Научени факти",
        count(y.facts, "факт", "факта"),
        "Всички са в Алманаха ти. Първият:",
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
      slide(
        "Роял",
        `${ordinal(y.royal, "n")} място`,
        `Най-доброто ти класиране, сред ${count(y.royalOf ?? 0, "играч", "играчи")}.`,
      ),
    );
  if (y.league)
    out.push(
      slide(
        "Лигата",
        h("span", { class: "year-league" }, leagueEmblem(y.league.tier, "l"), y.league.name),
        "Най-високата лига, до която стигна.",
      ),
    );
  out.push(slide("XP за годината", `+${formatNumber(y.xp)}`, "Благодарим ти, че играеш."));
  return out;
}

export function year(kit: Kit, [which = ""]: string[]) {
  ({
    loading,
    leagueEmblem,
    shareButton,
    count,
    yearShareText,
    api,
    h,
    signal,
    ordinal,
    title,
    categories,
    user,
    fact,
    failure,
    formatNumber,
  } = kit);
  const n = Number(which);
  title(`Твоята ${n}`);
  const data = signal<Year | null>(null);
  const error = signal<unknown>(null);
  const at = signal(0);
  const load = () => {
    error.set(null);
    if (user.peek()) api<Year>("GET", `/api/year/${n}`).then(data.set, error.set);
  };
  load();
  return h("section", { class: "screen year" }, (): Child => {
    if (!user()) return h("p", { class: "muted" }, "Изиграй първите си въпроси и годината ти ще се събира тук.");
    if (error()) return failure(error(), load, ["/me", "Към Профил"]);
    const y = data();
    if (!y) return loading("card", "rows");
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
            h("a", { class: "btn", href: "/" }, "Към Начало"),
          )
        : // „Напред“ keeps its place from card to card, „Назад“ under it (never on its right).
          h(
            "div",
            { class: "actions year-pager" },
            h("button", { class: "btn primary big", type: "button", onclick: () => at.set(i + 1) }, "Напред"),
            i > 0 ? h("button", { class: "btn", type: "button", onclick: () => at.set(i - 1) }, "Назад") : null,
          ),
    ];
  });
}

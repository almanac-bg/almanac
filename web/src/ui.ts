// The pieces several screens draw with: the verdict and the fact, the streak, numbers with what they count, rings, and each
// topic's colour and level. The stylesheet draws them; these only say what to draw.

import { type Child, h } from "./lib/dom.ts";
import { categories } from "./state.ts";

export type VerdictKind = "exact" | "right" | "partial" | "wrong" | "time";

const verdictWords: Record<VerdictKind, string> = {
  exact: "Точно!",
  right: "Вярно!",
  partial: "Близо.",
  wrong: "Не е това.",
  time: "Времето изтече.",
};

/** How an answer went: its sign, the word, and the points it brought. */
export function verdict(kind: VerdictKind, points: number, words = verdictWords[kind]): Child {
  return h(
    "p",
    { class: `verdict ${kind}`, role: "status" },
    h("span", { class: "verdict-sign", "aria-hidden": "true" }),
    h("strong", { class: "verdict-word" }, words),
    points > 0 ? h("span", { class: "verdict-pts" }, `+${points}`) : null,
  );
}

/** The fact behind an answer. */
export function fact(text: string): Child {
  return h("aside", { class: "fact" }, h("h2", null, "Знаеше ли?"), h("p", null, text));
}

const tones = ["gold", "lilac", "sky", "rose", "mint"];

/** A topic's colour, the same on every screen (by its place in the bank's list). */
export function toneOf(category: string): string {
  const i = Math.max(
    0,
    categories.findIndex((c) => c.id === category),
  );
  return `tone-${tones[i % tones.length]}`;
}

export interface Level {
  /** Share right, 0–100. */
  percent: number;
  /** 1–4. */
  n: number;
  name: string;
}

/** How well a player knows a topic, once they've answered enough of it to tell (ten questions). */
export function level(right: number, answers: number): Level | null {
  if (answers < 10) return null;
  const percent = Math.round((100 * right) / answers);
  const [n, name] =
    percent >= 80 ? [4, "Майстор"] : percent >= 60 ? [3, "Познавач"] : percent >= 40 ? [2, "Любител"] : [1, "Новак"];
  return { percent, n, name };
}

/** A level as four rising bars and its name. */
export function levelBadge(l: Level): Child {
  return h(
    "span",
    { class: "level", title: `Ниво ${l.n} от 4` },
    h(
      "span",
      { class: "bars", "aria-hidden": "true" },
      [1, 2, 3, 4].map((n) => h("i", { class: n <= l.n ? "on" : undefined })),
    ),
    l.name,
  );
}

/** A thin bar, filled to percent. */
export function meter(percent: number, label: string): Child {
  return h(
    "span",
    { class: "meter", role: "img", "aria-label": label },
    h("i", { class: "meter-fill", style: { width: `${Math.max(0, Math.min(100, percent))}%` } }),
  );
}

/** A number and what it counts, in a card. */
export function stat(value: string, label: string, tone = ""): Child {
  return h(
    "div",
    { class: tone ? `stat ${tone}` : "stat" },
    h("b", { class: "stat-value" }, value),
    h("span", { class: "stat-label" }, label),
  );
}

/** A number and what it counts, bare (inside a card). */
export function figure(value: string, label: string): Child {
  return h(
    "div",
    { class: "figure" },
    h("b", { class: "figure-value" }, value),
    h("span", { class: "figure-label" }, label),
  );
}

/** A share as a ring, with what it's of. */
export function ring(percent: number, label: string, tone: string): Child {
  const v = Math.max(0, Math.min(100, Math.round(percent)));
  return h(
    "figure",
    { class: `ring ${tone}` },
    h(
      "div",
      { class: "ring-box" },
      h("span", { class: "dial", style: { "--v": String(v) }, "aria-hidden": "true" }),
      h("b", { class: "ring-value" }, String(v), h("small", null, "%")),
    ),
    h("figcaption", null, label),
  );
}

const dayLetters = ["П", "В", "С", "Ч", "П", "С", "Н"];
const dayNames = ["понеделник", "вторник", "сряда", "четвъртък", "петък", "събота", "неделя"];
const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Sofia", weekday: "short" });

/** Today in Bulgaria, Monday first (0–6): the game's days are Bulgaria's. */
function today(): number {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday.format(new Date()));
}

/** The streak: days in a row with the day's ten, and this week's days played. */
export function streak(days: number, week?: boolean[]): Child {
  const unit = days === 1 ? "ден" : "дни";
  const now = today();
  return h(
    "section",
    { class: days ? "streak" : "streak cold", "aria-label": `Серия: ${days} ${unit}` },
    h("span", { class: "i flame", "aria-hidden": "true" }),
    h(
      "div",
      null,
      h(
        "div",
        { class: "streak-count" },
        h("b", { class: "streak-num" }, String(days)),
        h("span", { class: "streak-unit" }, unit),
      ),
      h("p", null, days ? "поред с въпросите на деня" : "Изиграй днешните и започни серия."),
    ),
    week?.length === 7
      ? h(
          "ol",
          { class: "week", "aria-label": "Тази седмица" },
          dayLetters.map((d, i) =>
            h(
              "li",
              {
                class: [week[i] && "on", i === now && "today"].filter(Boolean).join(" ") || undefined,
                "aria-label": `${dayNames[i]}${week[i] ? ": изиграно" : ""}`,
              },
              h("i", { class: "week-dot" }),
              d,
            ),
          ),
        )
      : null,
  );
}

/** A count of games, the way it's said: 1 игра, 2 игри. */
export const games = (n: number) => `${n} ${n === 1 ? "игра" : "игри"}`;
/** A count of questions: 1 въпрос, 2 въпроса. */
export const questions = (n: number) => `${n} ${n === 1 ? "въпрос" : "въпроса"}`;

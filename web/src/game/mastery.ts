// Mastery: how well a player knows each topic — the share of its questions they'd know, and a tier for it, Новак to
// Светило (play/mastery.go works it out from every answer, each weighed by how hard its question is).

import { type Child, h } from "../lib/dom.ts";
import { categories } from "../state.ts";
import { meter, questions, toneOf, topicMark } from "../ui.ts";
import { type Mastery, type MasteryMove, masteryNews } from "./known.ts";

export type { Mastery, MasteryMove } from "./known.ts";

/** How many tiers there are (play.MasteryTiers). */
const TIERS = 6;

/** How many answers in a topic it takes for a first estimate (play.MasteryFirst), and to tell it with its tier
 * (play.MasteryFrom). */
const FIRST = 10;
const FROM = 30;

const topicName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

/** A tier as rising bars, lit up to it, and its name. */
export function masteryBadge(m: Mastery): Child {
  return h(
    "span",
    { class: "mastery", title: `Степен ${m.tier + 1} от ${TIERS}` },
    h(
      "span",
      { class: "bars", "aria-hidden": "true" },
      Array.from({ length: TIERS }, (_, i) => h("i", { class: i <= m.tier ? "on" : undefined })),
    ),
    m.name,
  );
}

/** What's left before a topic's mastery is told (a first estimate, then its tier), or to its next tier. */
export function masteryLeft(m: Mastery): string {
  if (!m.answers) return "Още не е играна";
  if (m.first) return `още ${questions(FROM - m.answers)} до степен`;
  if (!m.sure) return `още ${questions(FIRST - m.answers)} до оценка`;
  return m.next ? `още ${(m.nextAt ?? 0) - m.known}% до ${m.next}` : "най-високата степен";
}

/** A first estimate, said for what it is: „първа оценка · 74%“. */
const firstWords = (m: Mastery) => [
  h("span", { class: "muted" }, "първа оценка ·"),
  h("b", { class: "mastery-known" }, `${m.known}%`),
];

function row(m: Mastery, extra: Child = null): Child {
  // Still being found out: one line, the topic and its first estimate, or what's left before one.
  if (!m.sure)
    return h(
      "li",
      { class: `mastery-row ${toneOf(m.category)}` },
      h(
        "div",
        { class: "mastery-head" },
        h("span", { class: "mastery-topic" }, topicMark(m.category), topicName(m.category)),
        h("span", { class: "mastery-meta" }, extra, m.first ? firstWords(m) : masteryLeft(m)),
      ),
    );
  return h(
    "li",
    { class: `mastery-row ${toneOf(m.category)}` },
    h(
      "div",
      { class: "mastery-head" },
      h("span", { class: "mastery-topic" }, topicMark(m.category), topicName(m.category)),
      masteryBadge(m),
    ),
    meter(m.known, `${m.known}% от темата`),
    h(
      "div",
      { class: "mastery-meta" },
      h("b", { class: "mastery-known" }, `${m.known}%`),
      extra,
      h("span", null, masteryLeft(m)),
    ),
  );
}

/** Every topic, how well it's known: the best known first, then the two nearest to being told, the rest of those
 * still being found out and the ones not played yet named in a line each (a day's game touches all ten topics: ten
 * rows of „още 9 въпроса“ say nothing). Said to the player, or (another's) about them. */
export function masteryCard(all: Mastery[], theirs = false): Child {
  const order = (m: Mastery) => (m.sure ? 3000 + m.known : m.first ? 2000 + m.known : m.answers ? 1000 + m.answers : 0);
  const sorted = [...all].sort((a, b) => order(b) - order(a));
  const told = sorted.filter((m) => m.sure || m.first);
  const finding = sorted.filter((m) => m.answers && !m.sure && !m.first);
  const played = [...told, ...finding.slice(0, 2)];
  const later = finding.slice(2);
  const not = sorted.filter((m) => !m.answers);
  return h(
    "section",
    { class: "card stack" },
    h(
      "div",
      { class: "card-head" },
      h("h2", { class: "section-title" }, theirs ? "Колко знае" : "Колко знаеш"),
      h("span", { class: "muted small" }, "По-трудните въпроси тежат повече"),
    ),
    played.length
      ? h(
          "ol",
          { class: "mastery-list" },
          played.map((m) => row(m)),
        )
      : null,
    later.length
      ? h(
          "p",
          { class: "muted small" },
          `Скоро: ${later.map((m) => topicName(m.category)).join(", ")}. Първата оценка идва след ${FIRST} отговора в тема, степента — след ${FROM}.`,
        )
      : null,
    !played.length
      ? h("p", { class: "muted small" }, theirs ? "Още няма изиграни теми." : "Изиграй тема и ще видиш колко я знаеш.")
      : not.length
        ? h("p", { class: "muted small" }, `Още неиграни: ${not.map((m) => topicName(m.category)).join(", ")}.`)
        : null,
  );
}

/** How a topic's game moved its mastery, in a line, when it's news (masteryNews): the topic, how much of it is known
 * now and how it moved — „нова степен“ for a tier above the lowest reached, else the share gained; before its mark is
 * sure, a first estimate of what share of the topic it is, never a tier; or, while there's no estimate yet, what's left
 * before one. Of a game of several topics, the one that moved most. */
export function masteryLine(moves: MasteryMove[]): Child {
  const shown = (m: Mastery) => m.sure || !!m.first;
  const only = moves.length === 1 ? moves[0] : undefined;
  const move = moves.find(masteryNews) ?? (only && !shown(only.to) ? only : undefined);
  if (!move) return null;
  const { from, to } = move;
  const d = to.known - from.known;
  const change =
    to.tier > 0 && (!from.sure || to.tier > from.tier)
      ? h("span", { class: "delta up" }, "нова степен")
      : from.sure && d > 0
        ? h("span", { class: "delta up" }, `+${d}%`)
        : null;
  return h(
    "p",
    { class: `mastery-line ${toneOf(to.category)}` },
    topicMark(to.category),
    h("span", { class: "mastery-topic" }, topicName(to.category)),
    to.sure
      ? [h("b", { class: "mastery-known" }, `${to.known}%`), change, masteryBadge(to)]
      : to.first
        ? [
            h("span", { class: "muted" }, "Първа оценка: знаеш около"),
            h("b", { class: "mastery-known" }, `${to.known}%`),
            h("span", { class: "muted" }, "от темата"),
          ]
        : h("span", { class: "muted" }, masteryLeft(to)),
  );
}

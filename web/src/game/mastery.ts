// Mastery: how well a player knows each topic — the share of its questions they'd know, and a tier for it, Новак to
// Светило (play/mastery.go works it out from every answer, each weighed by how hard its question is).

import { type Child, h } from "../lib/dom.ts";
import { categories } from "../state.ts";
import { meter, questions, toneOf, topicMark } from "../ui.ts";

export interface Mastery {
  category: string;
  answers: number;
  known: number; // percent of the topic's questions
  tier: number; // 0 (Новак) … TIERS - 1 (Светило)
  name: string;
  next?: string;
  nextAt?: number;
  sure: boolean; // answers enough to tell: until then it's a guess, and isn't shown
}

export interface MasteryMove {
  from: Mastery;
  to: Mastery;
}

/** How many tiers there are (play.MasteryTiers). */
const TIERS = 6;

/** How many answers in a topic it takes to tell (play.MasteryFrom). */
const FROM = 10;

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

/** What's left before a topic's mastery is told, or to its next tier. */
export function masteryLeft(m: Mastery): string {
  if (!m.answers) return "Още не е играна";
  if (!m.sure) return `още ${questions(FROM - m.answers)} до оценка`;
  return m.next ? `още ${(m.nextAt ?? 0) - m.known}% до ${m.next}` : "най-високата степен";
}

function row(m: Mastery, extra: Child = null): Child {
  // Still being found out: one line, the topic and what's left before it's told.
  if (!m.sure)
    return h(
      "li",
      { class: `mastery-row ${toneOf(m.category)}` },
      h(
        "div",
        { class: "mastery-head" },
        h("span", { class: "mastery-topic" }, topicMark(m.category), topicName(m.category)),
        h("span", { class: "mastery-meta" }, extra, masteryLeft(m)),
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

/** Every topic, how well it's known: the best known first, then those still being found out, and the ones not
 * played yet named in a line. Said to the player, or (another's) about them. */
export function masteryCard(all: Mastery[], theirs = false): Child {
  const order = (m: Mastery) => (m.sure ? 2000 + m.known : m.answers ? 1000 + m.answers : 0);
  const sorted = [...all].sort((a, b) => order(b) - order(a));
  const played = sorted.filter((m) => m.answers);
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
    !played.length
      ? h("p", { class: "muted small" }, theirs ? "Още няма изиграни теми." : "Изиграй тема и ще видиш колко я знаеш.")
      : not.length
        ? h("p", { class: "muted small" }, `Още неиграни: ${not.map((m) => topicName(m.category)).join(", ")}.`)
        : null,
  );
}

/** How a topic's game moved its mastery, in a line: the topic, how much of it is known now and by how much that moved
 * (a new tier said), or what's left before it's told. Of a game of several topics, the one that moved most. */
export function masteryLine(moves: MasteryMove[]): Child {
  const told = moves.filter((m) => m.to.sure && (!m.from.sure || m.to.known !== m.from.known));
  const move = told[0] ?? (moves.length === 1 ? moves[0] : undefined);
  if (!move) return null;
  const { from, to } = move;
  const d = to.known - from.known;
  const change =
    from.sure && to.tier > from.tier
      ? h("span", { class: "delta up" }, "нова степен")
      : !from.sure
        ? h("span", { class: "delta up" }, "първа оценка")
        : d !== 0
          ? h("span", { class: d > 0 ? "delta up" : "delta down" }, `${d > 0 ? "+" : ""}${d}%`)
          : null;
  return h(
    "p",
    { class: `mastery-line ${toneOf(to.category)}` },
    topicMark(to.category),
    h("span", { class: "mastery-topic" }, topicName(to.category)),
    to.sure
      ? [h("b", { class: "mastery-known" }, `${to.known}%`), change, masteryBadge(to)]
      : h("span", { class: "muted" }, masteryLeft(to)),
  );
}

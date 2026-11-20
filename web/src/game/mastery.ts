// Mastery: how well a player knows each topic — the share of its questions they'd know, and a tier for it, Новак to
// Светило (play/mastery.go works it out from every answer, each weighed by how hard its question is).

import { type Child, h } from "../lib/dom.ts";
import { categories } from "../state.ts";
import { meter, questions, toneOf, topicMark } from "../ui.ts";

/** A topic's mastery as the server sends it (play.Mastery). */
export interface Mastery {
  category: string;
  answers: number;
  known: number; // percent of the topic's questions
  tier: number; // 0 (Новак) … TIERS - 1 (Светило)
  name: string;
  next?: string;
  nextAt?: number;
  sure: boolean; // answers enough to tell, with its tier: until then it's a guess
  first?: boolean; // answers enough for a first estimate, not yet sure: its share is told, never its tier
}

/** How a game moved a topic's mastery (play.MasteryMove). */
export interface MasteryMove {
  from: Mastery;
  to: Mastery;
}

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

/** A topic's row: how well it's known; the whole row a way to play it (`play`: the player's own). */
function row(m: Mastery, extra: Child = null, play = false): Child {
  const topic = play
    ? h(
        "a",
        { class: "mastery-topic", href: `/play/${m.category}` },
        topicMark(m.category),
        h("span", null, topicName(m.category)),
      )
    : h("span", { class: "mastery-topic" }, topicMark(m.category), h("span", null, topicName(m.category)));
  // Still being found out: one line, the topic and its first estimate, or what's left before one.
  if (!m.sure)
    return h(
      "li",
      { class: `mastery-row ${toneOf(m.category)}` },
      h(
        "div",
        { class: "mastery-head" },
        topic,
        h("span", { class: "mastery-meta" }, extra, m.first ? firstWords(m) : masteryLeft(m)),
      ),
    );
  return h(
    "li",
    { class: `mastery-row ${toneOf(m.category)}` },
    h("div", { class: "mastery-head" }, topic, masteryBadge(m)),
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
 * rows of „още 9 въпроса“ say nothing). Said to the player, each row a way to play its topic; or (another's) about
 * them. */
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
          played.map((m) => row(m, null, !theirs)),
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

/** How a topic's game moved its mastery, in a line: the move the server picked as news (play.masteryTold: a first
 * estimate, or a tier reached; never a loss), never one of its own. The topic, how much of it is known now, and the
 * tier it reached („нова степен“); before its mark is sure, a first estimate of what share of the topic it is, never a
 * tier. */
export function masteryLine(move: MasteryMove | undefined): Child {
  if (!move) return null;
  const { from, to } = move;
  if (!to.sure && !to.first) return null;
  return h(
    "p",
    { class: `mastery-line ${toneOf(to.category)}` },
    topicMark(to.category),
    h("span", { class: "mastery-topic" }, topicName(to.category)),
    to.sure
      ? [
          h("b", { class: "mastery-known" }, `${to.known}%`),
          !from.sure || to.tier > from.tier ? h("span", { class: "delta up" }, "нова степен") : null,
          masteryBadge(to),
        ]
      : [
          h("span", { class: "muted" }, "Първа оценка: знаеш около"),
          h("b", { class: "mastery-known" }, `${to.known}%`),
          h("span", { class: "muted" }, "от темата"),
        ],
  );
}

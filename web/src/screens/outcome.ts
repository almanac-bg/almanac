// A duel's result, the most dramatic moment in the game, for every way a duel ends (against a friend, or against a
// recording): the two face to face with their scores, the winner in full ink and the other quieter; the duel question
// by question, the two rows of marks aligned, the question that decided it, and on a tie what broke it; then (a second
// page on a big screen) the record between the two and what to do next. One that lapsed says so. The first time it
// shows, it lands as a moment (feel.ts: duel), never again.
//
// It loads on its own, with its style (outcome.css) and the game's feel, the first time a duel's result shows (kit.ts:
// duelResult; asked for as a duel starts, so it's in by its end), and is handed the app's pieces: it imports only types.

import type { Reviewed } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { SoundName } from "../lib/sound.ts";
import type { DuelMark, DuelView, Side } from "./duel.ts";

// The app's pieces, set as a result is drawn (outcome).
let {
  api,
  avatar,
  feelKit,
  formatNumber,
  h,
  hands,
  landing,
  nameWords,
  nextSteps,
  ordinal,
  play,
  profileHref,
  record,
  reviewParts,
  topics,
  recordingName,
  trail,
  tieWords,
  withWord,
  worn,
} = {} as Kit;

/** How many questions a duel has. */
const total = 10;

/** Seconds, the Bulgarian way: „34,5 с“. */
const secs = (ms: number) =>
  `${(ms / 1000).toLocaleString("bg", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}\u00a0с`;

/** What to do next, where the screen that shows a result has its own: the gold button, and plain ones beside it. */
export interface Steps {
  main: Child;
  also?: Child[];
}

/** A duel as it ended (`d`, as one duel's view has it); what to do next (`again`: a rematch, another duel; else the
 * way back to Приятели); and what the game earned (`more`). */
export function outcome(kit: Kit, d: DuelView, again: Child | Steps, more: Child): Child {
  ({
    api,
    avatar,
    feelKit,
    formatNumber,
    h,
    hands,
    landing,
    nameWords,
    nextSteps,
    ordinal,
    play,
    profileHref,
    record,
    reviewParts,
    topics,
    recordingName,
    trail,
    tieWords,
    withWord,
    worn,
  } = kit);
  const steps = again && typeof again === "object" && "main" in again ? again : null;
  const next = steps ? steps.main : (again as Child);
  const questions =
    d.runId && d.you?.done
      ? reviewParts(async () => (await api<{ questions: Reviewed[] }>("GET", `/api/runs/${d.runId}/review`)).questions)
      : null;
  const head = d.state === "expired" ? plain(d) : hero(d);
  // Two sides on a big screen (DESIGN.md, a spread): the result on the left; what to do next, what it meant and what
  // the game earned on the right. One column on a phone, in that order: the next duel in sight under the result.
  return h(
    "section",
    { class: "screen duel-result spread" },
    h("div", { class: "duel-main page-1" }, head),
    h(
      "div",
      { class: "duel-side page-2" },
      // The gold button is another duel where there's one, else the way back to Приятели; the rest are plain, side by
      // side.
      nextSteps(
        next ?? toDuels(true),
        steps ? [questions?.button, ...(steps.also ?? [])] : [questions?.button, next ? toDuels(false) : null],
      ),
      d.state === "expired" ? null : meant(d),
      more,
    ),
    questions?.list,
  );
}

/** „Дуел с Мария“, or a recording as it was chosen and whose: „По-силен запис · Краси“. */
function kicker(d: DuelView): string {
  if (d.recorded) return `${recordingName(d.level)} · ${d.opponent?.name ?? ""}`;
  const them = d.opponent?.name;
  return them ? `Дуел ${withWord(them)}` : "Дуел";
}

const headings: Record<DuelView["state"], string> = {
  yours: "Твой ред",
  theirs: "Чака се",
  won: "Победа",
  lost: "Загуба",
  draw: "Равенство",
  expired: "Дуелът изтече",
};

/** A duel with a result: the card that holds it, landing once as a moment. */
function hero(d: DuelView): Child {
  const you = d.you as Side;
  const them = d.opponent;
  const mine = you?.marks ?? [];
  const theirs = them?.marks ?? [];
  const card = h(
    "section",
    { class: `card hero duel-end s-${d.state}`, "aria-labelledby": "duel-verdict" },
    h(
      "div",
      { class: "duel-head" },
      h("p", { class: "kicker" }, kicker(d)),
      h("h1", { class: "duel-verdict", id: "duel-verdict" }, headings[d.state]),
    ),
    h(
      "div",
      { class: "duel-faces" },
      face(you, "Ти", "", d.state === "won"),
      h("span", { class: "duel-colon", "aria-hidden": "true" }, ":"),
      them ? face(them, them.name, them.tag ?? "", d.state === "lost" && !them.gone) : h("div", { class: "duel-face" }),
    ),
    marks(d, mine, theirs),
    h("p", { class: "duel-line" }, line(d)),
  ) as HTMLElement;
  land(card, d, mine, theirs);
  return card;
}

/** One side, face to face: the avatar with the seal they wear on its corner (the name keeps the narrow column's
 * width), the name (a way to their profile), and the score;
 * the winner's in gold. Never the score of a player gone since, whose game went with them. */
function face(s: Side, label: string, tag: string, won: boolean): Child {
  const look = s.look ?? {};
  return h(
    "div",
    { class: won ? "duel-face win" : "duel-face" },
    h("span", { class: "duel-avatar" }, avatar(look.avatar, { size: "l", name: s.name }), worn(look.seal)),
    tag
      ? h("a", { class: "duel-name", href: profileHref(tag) }, nameWords(label))
      : h("strong", { class: "duel-name" }, nameWords(label)),
    s.gone
      ? [h("b", { class: "duel-score none" }, "–"), h("span", { class: "duel-rights" }, "Играчът вече го няма")]
      : [
          h("b", { class: "duel-score", "data-n": s.rights }, formatNumber(s.rights)),
          h("span", { class: "duel-rights" }, `от\u00a0${total}`),
        ],
  );
}

/** The duel question by question: the player's marks over the other's, aligned (right filled, близо half filled,
 * wrong hollow), and a band behind the question that decided it. Speed only breaks a tie (line), so no mark says who
 * was quicker; gold is the mark's alone. */
function marks(d: DuelView, mine: DuelMark[], theirs: DuelMark[]): Child {
  const words = (m: DuelMark) =>
    m.right ? `вярно за ${secs(m.ms)}` : m.close ? "близо" : m.missed ? "без отговор" : "грешно";
  const them = d.opponent?.name ?? "съперникът";
  const pip = (m: DuelMark | undefined, row: number, i: number) =>
    h("span", {
      class: ["duel-pip", m && (m.right ? "right" : m.close ? "partial" : "wrong")].filter(Boolean).join(" "),
      style: { "grid-row": String(row), "grid-column": String(i + 2) },
      title: m ? `${i + 1}: ${words(m)}` : null,
    });
  const rights = (list: DuelMark[]) => list.filter((m) => m.right).length;
  const rightWords = (n: number) => `${n} ${n === 1 ? "верен" : "верни"} от ${total}`;
  const label = [
    `Въпрос по въпрос. Ти: ${rightWords(rights(mine))}`,
    theirs.length ? `; ${them}: ${rightWords(rights(theirs))}` : "",
    d.decided ? `; ${d.state === "won" ? "ти" : them} водеше от ${ordinal(d.decided)}я въпрос до края` : "",
  ].join("");
  // Small beside the marks: the avatar alone, without its frame.
  const bare = (s?: Side) => s?.look?.avatar?.split("/")[0];
  const you = { avatar: bare(d.you) };
  const other = { avatar: bare(d.opponent) };
  return h(
    "div",
    { class: "duel-marks", role: "img", "aria-label": label },
    d.decided && d.decided > 1
      ? h("span", { class: "duel-band", style: { "grid-row": "1 / span 2", "grid-column": String(d.decided + 1) } })
      : null,
    h("span", { class: "duel-who", style: { "grid-row": "1", "grid-column": "1" } }, avatar(you.avatar, { size: "s" })),
    Array.from({ length: total }, (_, i) => pip(mine[i], 1, i)),
    h(
      "span",
      { class: "duel-who", style: { "grid-row": "2", "grid-column": "1" } },
      avatar(other.avatar, { size: "s", name: d.opponent?.name }),
    ),
    Array.from({ length: total }, (_, i) => pip(theirs[i], 2, i)),
  );
}

/** What decided the duel: on even right answers, and only then, what broke the tie as on the day's board
 * (play.duelScore, tieWords): the number nearer, or the time (a second apart or more: closer is a draw,
 * play.TieBand); else the question from which the winner led to the end. */
function line(d: DuelView): string {
  const them = d.opponent?.name ?? "Съперникът";
  if (d.opponent?.gone) return ""; // their game went with them: nothing to set the player's against
  const tie = tieWords(d);
  if (tie) return `${tie.charAt(0).toUpperCase()}${tie.slice(1)}.`;
  if (!d.decided) return "";
  if (d.decided >= total) return "Реши го последният въпрос.";
  const from = d.decided === 1 ? "първия" : `${ordinal(d.decided)}я`;
  return d.state === "won" ? `Водеше от ${from} въпрос до края.` : `${them} водеше от ${from} въпрос до края.`;
}

/** What the duel meant: the record against this person, or, against a recording, whose game it was. */
function meant(d: DuelView): Child {
  const rec = d.record;
  const them = d.opponent?.name ?? "";
  const topic = d.topic ? topics.find((t) => t.id === d.topic)?.name : "";
  return h(
    "div",
    { class: "duel-meant" },
    d.recorded && d.opponent
      ? h("p", { class: "duel-why" }, `Записът е от истинска игра на ${them}${topic ? ` в глава „${topic}“` : ""}.`)
      : null,
    rec && them && rec.won + rec.lost + rec.drawn > 0
      ? h(
          "p",
          { class: "duel-record" },
          h("span", null, `Срещу ${them} досега:`),
          h(
            "span",
            { class: "duel-record-end" },
            h(
              "b",
              { class: "duel-record-n", "aria-label": record(rec.won, rec.lost, rec.drawn) },
              `${rec.won}:${rec.lost}`,
            ),
            rec.drawn
              ? h("span", { class: "duel-why" }, `и ${rec.drawn} ${rec.drawn === 1 ? "равенство" : "равенства"}`)
              : null,
          ),
        )
      : null,
  );
}

/** A duel without a result: who didn't play it in time (or, from before, that it was cut off), and the player's own
 * game if they played it. */
function plain(d: DuelView): Child {
  const you = d.you;
  const them = d.opponent?.name ?? "Приятелят ти";
  const why =
    d.lapsed === "they"
      ? `${them} не изигра дуела в срок от седем дни.`
      : d.lapsed === "you"
        ? "Не изигра дуела в срок от седем дни."
        : "Без резултат: дуелът беше прекъснат.";
  return [
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, kicker(d)),
      h("h1", null, headings[d.state]),
      h("p", { class: "lead" }, why),
    ),
    you?.done
      ? h(
          "div",
          { class: "card duel-mine" },
          h("p", { class: "kicker" }, "Твоята игра"),
          h(
            "p",
            { class: "duel-mine-score" },
            h("b", { class: "duel-mine-n" }, formatNumber(you.rights)),
            ` от\u00a0${total}`,
          ),
          trail(you.marks ?? [], total),
        )
      : null,
  ];
}

const toDuels = (main: boolean) =>
  h("a", { class: main ? "btn primary big" : "btn", href: "/friends" }, "Към Приятели");

/** Where the results already landed are kept, on this device: a duel's lands once, never again on a reload or a visit
 * back. */
const landedKey = "almanac.duelsLanded";

function firstTime(key: string): boolean {
  try {
    const seen: string[] = JSON.parse(localStorage.getItem(landedKey) ?? "[]");
    if (seen.includes(key)) return false;
    localStorage.setItem(landedKey, JSON.stringify([...seen, key].slice(-40)));
  } catch {
    // Storage refused (a private window): it lands each time, the lesser loss.
  }
  return true;
}

/** The result as a moment, the first time it shows (feel.ts: duel); without the feel, its sound alone. The game's
 * big news waits for it to land. */
function land(card: HTMLElement, d: DuelView, mine: DuelMark[], theirs: DuelMark[]): void {
  if (!firstTime(`${d.id}:${d.state}`)) return;
  const end: SoundName = d.state === "won" ? "win" : d.state === "lost" ? "lose" : "end";
  const feel = feelKit();
  if (!feel) {
    play(end);
    return;
  }
  const moment = new Promise<void>((done) =>
    requestAnimationFrame(() =>
      feel
        .duel(
          card,
          {
            mine: mine.map((m) => (m.right ? 1 : 0)),
            theirs: theirs.map((m) => (m.right ? 1 : 0)),
            end,
            decided: d.decided ?? 0,
          },
          hands(),
        )
        .then(done),
    ),
  );
  if (d.runId) landing(d.runId, moment);
}

// A duel as a card, and the cards as Приятели's „Дуели“ lists them (friends.ts). The card is all there is of a duel
// (DECISIONS.md: no page of its result): its kind, the two face to face with how it stands between them, how each
// question went for each side (two rows of ten small squares, as the boards draw them), one quiet line where there's
// more to say; and, once the player's own game is played, a tap anywhere on it opens its questions in their dialog
// (results.ts, reviewSheet), on any day (play.Review). A new duel starts from „Нов дуел“ under the cards, never from a
// card. Several sent to the player by one friend are one card, a pile, the next to lapse on top. The duel just played,
// or named by an old link to it (`top`), comes first in its own group (a result first of the played, one sent first of
// those waiting for a friend), in sight, and its score counts up once as it lands (feel.ts: duel), never again.
//
// It's Приятели's, loaded with it, and is handed the app's pieces: it imports only types.

import type { Reviewed } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { SoundName } from "../lib/sound.ts";
import type { Look } from "../ui.ts";
import type { DuelMark, Duels, DuelView, Side } from "./duel.ts";

// The app's pieces, set as the cards are drawn (duelCards).
let { api, avatar, feelKit, formatNumber, h, hands, leftWords, mini, nameWords, play, reviewSheet, withWord } =
  {} as Kit;

/** How many questions a duel has. */
const total = 10;

/** How many played duels the server lists (play.DuelsShown): with that many, the list says they're the last. */
const playedShown = 10;

/** A duel as its card shows it: a player gone since shows as nobody's, a plain tile without an animal (no avatar of
 * theirs, nor one drawn from a name that isn't theirs). */
const shown = (d: DuelView): DuelView =>
  d.opponent?.gone ? { ...d, opponent: { ...d.opponent, look: { avatar: "gone" } } } : d;

/** Small beside a row of marks: the avatar alone, without its seal. */
const bare = (s?: Side) => s?.look?.avatar?.split("/")[0];

/** A duel that has a result. */
const ended = (d: DuelView) => d.state === "won" || d.state === "lost" || d.state === "draw";

/** What broke a tie on even right answers (DuelView.tieBy), as a duel's card says it: „Равен брой верни · реши
 * по-близкото число“, the only thing that breaks one (time never counts: even in both, it's „Равенство“, with nothing
 * more to say); "" for a duel won on right answers, a draw, or none ended. */
function tieWords(d: DuelView): string {
  if (d.state !== "won" && d.state !== "lost") return "";
  return d.tieBy === "number" ? "Равен брой верни · реши по-близкото число" : "";
}

/** What a duel's card says on one quiet line under its two sides; "" for nothing to say. An open one: that the
 * player's own game is begun and not finished, how many more the same friend sent under it (a pile: `more`), or their
 * score while the other has the same ten to play. A played one: why one that ran out has no score (and the player's
 * own, if they played), that a player is gone (their game went with them), and what broke a tie on even right
 * answers. The pair's record is said once, on the friend (Приятели), not on each duel. */
function noteLine(d: DuelView, more: number): string {
  const them = d.opponent;
  const mine = `Ти: ${formatNumber(d.you?.rights ?? 0)} от ${total}`;
  if (more) return more === 1 ? "Още един дуел чака." : `Още ${formatNumber(more)} дуела чакат.`;
  if (d.state === "yours") return d.first ? "Довърши своята игра." : "";
  if (d.state === "theirs") return mine;
  if (d.state === "expired") {
    if (d.lapsed === "they") return `${them?.name ?? "Приятелят"} не го изигра навреме. ${mine}.`;
    if (d.lapsed === "you") return "Не го изигра навреме.";
    return "Без резултат.";
  }
  if (them?.gone) return "Играчът вече го няма.";
  return tieWords(d);
}

/** One side of a duel's card: the avatar with its seal, the name under it (the player's own: „Ти“). */
const cardSide = (name: string, look: Look, plainName: string): Child =>
  h(
    "span",
    { class: "duel-card-side" },
    avatar(look.avatar, { name: plainName, seal: look.seal }),
    h("span", { class: "duel-card-name" }, nameWords(name)),
  );

/** What stands between a card's two sides: an open duel's turn („Твой ред“, „Чакаш“) over how long is left; a played
 * one's score, a heavy numeral („8:6“: each side's a number of its own, for the landing to count up), over its end as
 * a chip, told apart at a glance: a win filled in ink with its ✓ (right is ink, filled), a loss outlined and quiet
 * (never red: a loss isn't punished), a draw outlined in ink; one that ran out, „Изтече“ alone. */
function cardMiddle(d: DuelView): Child {
  if (d.state === "yours" || d.state === "theirs")
    return [
      h("strong", { class: "duel-card-state" }, d.state === "yours" ? "Твой ред" : "Чакаш"),
      h("span", { class: "duel-card-left" }, leftWords(d.until ?? 0)),
    ];
  if (d.state === "expired") return h("strong", { class: "duel-card-state" }, "Изтече");
  const score = (n: number) => h("span", { class: "duel-score", "data-n": n }, formatNumber(n));
  return [
    d.opponent?.gone
      ? null
      : h("b", { class: "duel-card-score" }, score(d.you?.rights ?? 0), ":", score(d.opponent?.rights ?? 0)),
    h(
      "strong",
      { class: `duel-chip ${d.state}` },
      d.state === "won" ? "✓ Победа" : d.state === "lost" ? "Загуба" : "Равенство",
    ),
  ];
}

/** The duel question by question: the player's row of marks over the other's, each ten small squares in ink as the
 * boards draw them (ui.ts, mini: right filled, близо half, wrong hollow), whose it is before it (the small avatar; in
 * words for a screen reader). A row only of a game played to its end: the player's own while the friend still has
 * theirs to play, or where the duel ran out; none of a player gone since. Time never counts, so no mark says how long
 * an answer took or who was quicker. */
function marksRows(d: DuelView): Child {
  const row = (s: Side | undefined, label: string) => {
    const marks = s?.marks ?? [];
    if (!s?.done || !marks.length || s.gone) return null;
    // A game that ended short of its ten (its time up half-way): what wasn't answered wasn't right.
    const ten: DuelMark[] = Array.from({ length: total }, (_, i) => marks[i] ?? { right: false });
    return h(
      "span",
      { class: "duel-card-row" },
      avatar(bare(s), { size: "s", name: s.name }),
      h("span", { class: "sr" }, `${label}: `),
      mini(ten),
    );
  };
  const rows = [row(d.you, "Ти"), ended(d) ? row(d.opponent, d.opponent?.name ?? "Съперникът") : null].filter(Boolean);
  return rows.length ? h("span", { class: "duel-card-marks" }, rows) : null;
}

/** Whose questions a duel's dialog goes over, under its heading: who it's with, and its score. */
function sheetOf(d: DuelView): string {
  const them = d.opponent?.name ?? "";
  const whose = d.recorded ? `Срещу запис на ${them}` : `Дуел ${withWord(them)}`;
  return ended(d) && !d.opponent?.gone
    ? `${whose} · ${formatNumber(d.you?.rights ?? 0)}:${formatNumber(d.opponent?.rights ?? 0)}`
    : whose;
}

/** A duel's questions in the game's one dialog for them („Въпросите“: results.ts, reviewSheet), on any day: each
 * question, how it went for the two side by side, the answers and the fact. */
function questions(d: DuelView): void {
  reviewSheet({
    load: () => api<{ questions: Reviewed[] }>("GET", `/api/runs/${d.runId}/review`).then((r) => r.questions),
    of: sheetOf(d),
    versus: {
      mine: bare(d.you),
      theirs: bare(d.opponent),
      name: d.opponent?.name ?? "Съперникът",
      // Nothing of a duel that ran out, nor of a player gone since: the player's own game alone.
      marks: !ended(d) || d.opponent?.gone ? [] : (d.opponent?.marks ?? []),
    },
  });
}

/** A duel as a card: its kind at the top („С приятел“, „Срещу запис“), then the two face to face, the player on the
 * left, with how it stands between them (cardMiddle), the duel question by question (marksRows), and what more there
 * is to say on one quiet line (noteLine). Once the player's own game in it is played, the whole card is a button to its
 * questions (their dialog), nothing on it to say so but its light under a pointer; a screen reader hears what it
 * opens first, then what it says. A duel to play is one link to its game, the whole of it (`play`: the first waiting
 * for the player, with „Играй“, the page's one action, in it); any other is neither, and no name in it is a way to a
 * profile, so none looks like one. `more`: how many more from the same friend lie under it, a pile (the sheets'
 * edges under the card, the count on its line). `top`: the duel named in the address, shown in sight, its result
 * landing as a moment, once. */
function duelCard(d: DuelView, play = false, more = 0, top = false): Child {
  const them = d.opponent;
  const note = noteLine(d, more);
  const body = [
    h("span", { class: "duel-card-kind" }, d.recorded ? "Срещу запис" : "С приятел"),
    h(
      "span",
      { class: "duel-card-sides" },
      cardSide("Ти", d.you?.look ?? {}, d.you?.name ?? ""),
      h("span", { class: "duel-card-mid" }, cardMiddle(d)),
      cardSide(them?.name ?? "Съперник", them?.look ?? {}, them?.name ?? ""),
    ),
    marksRows(d),
    note ? h("span", { class: "duel-card-note" }, note) : null,
  ];
  const cls = `duel-card s-${d.state}${play ? " turn" : ""}${top ? " landed" : ""}`;
  const item = (card: HTMLElement) => {
    if (top) shownNamed(card, d);
    return h("li", more ? { class: "duel-pile", "data-more": Math.min(more, 2) } : null, card);
  };
  if (d.state === "yours")
    return item(
      h(
        "a",
        { class: cls, href: `/duel/${d.id}`, id: `duel-${d.id}` },
        body,
        play ? h("span", { class: "btn primary duel-card-go" }, "Играй") : null,
      ) as HTMLElement,
    );
  // Named by its first words, for a screen reader alone, then by all it says: an aria-label in their place would hide
  // the duel itself, and say none of the words on the card (by which voice control calls a button).
  const whose = d.recorded ? `срещу запис на ${them?.name ?? ""}` : withWord(them?.name ?? "");
  const card = (
    d.you?.done && d.runId
      ? h(
          "button",
          {
            class: cls,
            id: `duel-${d.id}`,
            type: "button",
            "aria-haspopup": "dialog",
            onclick: () => questions(d),
          },
          h("span", { class: "sr" }, `Въпросите от дуела ${whose}. `),
          body,
        )
      : h("div", { class: cls, id: `duel-${d.id}` }, body)
  ) as HTMLElement;
  return item(card);
}

/** Whether the duel named in the address was brought into sight on this visit to the page (duelCards' `sight`): once,
 * as the page opens, never as the lists are drawn anew under the player. */
let sighted: { done: boolean } = { done: true };

/** The duel named in the address, as its card is drawn: brought into sight once (a result may be under those
 * waiting, out of a phone's screen), then its result landing (land). */
function shownNamed(card: HTMLElement, d: DuelView): void {
  const sight = sighted;
  requestAnimationFrame(() => {
    if (!card.isConnected) return;
    if (!sight.done) {
      sight.done = true;
      const r = card.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight * 0.8) card.scrollIntoView({ block: "center" });
    }
    land(card, d);
  });
}

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

/** A duel's result as a moment, the first time its card shows at the top (feel.ts: duel: the marks fill pair by
 * pair, the score counts up with them, then the chip lands with the end's sound); without the feel, its sound alone.
 * A duel still waiting for the friend has no result to land. */
function land(card: HTMLElement, d: DuelView): void {
  if (!ended(d) || !firstTime(`${d.id}:${d.state}`)) return;
  const end: SoundName = d.state === "won" ? "win" : d.state === "lost" ? "lose" : "end";
  const feel = feelKit();
  if (!feel) {
    play(end);
    return;
  }
  const rights = (s?: Side) => (s?.marks ?? []).map((m) => (m.right ? 1 : 0));
  void feel.duel(card, { mine: rights(d.you), theirs: rights(d.opponent), end }, hands());
}

/** Who sent a duel to the player, for a pile: one friend's challenges, the same card again and again, are one. None
 * for any other (the player's own unfinished, one they sent, a recording, a player gone): each is a card of its own. */
const sender = (d: DuelView): string | null =>
  d.state === "yours" && !d.first && !d.recorded && d.opponent && !d.opponent.gone
    ? `${d.opponent.tag ?? ""}\u0000${d.opponent.name}`
    : null;

/** Open duels as their cards lie: one friend's challenges in one pile, where its first one was, the rest each alone. */
function piles(list: DuelView[]): [DuelView, ...DuelView[]][] {
  const out: [DuelView, ...DuelView[]][] = [];
  const by = new Map<string, DuelView[]>();
  for (const d of list) {
    const key = sender(d);
    const pile = key ? by.get(key) : undefined;
    if (pile) {
      pile.push(d);
      continue;
    }
    const fresh: [DuelView, ...DuelView[]] = [d];
    if (key) by.set(key, fresh);
    out.push(fresh);
  }
  return out;
}

/** The player's duels in Приятели, in two groups. The open ones („Чакащи“): first theirs to play (one friend's in a
 * pile; the first with the page's one action, „Играй“), then those waiting for a friend, each card saying whose turn it
 * is. Then those played, the last ten, which the heading says once there are that many. The one named in the address
 * (`top`: just played, or an old link to it) is first in its own: a result first of the played, one sent first of
 * those waiting for a friend, one to play on top of the open; what its game brought under it (`under`: game/news.ts),
 * its result landing once, brought into sight once a visit (`sight`: one object for the visit, marked done). */
export function duelCards(
  kit: Kit,
  d: Duels,
  top: DuelView | null,
  under: Child = null,
  sight: { done: boolean } = { done: true },
): Child {
  ({ api, avatar, feelKit, formatNumber, h, hands, leftWords, mini, nameWords, play, reviewSheet, withWord } = kit);
  sighted = sight;
  const rest = (v: DuelView) => v.id !== top?.id;
  const named = top && shown(top);
  const first = (state: (v: DuelView) => boolean, list: DuelView[]) =>
    named && state(named) ? [named, ...list.filter(rest).map(shown)] : list.filter(rest).map(shown);
  const open = piles([...first((v) => v.state === "yours", d.yours), ...first((v) => v.state === "theirs", d.theirs)]);
  const played = first((v) => v.state !== "yours" && v.state !== "theirs", d.played);
  const card = (v: DuelView, play = false, more = 0) => {
    if (v.id !== named?.id) return duelCard(v, play, more);
    return [duelCard(v, play, more, true), under ? h("li", { class: "duel-news" }, under) : null];
  };
  // Each group under its kicker, the groups well apart: the open ones never run on into the played.
  const group = (heading: string, cards: Child[]) =>
    h(
      "section",
      { class: "stack small-gap" },
      h("h2", { class: "section-title" }, heading),
      h("ul", { class: "duel-cards" }, cards),
    );
  return h(
    "div",
    { class: "duel-groups" },
    open.length
      ? group(
          "Чакащи",
          open.map(([o, ...more], i) => card(o, i === 0 && o.state === "yours", more.length)),
        )
      : null,
    played.length
      ? group(
          d.played.length >= playedShown ? `Последните ${playedShown} изиграни` : "Изиграни",
          played.map((p) => card(p)),
        )
      : null,
  );
}

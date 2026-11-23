// A duel as a card, and the cards as Приятели lists them (friends.ts). The card is all there is of a duel
// (DECISIONS.md: no page of its result): the two face to face (no name a link: a profile opens from the friends'
// list, owner, 2026-11-22) with how it stands between them, how each question went for each side (two rows of ten small squares, as the
// boards draw them), one quiet line where there's more to say; theirs to play, „Играй“, the card's one way to its game
// (the card itself leads nowhere); and, once the player's own game is played, a tap anywhere on it but a name opens its
// questions in their dialog (results.ts, reviewSheet), on any day (play.Review). A new duel starts from a friend's row
// (or their profile), never from a card. Every duel the player has to play is in one stack (owner, 2026-11-22), in the
// order they were challenged: the first on top, its „Играй“ the way in, the rest under it as the edges of sheets
// (no list of them: one is played at a time, the next comes up). The duel just played, or named by an old
// link to it (`top`), comes first in its own group (a result first of the played, one sent first of those waiting for a
// friend), in sight, and its score counts up once as it lands (feel.ts: duel), never again.
//
// It's Приятели's, loaded with it, and is handed the app's pieces: it imports only types.

import type { Reviewed } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { SoundName } from "../lib/sound.ts";
import type { Look } from "../ui.ts";
import type { DuelMark, Duels, DuelView, PlayedPage, Side } from "./duel.ts";

// The app's pieces, set as the cards are drawn (duelGroup).
let {
  api,
  avatar,
  errorText,
  feelKit,
  formatNumber,
  h,
  hands,
  leftWords,
  mini,
  nameWords,
  play,
  reviewSheet,
  signal,
  withWord,
} = {} as Kit;

/** How many questions a duel has. */
const total = 10;

/** How many played duels the server lists (play.DuelsShown): with that many, the list says they're the last. */
const playedShown = 10;

/** A duel as its card shows it: a player gone since shows as nobody's, a plain tile without an animal (no avatar of
 * theirs, nor one drawn from a name that isn't theirs). */
const shown = (d: DuelView): DuelView =>
  d.opponent?.gone ? { ...d, opponent: { ...d.opponent, look: { avatar: "gone" } } } : d;

/** Small beside a row of marks: the avatar's shape. */
const bare = (s?: Side) => s?.look?.avatar?.split("/")[0];

/** A duel that has a result. */
const ended = (d: DuelView) => d.state === "won" || d.state === "lost" || d.state === "draw";

/** What broke a tie on even right answers (DuelView.tieBy), as a duel's card says it: „Равен брой верни · реши
 * по-близкото число“, the only thing that breaks one (time never counts: even in both, it's „Равенство“, with nothing
 * more to say); "" for a duel won on right answers, a draw, or none ended. */
function tieWords(d: DuelView): string {
  if (d.state !== "won" && d.state !== "lost") return "";
  return d.tieBy === "number" ? "Равен брой верни · реши по-близкото число" : "";
}

/** What a duel's card says on one quiet line under its two sides; "" for nothing to say. An open one: that the
 * player's own game is begun and not finished, or their score while the other has the same ten to play. A played one:
 * why one that ran out has no score (and the player's own, if they played), that a player is gone (their game went
 * with them), and what broke a tie on even right answers. The pair's record is said once, on the friend (Приятели),
 * not on each duel. */
function noteLine(d: DuelView): string {
  const them = d.opponent;
  const mine = `Ти: ${formatNumber(d.you?.rights ?? 0)} от ${total}`;
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

/** One side of a duel's card: the avatar, the name under it (the player's own: „Ти“); never a link. */
const cardSide = (name: string, look: Look, plainName: string): Child =>
  h(
    "span",
    { class: "duel-card-side" },
    avatar(look.avatar, { name: plainName }),
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
  const whose = `Дуел ${withWord(d.opponent?.name ?? "")}`;
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

/** „Играй“, a link to a duel's game (`first`: the page's one action, filled; else outlined). */
const playLink = (d: DuelView, first: boolean): Child =>
  h(
    "a",
    {
      class: `btn${first ? " primary" : ""} duel-card-go`,
      href: `/duel/${d.id}`,
      "aria-label": `Играй дуела ${withWord(d.opponent?.name ?? "")}`,
    },
    "Играй",
  );

/** A duel as a card: the two face to face, the player on the left (no name a link), with how it stands
 * between them (cardMiddle), the duel question by question (marksRows), and what more there is to say on one quiet
 * line (noteLine). Theirs to play, „Играй“ at its foot, the card's one way to its game (`play`: the first, filled; the
 * card itself leads nowhere). Once the player's own game in it is played, a button laid over the whole card opens its
 * questions, nothing on it to say so but its light under a pointer. `stack`: the duels to play
 * (all of them, it the first), the edges of sheets under the card. `top`: the duel named in the address, shown in sight, its result landing as a moment, once. */
function duelCard(d: DuelView, play = false, stack: DuelView[] = [], top = false): Child {
  const them = d.opponent;
  const note = noteLine(d);
  const card = h(
    "div",
    { class: `duel-card s-${d.state}${play ? " turn" : ""}${top ? " landed" : ""}`, id: `duel-${d.id}` },
    h(
      "span",
      { class: "duel-card-sides" },
      cardSide("Ти", d.you?.look ?? {}, d.you?.name ?? ""),
      h("span", { class: "duel-card-mid" }, cardMiddle(d)),
      cardSide(them?.name ?? "Съперник", them?.look ?? {}, them?.name ?? ""),
    ),
    marksRows(d),
    note ? h("span", { class: "duel-card-note" }, note) : null,
    d.state === "yours" ? playLink(d, play) : null,
    d.state !== "yours" && d.you?.done && d.runId
      ? h(
          "button",
          { class: "duel-card-open", type: "button", "aria-haspopup": "dialog", onclick: () => questions(d) },
          h("span", { class: "sr" }, `Въпросите от дуела ${withWord(them?.name ?? "")}`),
        )
      : null,
  ) as HTMLElement;
  if (top) shownNamed(card, d);
  const more = stack.length - 1;
  return h("li", more > 0 ? { class: "duel-pile", "data-more": Math.min(more, 2) } : null, card);
}

/** Every duel the player has played, in a dialog over the page, a page of ten at a time (play.DuelsPlayed), the latest
 * first, each a card as Приятели has it; under them „По-нови“ and „По-стари“ either side of where the page is
 * („Страница 2 от 4“), each off at its end. */
function allPlayed(): void {
  const page = signal<PlayedPage | null>(null);
  const error = signal("");
  const load = async (n: number) => {
    error.set("");
    try {
      page.set(await api<PlayedPage>("GET", `/api/duels/played?page=${n}`));
      list?.scrollTo({ top: 0 });
    } catch (err) {
      error.set(errorText(err));
    }
  };
  let list: HTMLElement | undefined;
  const go = (step: number) => () => {
    const p = page.peek();
    if (p) void load(p.page + step);
  };
  const box = h(
    "dialog",
    { class: "sheet duels-all", "aria-labelledby": "duels-all-title" },
    h(
      "div",
      {
        class: "sheet-panel",
        ref: (el) => {
          list = el as HTMLElement;
        },
      },
      h(
        "div",
        { class: "sheet-head" },
        h("h2", { id: "duels-all-title" }, "Завършени дуели"),
        h("button", { class: "link", type: "button", onclick: () => box.close() }, "Затвори"),
      ),
      () => {
        const p = page();
        if (!p) return error() ? h("p", { class: "bad", role: "alert" }, error()) : h("p", { class: "muted" }, "…");
        return [
          h(
            "ul",
            { class: "duel-cards" },
            p.duels.map((v) => duelCard(shown(v))),
          ),
          error() ? h("p", { class: "bad", role: "alert" }, error()) : null,
          p.pages > 1
            ? h(
                "nav",
                { class: "pages", "aria-label": "Страници" },
                h("button", { class: "btn inline", type: "button", disabled: p.page <= 1, onclick: go(-1) }, "По-нови"),
                h(
                  "span",
                  { class: "pages-at" },
                  `Страница ${formatNumber(p.page)}\u00a0от\u00a0${formatNumber(p.pages)}`,
                ),
                h(
                  "button",
                  { class: "btn inline", type: "button", disabled: p.page >= p.pages, onclick: go(1) },
                  "По-стари",
                ),
              )
            : null,
        ];
      },
    ),
  ) as HTMLDialogElement;
  box.addEventListener("click", (e) => {
    if (e.target === box) box.close();
  });
  box.addEventListener("close", () => box.remove());
  document.body.append(box);
  box.showModal();
  void load(1);
}

/** Whether the duel named in the address was brought into sight on this visit to the page (duelGroup's `sight`): once,
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

/** One of the player's two groups of duels in Приятели (`which`), under its heading, or nothing while it's empty. The
 * open ones („Чакащи дуели (N)“, at the page's top: a duel to play stays first there until it's played): the duels to
 * play, all in one stack, in the order they were challenged (the first on top, its „Играй“ the page's one action),
 * then those waiting for a friend, each card saying whose turn it is. Those played („Завършени дуели“, under the
 * friends), the last ten, which the heading says once there are that many. The one named in the address (`top`: just
 * played, or an old link to it) is first in its own: a result first of the played, one sent first of those waiting
 * for a friend; what its game brought under it (`under`: game/news.ts), its result landing once, brought into sight
 * once a visit (`sight`: one object for the visit, marked done). */
export function duelGroup(
  kit: Kit,
  which: "open" | "played",
  d: Duels,
  top: DuelView | null,
  under: Child = null,
  sight: { done: boolean } = { done: true },
): Child {
  ({
    api,
    avatar,
    errorText,
    feelKit,
    formatNumber,
    h,
    hands,
    leftWords,
    mini,
    nameWords,
    play,
    reviewSheet,
    signal,
    withWord,
  } = kit);
  sighted = sight;
  const rest = (v: DuelView) => v.id !== top?.id;
  const named = top && shown(top);
  const first = (state: (v: DuelView) => boolean, list: DuelView[]) =>
    named && state(named) ? [named, ...list.filter(rest).map(shown)] : list.filter(rest).map(shown);
  const news = (v: DuelView) => (v.id === named?.id && under ? h("li", { class: "duel-news" }, under) : null);
  const card = (v: DuelView, play = false, stack: DuelView[] = []) => [
    duelCard(v, play, stack, v.id === named?.id),
    news(v),
  ];
  const group = (heading: string, cards: Child[], after: Child = null) =>
    h(
      "section",
      { class: `sect duels-${which}` },
      h("div", { class: "sect-head" }, h("h2", null, heading)),
      h("ul", { class: "duel-cards" }, cards),
      after,
    );
  if (which === "open") {
    // The duels to play, in the order they were challenged: the first sent (or begun) first, the first to lapse.
    const toPlay = first((v) => v.state === "yours", d.yours).sort((a, b) => (a.until ?? 0) - (b.until ?? 0));
    // One the player sent and the friend hasn't played is theirs to do, not the player's: not listed (owner,
    // 2026-11-22: it only muddled the list), but for the one just played, as it lands, once (its score, sent).
    const waiting = named?.state === "theirs" ? [named] : [];
    const [head] = toPlay;
    const cards = [head ? card(head, true, toPlay) : null, ...waiting.map((v) => card(v))];
    return toPlay.length || waiting.length
      ? group(`Чакащи дуели (${formatNumber(toPlay.length + waiting.length)})`, cards)
      : null;
  }
  const played = first((v) => v.state !== "yours" && v.state !== "theirs", d.played);
  // More played than listed: a way to all of them, under the last, in a dialog a page at a time.
  const more =
    d.playedAll > d.played.length
      ? h(
          "button",
          { class: "btn duels-all-open", type: "button", "aria-haspopup": "dialog", onclick: allPlayed },
          `Всички завършени дуели (${formatNumber(d.playedAll)})`,
        )
      : null;
  return played.length
    ? group(
        d.played.length >= playedShown ? `Последните ${playedShown} завършени дуела` : "Завършени дуели",
        played.map((p) => card(p)),
        more,
      )
    : null;
}

// The end of a game: how it went, then what to do next (another game, the questions to go over with their answers),
// laid out the same on every result screen. The questions gone over are one dialog for every game (reviewSheet): the
// day's issue, a chapter's game, a duel.

import { petal } from "../art/pictures.ts";
import * as feel from "../feel.ts";
import { api, errorText } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { calm } from "../lib/prefs.ts";
import { play } from "../lib/sound.ts";
import { avatar, chapterName, chip, fact, type Look, leaf, sheet, tiles, who } from "../ui.ts";
import { type FriendDay, fewFriends, friendsLine, groupWords, markAt, shortName } from "./knew.ts";
import { closeLine, closeWords } from "./numbers.ts";
import { answered, crowdLine, picture } from "./questions.ts";
import { report } from "./report.ts";
import { trail } from "./run.ts";
import type { Answer, Reviewed, Score, State, TheirMark, View } from "./types.ts";

/** A finished run: the score as the screen's big number (its right answers), a line about it (the place), and the
 * marks; right under it what to do next (`next`: the gold action, then „Прегледай въпросите“ and the others, as
 * buttons, or with `quiet` as plain links in a line); then whatever the screen adds (`more`: what the game earned).
 * The questions open in their dialog (reviewSheet): by the button, by a tap on the score's card, and by a tile, at its
 * question. A chapter's game (`chapter`) is a spread on a big screen, as the day's result is: its sheet on the left
 * page, the ways on and what it wrote on the right. */
export function summary(
  s: State,
  line: Child,
  next: { main: Child; also?: Child[]; quiet?: boolean },
  more: Child[] = [],
  moment = true,
  chapter = "",
): Child {
  let asked: Promise<Reviewed[]> | null = null;
  const load = () => {
    asked ??= api<{ questions: Reviewed[] }>("GET", `/api/runs/${s.id}/review`).then((r) => r.questions);
    // One that failed is asked again when the dialog next opens.
    asked.catch(() => {
      asked = null;
    });
    return asked;
  };
  const of = `${chapter ? `${chapterName(chapter)} · ` : ""}${s.rights} от ${outOf(s)}`;
  const open = (at?: number) => reviewSheet({ load, of, at });
  const button = h(
    "button",
    { class: "btn", type: "button", "aria-haspopup": "dialog", onclick: () => open() },
    "Прегледай въпросите",
  );
  const perfect = outOf(s) > 0 && s.rights === outOf(s);
  const hero = chapter ? chapterCard(s, chapter, open) : scoreCard(s, line);
  opensReview(hero, open);
  if (moment) land(hero, s.id, perfect, s.kind === "day");
  const steps = next.quiet
    ? [h("div", { class: "actions" }, next.main), quietSteps([button, ...(next.also ?? [])])]
    : nextSteps(next.main, [button, ...(next.also ?? [])]);
  if (chapter) {
    hero.classList.add("page-1");
    return h("section", { class: "summary spread" }, hero, h("div", { class: "page-2 stack" }, steps, more));
  }
  return h("section", { class: "summary" }, hero, steps, more);
}

/** A result's card opens the game's questions: a tap anywhere on it but on a control of its own (a tile opens them at
 * its question: ui.ts, tiles; a link on the card is its own). The way by keys is the button beside it, „Прегледай
 * въпросите“, and each tile. */
export function opensReview(card: HTMLElement, open: () => void): void {
  card.classList.add("opens");
  card.addEventListener("click", (e) => {
    if (!(e.target as Element).closest("a, button")) open();
  });
}

/** A finished game's score, as its result has it: the right answers big (the close ones beside them), a line about
 * it, and the marks. */
export function scoreCard(s: State, line: Child) {
  const perfect = outOf(s) > 0 && s.rights === outOf(s);
  return h(
    "div",
    { class: "card hero" },
    // Ten of ten: the mark drawn large beside the score, and the words.
    perfect ? perfectHead() : null,
    h(
      "div",
      { class: "score-row" },
      h(
        "h1",
        { class: "score" },
        h("b", { class: "score-n" }, String(s.rights)),
        h(
          "span",
          { class: "score-of" },
          h("span", { class: "num-word" }, "от "),
          String(outOf(s)),
          h("span", { class: "num-word" }, closeWords(s.trail)),
        ),
      ),
    ),
    line,
    trail(s.trail, s.total),
  );
}

/** A chapter's game, as its result has it: on the chapter's sheet, its chip (the glyph and the name), the right
 * answers big, and the tiles in its colour, each a way to its question gone over (`open`). */
export function chapterCard(s: State, chapter: string, open?: (at: number) => void): HTMLElement {
  const perfect = outOf(s) > 0 && s.rights === outOf(s);
  return leaf(
    chapter,
    [
      perfect ? perfectHead() : null,
      h("div", { class: "score-kicker" }, chip(chapter)),
      h(
        "h1",
        { class: "score" },
        h("b", { class: "score-n" }, String(s.rights)),
        h("span", { class: "score-of" }, `от ${outOf(s)}`),
        closeLine(s.trail) ? h("span", { class: "score-close" }, closeLine(s.trail)) : null,
      ),
      tiles(
        s.trail,
        Array.from({ length: s.total }, () => chapter),
        s.total,
        "Как мина играта",
        open,
      ),
    ],
    "result-score score-leaf chapter-score",
  );
}

/** How many questions a game's right answers are out of: all but those that count for nobody (Mark.void). */
const outOf = (s: State) => s.total - (s.void ?? 0);

/** What the game's feel (feel.ts) needs of the app, as it is now. */
export const hands = () => ({ calm: calm.peek(), play, format: (n: number) => String(n) });

/** Each game's result moment, while it plays: what waits for it to land (the streak rolling on). */
const moments = new Map<number, Promise<void>>();

/** When a game's result has landed: at once if it had no moment. */
export const landed = (run: number): Promise<void> => moments.get(run) ?? Promise.resolve();

/** A game's result as a moment as it ends (feel.ts: the pips, the score, the motif), once: never again on its way
 * back to the screen; the day's pips a little slower. */
export function land(hero: HTMLElement, run: number, perfect: boolean, day: boolean): void {
  const key = `almanac.landed.${run}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // no storage: the moment plays, as it would the first time
  }
  moments.set(
    run,
    new Promise((done) => requestAnimationFrame(() => feel.result(hero, perfect, hands(), day ? 85 : 60).then(done))),
  );
}

/** Ten of ten, the result's one big moment besides a rank risen: the game's mark drawn large beside the score (feel.ts
 * draws it in petal by petal as the result lands), „Всички верни“ under it. */
export function perfectHead(): HTMLElement {
  return h("div", { class: "perfect" }, perfectMark(), h("p", { class: "kicker perfect-words" }, "Всички верни"));
}

/** The logo's rosette: four petals, the gold one last, on the sheet in its ink in both themes. */
function perfectMark(): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", "perfect-mark");
  svg.setAttribute("aria-hidden", "true");
  for (const turn of [45, 135, 225, -45]) {
    // Turned by its group, so the petal itself is free to grow (feel.ts) about the centre.
    const group = document.createElementNS(ns, "g");
    group.setAttribute("transform", `rotate(${turn} 32 32)`);
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", petal);
    path.setAttribute("class", turn < 0 ? "petal gold" : "petal");
    path.style.transformOrigin = "32px 32px";
    group.append(path);
    svg.append(group);
  }
  return svg;
}

/** The ways on after a game's one action, as quiet links in a line (a button among them drawn as a link). */
function quietSteps(ways: Child[]): Child {
  for (const w of ways) if (w instanceof HTMLElement && w.classList.contains("btn")) w.className = "link tap";
  return h("p", { class: "result-links" }, ways);
}

/** What to do after a game, right under its result: the one gold action, then the others, plain and the same size,
 * side by side where they fit. */
export function nextSteps(main: Child, others: Child[]): Child {
  const rest = others.filter(Boolean);
  return h("div", { class: "actions" }, main, rest.length ? h("div", { class: "result-actions" }, rest) : null);
}

/** What a game's questions gone over are of, and how they open. */
export interface ReviewOf {
  /** The game's questions, asked for as the dialog opens. */
  load: () => Promise<Reviewed[]>;
  /** Whose questions they are, under the heading: the issue and its score, the chapter, a duel's two. */
  of: string;
  /** A duel's two sides: each question says how it went for both. */
  versus?: Versus;
  /** The day's issue: how the player's friends who finished it did, asked for as the dialog opens (play.FriendsOn);
   * each question says it under how Bulgaria did. Without them (none came), the questions as they are. */
  friends?: () => Promise<FriendDay[]>;
  /** The question to open at (its place, from 0), marked for a moment: the tile tapped. */
  at?: number;
}

/** A game's questions gone over, the one dialog for every game (the day's issue, a chapter's game, a duel), on the
 * game's sheet over the page: „Въпросите“ and „Затвори“ at its head, which stays as the list scrolls under it, whose
 * they are under it, then each question with its answers (the player's and the right one; in a duel how it went for
 * the other side too) and its fact (reviewed). Opened at a question (`at`), that one is at the top and tinted in its
 * chapter's colour for a moment (app.css, .lit). Esc, „Затвори“ or a tap beside it puts it away. */
export function reviewSheet(o: ReviewOf): void {
  const all = signal<Reviewed[] | null>(null);
  let friends: FriendDay[] = [];
  const error = signal("");
  const box = sheet({ class: "review-sheet", title: "Въпросите" }, () => [
    h("p", { class: "muted review-of" }, o.of),
    () => {
      const list = all();
      if (list) return reviewed(list, o.versus, friends);
      return error() ? h("p", { class: "bad", role: "alert" }, error()) : h("p", { class: "muted" }, "…");
    },
  ]);
  // The friends with the questions, drawn once (nothing moves under the player's eye); questions without them if they
  // didn't come.
  Promise.all([o.load(), o.friends?.().catch(() => []) ?? []]).then(
    ([list, theirs]) => {
      friends = theirs;
      all.set(list);
      if (o.at === undefined) return;
      // Once the list is drawn: the question asked for right under the head, and marked. The list alone is moved
      // (scrollIntoView would move the sheet in its dialog too, off its place).
      requestAnimationFrame(() => {
        const q = box.querySelector<HTMLElement>(`[data-n="${o.at}"]`);
        const [panel, head] = [box.querySelector(".sheet-panel"), box.querySelector(".sheet-head")];
        if (!q || !panel || !head) return;
        panel.scrollTop += q.getBoundingClientRect().top - head.getBoundingClientRect().bottom - 8;
        q.classList.add("lit");
      });
    },
    (err) => error.set(errorText(err)),
  );
}

/** A duel's two sides, for its questions gone over (reviewSheet): each one's avatar, the other's name, and how each
 * question went for the other (none: a duel that ran out, a player gone since). */
export interface Versus {
  mine?: string;
  theirs?: string;
  name: string;
  marks: TheirMark[];
}

/** How a question went: its sign where it stands alone, and its word. Right is „Точно“, wrong „Грешно“, as the tiles'
 * marks say it; neither reads as a true-or-not statement's answer („Вярно“, „Невярно“). */
const verdicts = {
  void: ["–", "Не се брои"],
  right: ["✓", "Точно"],
  close: ["◩", "Близо"],
  wrong: ["✕", "Грешно"],
  missed: ["–", "Без отговор"],
} as const;

type Verdict = keyof typeof verdicts;

/** A verdict's word on a question (`view`), as the run says it (verdictSays): a number right but not spot on (near
 * enough to count) is „Вярно“, never „Точно“, which it isn't, and a number's „Вярно“ never meets true-or-not's answer.
 * Spot on is as the server has it (bank.Number.Exact: within half a step of the number `value`), known only of the
 * player's own answer (`given`); a friend's right number is „Вярно“, true either way. */
export function verdictWord(kind: Verdict, view: View, given?: Answer | null, value?: number): string {
  if (kind !== "right" || view.type !== "number") return verdicts[kind][1];
  const exact = !!given && "value" in given && Math.abs(given.value - (value ?? Number.NaN)) <= view.step / 2 + 1e-9;
  return exact ? verdicts.right[1] : "Вярно";
}

/** One side of a duel on one question: whose (the avatar; the name for a screen reader) and how it went. */
function side(name: string, look: string | undefined, kind: Verdict, word: string): Child {
  const sign = verdicts[kind][0];
  return h(
    "span",
    { class: kind === "right" ? "duel-q-side right" : "duel-q-side" },
    avatar(look, { size: "s", name }),
    h("span", { class: "sr" }, `${name}: `),
    h("span", { class: "duel-q-sign", "aria-hidden": "true" }, sign),
    word,
  );
}

/** A game's questions gone over: each a card with its number and chapter and how it went, the question, the answers
 * as they were given with the right one, how others answered, the fact behind it, and a word about the question if
 * something's wrong with it. A duel's (`versus`): how it went for the two side by side under the question, in place of
 * the one word. */
function reviewed(all: Reviewed[], versus?: Versus, friends: FriendDay[] = []): Child {
  return h(
    "section",
    { class: "review" },
    all.map((it) => {
      const kind = it.void ? "void" : it.right ? "right" : it.close ? "close" : it.given ? "wrong" : "missed";
      const word = verdictWord(kind, it.view, it.given, it.reveal.value);
      const theirs = versus?.marks[it.n];
      const theirKind =
        theirs && (theirs.right ? "right" : theirs.close ? "close" : theirs.missed ? "missed" : "wrong");
      // Each fact a note of its own name among the ten („Знаеше ли? Въпрос 3“): ten of one name tell a screen reader
      // nothing apart.
      const note = fact(it.reveal.fact, it.reveal.day);
      if (note instanceof HTMLElement)
        note.setAttribute("aria-label", `${note.getAttribute("aria-label")} Въпрос ${it.n + 1}`);
      return h(
        "article",
        { class: `reviewed ${kind === "missed" ? "wrong" : kind} ch-${it.chapter}`, "data-n": it.n },
        // Its number and its chapter's chip (the glyph and the name: wherever a chapter is, its glyph is), and how
        // it went with its sign, as a duel's sides say it.
        h(
          "p",
          { class: "reviewed-head" },
          h("span", { class: "reviewed-at" }, h("span", { class: "reviewed-n" }, String(it.n + 1)), chip(it.chapter)),
          versus
            ? null
            : h(
                "span",
                { class: kind === "right" ? "reviewed-says right" : "reviewed-says" },
                h("span", { class: "duel-q-sign", "aria-hidden": "true" }, verdicts[kind][0]),
                word,
              ),
        ),
        h("h3", { class: "ask" }, it.view.text),
        versus
          ? h(
              "p",
              { class: "duel-q-sides" },
              side("Ти", versus.mine, kind, word),
              theirKind ? side(versus.name, versus.theirs, theirKind, verdictWord(theirKind, it.view)) : null,
            )
          : null,
        picture(it.view),
        answered(it.view, it.reveal, it.given, it.right ? "right" : it.close ? "partial" : "wrong"),
        crowdLine(it.view.type, it.reveal.crowd, it.right),
        friendsOn(friends, it.n, it.view),
        note,
        report(it.reveal.id),
      );
    }),
  );
}

/** How the player's friends who finished the day did with its question `n`, under how Bulgaria did (knew.ts says
 * the words): a line, then up to four friends each by name, their sign beside it, right in ink and the rest quieter
 * as a duel's sides are; more, and two rows, those who got it and those who didn't, each a few faces and names, which
 * opens to its whole list. Nothing for a question that counts for nobody, or with no friend finished. */
function friendsOn(friends: FriendDay[], n: number, view: View): Child {
  const played = friends.filter((f) => f.marks.length > n && markAt(f, n) !== "void");
  if (!played.length) return null;
  const knew = played.filter((f) => markAt(f, n) === "right");
  const line = friendsLine(
    knew.map((f) => f.name),
    played.length,
  );
  return h(
    "div",
    { class: "friends-on" },
    line ? h("p", { class: "crowd-says" }, line) : null,
    played.length <= fewFriends
      ? h(
          "p",
          { class: "duel-q-sides friends-few" },
          played.map((f) => {
            const kind = markAt(f, n) as "right" | "close" | "wrong";
            const [sign, word] = [verdicts[kind][0], verdictWord(kind, view)];
            return h(
              "span",
              { class: kind === "right" ? "duel-q-side right" : "duel-q-side" },
              avatar(f.avatar, { size: "s", name: f.name }),
              h("span", { class: "duel-q-sign", "aria-hidden": "true" }, sign),
              shortName(f.name),
              h("span", { class: "sr" }, `: ${word}`),
            );
          }),
        )
      : [
          friendsGroup(knew, true, n),
          friendsGroup(
            played.filter((f) => markAt(f, n) !== "right"),
            false,
            n,
          ),
        ],
  );
}

/** One of a question's two rows of many friends: those who got it (`knew`) or those who didn't, best first. A button:
 * up to five faces one over another, the sign, the first names and how many more; a tap opens the whole list under
 * it, each friend's face and full name (a „близо“ with its sign). */
function friendsGroup(list: FriendDay[], knew: boolean, n: number): Child {
  if (!list.length) return null;
  const open = signal(false);
  const id = `friends-${n}-${knew ? "knew" : "not"}`;
  return h(
    "div",
    { class: "friends-group" },
    h(
      "button",
      {
        class: knew ? "friends-row right" : "friends-row",
        type: "button",
        "aria-expanded": () => open(),
        "aria-controls": id,
        onclick: () => open.set(!open.peek()),
      },
      h(
        "span",
        { class: "friends-faces", "aria-hidden": "true" },
        list.slice(0, 5).map((f) => avatar(f.avatar, { size: "s", name: f.name })),
      ),
      h("span", { class: "duel-q-sign", "aria-hidden": "true" }, knew ? "✓" : "✕"),
      h("span", { class: "sr" }, knew ? "Познаха: " : "Не познаха: "),
      h("span", { class: "friends-names" }, groupWords(list.map((f) => f.name))),

      h("span", { class: "i i-right friends-more", "aria-hidden": "true" }),
    ),
    h(
      "ul",
      { class: knew ? "friends-list right" : "friends-list", id, hidden: () => !open() },
      list.map((f) => {
        const close = markAt(f, n) === "close";
        return h(
          "li",
          { class: "friends-chip" },
          avatar(f.avatar, { size: "s", name: f.name }),
          close ? h("span", { class: "duel-q-sign", "aria-hidden": "true" }, verdicts.close[0]) : null,
          f.name,
          close ? h("span", { class: "sr" }, `: ${verdicts.close[1]}`) : null,
        );
      }),
    ),
  );
}

/** One row of a board: the place (gold, silver, bronze for the first three), the player with their look, the
 * score. */
export function boardRow(
  place: number,
  name: string,
  score: Child,
  opts: { me?: boolean; gap?: boolean; look?: Look; tag?: string } = {},
) {
  const cls = ["row", place <= 3 && `p${place}`, opts.me && "me", opts.gap && "gap"].filter(Boolean).join(" ");
  return h(
    "li",
    { class: cls },
    h("span", { class: "place" }, String(place)),
    who(name, opts.look, opts.me ? h("span", { class: "you" }, "ти") : null, name, opts.tag),
    h("span", { class: "rights" }, score),
  );
}

/** A row's score, as its place is decided: the right answers (a tie is broken by the server: play/board.go). */
const scoreOf = (s: Score) => [String(s.rights), h("small", { class: "sub" }, ` от ${s.of}`)];

/** A board of results: the best, and the viewer among them. */
export function board(title: string, scores: Score[], place?: number, mine?: Score): Child {
  const rows = [...scores];
  return h(
    "section",
    { class: "board" },
    h("h2", null, title),
    h(
      "ol",
      null,
      rows.map((s, i) => boardRow(i + 1, s.name, scoreOf(s), { me: s.me, look: s, tag: s.tag })),
      place && mine && !rows.some((s) => s.me)
        ? boardRow(place, mine.name, scoreOf(mine), {
            me: true,
            gap: place > rows.length + 1,
            look: mine,
            tag: mine.tag,
          })
        : null,
    ),
  );
}

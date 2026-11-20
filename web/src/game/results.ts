// The end of a game: how it went, then what to do next (another game, the questions to go over with their answers),
// laid out the same on every result screen.

import { api, errorText } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { calm } from "../lib/prefs.ts";
import { feelKit, play } from "../lib/sound.ts";
import { categories } from "../state.ts";
import { countUp, explain, fact, formatNumber, type Look, meaning, who } from "../ui.ts";
import { closeWords } from "./numbers.ts";
import { answered, crowdLine, picture } from "./questions.ts";
import { report } from "./report.ts";
import { trail } from "./run.ts";
import type { Reviewed, Score, State } from "./types.ts";

/** A finished run: the score as the screen's big number, its points, a line about it (the place), and the marks;
 * right under it what to do next (`next`: the gold action, then „Прегледай въпросите“ and the others); then
 * whatever the screen adds (`more`: what the game earned); and at the end, once opened, the questions. `words` say
 * what its points are (the day's say the day's board too). */
export function summary(
  s: State,
  line: Child,
  next: { main: Child; also?: Child[] },
  more: Child[] = [],
  words = meaning.points,
  moment = true,
): Child {
  const questions = reviewParts(
    async () => (await api<{ questions: Reviewed[] }>("GET", `/api/runs/${s.id}/review`)).questions,
  );
  const perfect = outOf(s) > 0 && s.rights === outOf(s);
  const hero = scoreCard(s, line, words, moment ? formatNumber(s.points) : countUp(s.points));
  if (moment) land(hero, s.id, perfect, s.kind === "day");
  return h(
    "section",
    { class: "summary" },
    hero,
    nextSteps(next.main, [questions.button, ...(next.also ?? [])]),
    more,
    questions.list,
  );
}

/** A finished game's score, as its result has it: the right answers big, its points (`points`: as they're drawn),
 * a line about it, and the marks. */
export function scoreCard(s: State, line: Child, words = meaning.points, points: Child = formatNumber(s.points)) {
  const perfect = outOf(s) > 0 && s.rights === outOf(s);
  return h(
    "div",
    { class: "card hero" },
    // Ten of ten: the logo's rosette as a seal, and the words.
    perfect ? h("div", { class: "perfect-head" }, seal(), h("p", { class: "kicker" }, "Всички верни")) : null,
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
      h(
        "p",
        { class: "points" },
        h("b", { class: "points-n", "data-n": s.points }, points),
        // What points are, a tap away: the game's score, not what playing earns (XP) or strength (the rating).
        explain(h("span", { class: "points-label" }, s.points === 1 ? "точка" : "точки"), words),
        s.allRight ? h("span", { class: "points-bonus" }, `+${formatNumber(s.allRight)} за всички верни`) : null,
      ),
    ),
    line,
    trail(s.trail, s.total),
  );
}

/** How many questions a game's right answers are out of: all but those that count for nobody (Mark.void). */
const outOf = (s: State) => s.total - (s.void ?? 0);

/** What the game's feel (feel.ts) needs of the app, as it is now. */
export const hands = () => ({ calm: calm.peek(), play, format: (n: number) => formatNumber(n) });

/** Each game's result moment, while it plays: what waits for it to land (the sheet for big news). */
const moments = new Map<number, Promise<void>>();

/** When a game's result has landed: at once if it had no moment. */
export const landed = (run: number): Promise<void> => moments.get(run) ?? Promise.resolve();

/** A game's result landing as a moment drawn elsewhere (a duel's: screens/outcome.ts), for its news to wait for. */
export const landing = (run: number, moment: Promise<void>): void => void moments.set(run, moment);

/** A game's result as a moment as it ends (feel.ts: the pips, the score, the motif), once: never again on its way
 * back to the screen; the day's pips a little slower. Without the feel loaded, the result is as it is, with the end's
 * sound. */
function land(hero: HTMLElement, run: number, perfect: boolean, day: boolean): void {
  const key = `almanac.landed.${run}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // no storage: the moment plays, as it would the first time
  }
  const kit = feelKit();
  if (!kit) {
    play(perfect ? "perfect" : "end");
    return;
  }
  moments.set(
    run,
    new Promise((done) => requestAnimationFrame(() => kit.result(hero, perfect, hands(), day ? 85 : 60).then(done))),
  );
}

/** The logo's rosette as a seal: four petals, the gold one last. */
function seal(): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", "seal");
  svg.setAttribute("aria-hidden", "true");
  for (const turn of [45, 135, 225, -45]) {
    // Turned by its group, so the petal itself is free to grow (feel.ts) about the centre.
    const group = document.createElementNS(ns, "g");
    group.setAttribute("transform", `rotate(${turn} 32 32)`);
    const petal = document.createElementNS(ns, "path");
    petal.setAttribute("d", "M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z");
    petal.style.fill = turn < 0 ? "var(--gold)" : "var(--lilac)";
    petal.style.transformOrigin = "32px 32px";
    group.append(petal);
    svg.append(group);
  }
  return svg;
}

/** What to do after a game, right under its result: the one gold action, then the others, plain and the same size,
 * side by side where they fit. */
export function nextSteps(main: Child, others: Child[]): Child {
  const rest = others.filter(Boolean);
  return h("div", { class: "actions" }, main, rest.length ? h("div", { class: "result-actions" }, rest) : null);
}

/** Going over a game, once it's over: each question, the answer, what was given, the fact behind it, and a word
 * about the question if something's wrong with it. In two parts: the button, kept with the other ways on under the result, and
 * the list it opens, kept for the end of the screen; the button takes the player there. */
export function reviewParts(load: () => Promise<Reviewed[]>): { button: Child; list: Child; opened: () => boolean } {
  const items = signal<Reviewed[] | null>(null);
  const error = signal("");
  let heading: HTMLElement | null = null;
  const show = () => {
    if (!heading?.isConnected) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start", behavior: calm.peek() ? "auto" : "smooth" });
  };
  const open = async () => {
    if (items.peek()) return show();
    try {
      items.set(await load());
      error.set("");
      requestAnimationFrame(show);
    } catch (err) {
      error.set(errorText(err));
    }
  };
  const button = h("button", { class: "btn", type: "button", onclick: open }, "Прегледай въпросите");
  const list = () => {
    const all = items();
    if (!all) return error() ? h("p", { class: "bad", role: "alert" }, error()) : null;
    heading = h("h2", { class: "section-title review-head", tabindex: -1 }, "Въпросите");
    return reviewed(all, heading);
  };
  return { button, list, opened: () => items() !== null };
}

/** A game's questions gone over, under their heading: each with the answer, what was given, how others answered,
 * the fact behind it, and a word about the question if something's wrong with it. */
export function reviewed(all: Reviewed[], heading: Child): Child {
  return h(
    "section",
    { class: "review" },
    heading,
    all.map((it) => {
      const [kind, word] = it.void
        ? ["void", "Не се брои"]
        : it.right
          ? ["right", "Вярно"]
          : it.points > 0
            ? ["close", "Близо"]
            : it.given
              ? ["wrong", "Грешно"]
              : ["wrong", "Без отговор"];
      return h(
        "article",
        { class: `reviewed ${kind}` },
        h(
          "p",
          { class: "reviewed-head" },
          h("span", { class: "kicker" }, `${it.n + 1} · ${categories.find((c) => c.id === it.category)?.name ?? ""}`),
          h(
            "span",
            { class: "reviewed-says" },
            it.points > 0 ? `${word} · ${formatNumber(it.points)} ${it.points === 1 ? "точка" : "точки"}` : word,
          ),
        ),
        h("h3", { class: "ask" }, it.view.text),
        picture(it.view),
        answered(it.view, it.reveal, it.given),
        crowdLine(it.view.type, it.reveal.crowd, it.right),
        fact(it.reveal.fact, it.reveal.day),
        report(it.reveal.id),
      );
    }),
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
    h("span", { class: "pts" }, score),
  );
}

/** A row's score, as its place is decided: the right answers big, the points that break a tie small under them. */
const scoreOf = (s: Score) => [
  String(s.rights),
  h("small", { class: "sub" }, ` от ${s.of}`),
  h("small", { class: "sub pts-under" }, `${formatNumber(s.points)} ${s.points === 1 ? "точка" : "точки"}`),
];

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

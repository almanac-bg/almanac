// app.js holds what a daily visit uses: Начало, a game, the screens a game leads to. A screen a daily visit doesn't
// open loads on its own, the first time it's opened: a duel's result (outcome.ts), only for those who play there; and
// Профил's places, the boards and the
// friends (me, settings, avatar, almanac, board, friends, player). Each is handed the app's
// pieces it uses from here, and imports nothing of the app but types: a module it imported would be one app.js
// imports too, and esbuild would split every such module into a shared file that each page then loads first
// (cmd/build fails if there is one). What only such a screen uses (lib/hash.ts, the boards') it imports itself. So a
// release that doesn't change such a screen leaves its file as it was, cached; and app.js stays small, within the
// first screen's budget (cmd/build).

import { picture as illustration } from "./art/picture.ts";
import { recover } from "./fresh.ts";
import { answering } from "./game/answering.ts";
import { news } from "./game/news.ts";
import { count } from "./game/numbers.ts";
import { answered, crowdLine, picture } from "./game/questions.ts";
import {
  board,
  boardRow,
  hands,
  landing,
  nextSteps,
  reviewed,
  reviewParts,
  scoreCard,
  summary,
} from "./game/results.ts";
import { guardLeaving, questionHead, readyClock, startScreen, timer, trail, upNext } from "./game/run.ts";
import { ApiError, api, errorText } from "./lib/api.ts";
import { dayInBulgaria } from "./lib/day.ts";
import {
  type Child,
  computed,
  effect,
  h,
  lifetime,
  listen,
  onCleanup,
  signal,
  slot,
  untracked,
  when,
} from "./lib/dom.ts";
import { reportProblem } from "./lib/errors.ts";
import { ordinal } from "./lib/ordinal.ts";
import { calm, setCalm, setTextSize, setTick, textSize, tickOn } from "./lib/prefs.ts";
import { needsHomeScreen, pushable, pushOn, pushPrefs, setPushPref, turnOff, turnOn } from "./lib/push.ts";
import { byTap, go, goBack, rename, title } from "./lib/router.ts";
import { feelKit, loadFeel, play, playAnswer, playCount, quietWhenSilent, setSound, soundOn } from "./lib/sound.ts";
import { dateWords, issueWords, listWords, searchWords, weekday, withWord } from "./lib/words.ts";
import { acceptedLine, type DuelView, duelLists, recordingName, startDuel, tieWords } from "./screens/duel.ts";
import { keepGame, mailAsk } from "./screens/keep.ts";
import { missing } from "./screens/missing.ts";
import { nameFirst } from "./screens/name.ts";
import type { Steps } from "./screens/outcome.ts";
import { noEmail, noEmailLine, signIn } from "./screens/signin.ts";
import { loadStats } from "./screens/stats.ts";
import { rankName, rankNames } from "./seal.ts";
import {
  bulgaria,
  categories,
  checkNews,
  look,
  notice,
  outcomeCss,
  player,
  playingWhile,
  sawFriends,
  setLook,
  topics,
  user,
} from "./state.ts";
import {
  avatar,
  back,
  chapterName,
  chip,
  emailWords,
  explain,
  fact,
  failure,
  formatNumber,
  glyph,
  inSight,
  leaf,
  mini,
  nameWords,
  pictureCredit,
  playerRow,
  profileHead,
  profileHref,
  questions,
  record,
  rightsOf,
  schemeSwitch,
  scoreRow,
  seal,
  sealsSection,
  segmented,
  shapeNames,
  standing,
  textWords,
  tiles,
  toneOf,
  topicMark,
  verdict,
  who,
} from "./ui.ts";

export const kit = {
  acceptedLine,
  inSight,
  answered,
  answering,
  ApiError,
  api,
  avatar,
  back,
  textSize,
  board,
  boardRow,
  bulgaria,
  byTap,
  chapterName,
  chip,
  calm,
  categories,
  computed,
  count,
  crowdLine,
  dateWords,
  dayInBulgaria,
  duelLists,
  duelResult,
  effect,
  errorText,
  explain,
  fact,
  failure,
  feelKit,
  formatNumber,
  sawFriends,
  checkNews,
  glyph,
  go,
  goBack,
  guardLeaving,
  h,
  hands,
  illustration,
  issueWords,
  keepGame,
  landing,
  leaf,
  lifetime,
  listen,
  listWords,
  nameWords,
  emailWords,
  textWords,
  pictureCredit,
  searchWords,
  loadDuelResult,
  loadStats,
  mailAsk,

  mini,
  missing,
  nameFirst,
  needsHomeScreen,
  news,
  nextSteps,

  notice,
  onCleanup,
  ordinal,
  picture,
  standing,
  play,
  playAnswer,
  playCount,
  player,
  playingWhile,
  profileHead,
  profileHref,
  pushable,
  pushOn,
  pushPrefs,
  questionHead,
  questions,
  quietWhenSilent,
  readyClock,
  rankName,
  rankNames,
  record,
  recordingName,
  tieWords,
  rightsOf,
  rename,
  reportProblem,
  reviewed,
  reviewParts,
  schemeSwitch,
  scoreCard,
  seal,
  sealsSection,
  segmented,
  setTextSize,
  setCalm,
  setPushPref,
  setSound,
  setTick,
  setLook,
  look,
  shapeNames,
  signal,
  signIn,
  noEmail,
  noEmailLine,
  slot,
  soundOn,
  startDuel,
  startScreen,
  summary,
  tickOn,
  tiles,
  timer,
  title,
  toneOf,
  topicMark,
  topics,
  trail,
  turnOff,
  turnOn,
  untracked,
  upNext,
  user,
  verdict,
  weekday,
  when,
  withWord,
  who,
  playerRow,
  scoreRow,
};

export type Kit = typeof kit;

type Outcome = typeof import("./screens/outcome.ts");
let outcome: Promise<Outcome> | null = null;

/** A duel's result (screens/outcome.ts), its style (outcome.css) and the game's feel (its moment), loaded once: asked
 * for as a duel starts, so they're in by its end. A load that failed is tried again by the next. */
export function loadDuelResult(): Promise<Outcome> {
  outcome ??= Promise.all([
    import("./screens/outcome.ts"),
    stylesheet(outcomeCss),
    loadFeel().catch(() => null), // without it the result is whole, only still
  ]).then(
    ([m]) => m,
    (err) => {
      outcome = null;
      throw err;
    },
  );
  return outcome;
}

/** A stylesheet of a screen that loads on its own, once: in when it has loaded (or failed to: the page goes on). */
function stylesheet(href: string): Promise<void> {
  if (!href || document.querySelector(`link[href="/${href}"]`)) return Promise.resolve();
  return new Promise((done) => {
    const link = h("link", { rel: "stylesheet", href: `/${href}` }) as HTMLLinkElement;
    link.addEventListener("load", () => done());
    link.addEventListener("error", () => done());
    document.head.append(link);
  });
}

/** A duel's result as it stands or ended (screens/outcome.ts), drawn once it has loaded: `again` is the gold button
 * where there's another duel to play (else a friend's has a rematch), `more` what the game earned. Should it not load
 * (no line, or a version of the game gone by), the duel's own page has it: loaded as a page, it's whole again. */
export function duelResult(d: DuelView, again: Child | Steps = null, more: Child = null): Child {
  const screen = signal<Outcome | null>(null);
  const failed = signal(false);
  loadDuelResult().then(screen.set, () => failed.set(true));
  return () => {
    const m = screen();
    if (m) return untracked(() => m.outcome(kit, d, again, more));
    return failed()
      ? h(
          "div",
          { class: "stack failure" },
          h("p", { role: "alert" }, "Резултатът не се зареди."),
          h(
            "button",
            { class: "btn primary", type: "button", onclick: () => location.assign(`/duel/${d.id}`) },
            "Виж резултата",
          ),
        )
      : h("p", { class: "muted" }, "…");
  };
}

/** A screen that loads the first time it's opened: a line while it comes, and one if it can't. A file that doesn't
 * come while the server answers is one of a version gone by: the page loads anew for it (fresh.ts). */
export function later(load: () => Promise<(kit: Kit, params: string[]) => Child>): (params: string[]) => Child {
  return (params) => {
    const screen = signal<((kit: Kit, params: string[]) => Child) | null>(null);
    const failed = signal(false);
    load().then(
      (s) => screen.set(s),
      async () => {
        if (!(await recover())) failed.set(true);
      },
    );
    return () => {
      const s = screen();
      if (s) return untracked(() => s(kit, params));
      return failed()
        ? failure(
            new ApiError("offline", "Страницата не се зареди. Провери връзката си с интернет и опитай пак."),
            () => location.reload(),
          )
        : h("p", { class: "muted" }, "…");
    };
  };
}

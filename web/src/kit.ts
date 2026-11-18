// app.js holds what a daily visit uses: Начало, a game, the screens a game leads to. A screen a daily visit doesn't
// open loads on its own, the first time it's opened: the room's (screens/room.ts), Роял's (royal.ts), a live duel's
// (live.ts) and a duel's result (outcome.ts), only for those who play there; and Профил's places, the boards and the
// friends (me, settings, rewards, wardrobe, almanac, year, played, ranks, friends, player). Each is handed the app's
// pieces it uses from here, and imports nothing of the app but types: a module it imported would be one app.js
// imports too, and esbuild would split every such module into a shared file that each page then loads first
// (cmd/build fails if there is one). What only such a screen uses (lib/hash.ts, the boards') it imports itself. So a
// release that doesn't change such a screen leaves its file as it was, cached; and app.js stays small, within the
// first screen's budget (cmd/build).

import { emblem } from "./art/emblem.ts";
import { leagueEmblem } from "./art/league.ts";
import { picture as illustration } from "./art/picture.ts";
import { recover, staying } from "./fresh.ts";
import { answering, answerState, countdown } from "./game/answering.ts";
import { masteryCard } from "./game/mastery.ts";
import { news } from "./game/news.ts";
import { answered, ask, crowdLine, picture } from "./game/questions.ts";
import {
  board,
  boardRow,
  challengeButton,
  challengeText,
  hands,
  landing,
  nextSteps,
  review,
  reviewed,
  reviewParts,
  scoreCard,
  shareButton,
} from "./game/results.ts";
import { guardLeaving, questionHead, readyClock, startScreen, timer, trail, upNext } from "./game/run.ts";
import { count, yearShareText } from "./game/share.ts";
import { ApiError, api, errorText } from "./lib/api.ts";
import { inApp } from "./lib/app.ts";
import { keepAwake } from "./lib/awake.ts";
import { type Child, computed, effect, h, lifetime, onCleanup, signal, slot, untracked, when } from "./lib/dom.ts";
import { reportProblem } from "./lib/errors.ts";
import { ordinal, place } from "./lib/ordinal.ts";
import {
  bigText,
  calm,
  musicOn,
  setBigText,
  setCalm,
  setMusic,
  setTick,
  setVibrate,
  tickOn,
  vibrateOn,
} from "./lib/prefs.ts";
import { needsHomeScreen, pushable, pushOn, pushPrefs, setPushPref, turnOff, turnOn } from "./lib/push.ts";
import { byTap, go, goBack, holdWhile, rename, title } from "./lib/router.ts";
import {
  feelKit,
  liveAudio,
  loadFeel,
  play,
  playAnswer,
  playCount,
  quietWhenSilent,
  setSound,
  soundOn,
} from "./lib/sound.ts";
import { stream } from "./lib/stream.ts";
import { issueWords, listWords, withName } from "./lib/words.ts";
import { dayInBulgaria, yearNow } from "./lib/year.ts";
import type { DuelView } from "./screens/duel.ts";
import { haveProfile } from "./screens/keep.ts";
import { leagueBoard, leagueLine, loadLeague } from "./screens/league.ts";
import { clock, coming, dayAndTime, dayWord, whileSeen } from "./screens/modes.ts";
import { nameFirst } from "./screens/name.ts";
import type { Steps } from "./screens/outcome.ts";
import { loadMistakes } from "./screens/play.ts";
import { loadProgress, nearest } from "./screens/progress.ts";
import { changeGame, mixes } from "./screens/rooms.ts";
import { signIn } from "./screens/signin.ts";
import { stats } from "./screens/stats.ts";
import {
  bulgaria,
  categories,
  friendRequests,
  hostCss,
  notice,
  opened,
  outcomeCss,
  player,
  playingWhile,
  topics,
  user,
} from "./state.ts";
import {
  avatar,
  back,
  badge,
  explain,
  fact,
  failure,
  formatNumber,
  levelNumber,
  meaning,
  meter,
  pageArt,
  profileHref,
  profileNav,
  questions,
  record,
  rewardWords,
  segmented,
  shapeNames,
  standingCard,
  stat,
  tiers,
  tierWords,
  toneNames,
  toneOf,
  topicMark,
  unlockPicture,
  unlockWords,
  until,
  verdict,
  who,
} from "./ui.ts";

export const kit = {
  answered,
  answering,
  answerState,
  api,
  ask,
  avatar,
  back,
  badge,
  bigText,
  board,
  boardRow,
  bulgaria,
  byTap,
  calm,
  categories,
  challengeButton,
  challengeText,
  changeGame,
  clock,
  coming,
  computed,
  count,
  countdown,
  crowdLine,
  dayInBulgaria,
  dayAndTime,
  dayWord,
  duelResult,
  effect,
  emblem,
  errorText,
  explain,
  fact,
  failure,
  feelKit,
  formatNumber,
  friendRequests,
  go,
  goBack,
  guardLeaving,
  h,
  hands,
  haveProfile,
  holdWhile,
  hostCss,
  illustration,
  inApp,
  issueWords,
  keepAwake,
  landing,
  leagueBoard,
  leagueEmblem,
  leagueLine,
  levelNumber,
  lifetime,
  listWords,
  liveAudio,
  loadDuelResult,
  loadLeague,
  loadMistakes,
  loadProgress,
  masteryCard,
  meaning,
  meter,
  mixes,
  musicOn,
  nameFirst,
  nearest,
  needsHomeScreen,
  news,
  nextSteps,
  notice,
  onCleanup,
  opened,
  ordinal,
  pageArt,
  picture,
  place,
  play,
  playAnswer,
  playCount,
  player,
  playingWhile,
  profileHref,
  profileNav,
  pushable,
  pushOn,
  pushPrefs,
  questionHead,
  questions,
  quietWhenSilent,
  readyClock,
  record,
  rename,
  reportProblem,
  review,
  reviewed,
  reviewParts,
  rewardWords,
  scoreCard,
  segmented,
  setBigText,
  setCalm,
  setMusic,
  setPushPref,
  setSound,
  setTick,
  setVibrate,
  shapeNames,
  shareButton,
  signal,
  signIn,
  slot,
  soundOn,
  standingCard,
  startScreen,
  stat,
  stats,
  staying,
  stream,
  tickOn,
  tiers,
  tierWords,
  timer,
  title,
  toneNames,
  toneOf,
  topicMark,
  topics,
  trail,
  turnOff,
  turnOn,
  unlockPicture,
  unlockWords,
  until,
  untracked,
  upNext,
  user,
  verdict,
  vibrateOn,
  when,
  whileSeen,
  who,
  withName,
  yearNow,
  yearShareText,
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
        ? failure(new ApiError("offline", "Страницата не се зареди. Провери интернета си и опитай пак."), () =>
            location.reload(),
          )
        : h("p", { class: "muted" }, "…");
    };
  };
}

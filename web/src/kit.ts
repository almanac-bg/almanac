// A screen that loads on its own, the first time it's opened (the room's, screens/room.ts, Роял's, screens/royal.ts,
// a live duel's, screens/live.ts, and a duel's result, screens/outcome.ts: only those who play there need them), is
// handed the app's pieces it uses from here, and imports nothing of the app but types. A module it
// imported would be one app.js imports too, and esbuild would split every such module into a shared file that each
// page then loads first (cmd/build fails if there is one).

import { emblem } from "./art/emblem.ts";
import { news } from "./game/news.ts";
import { answered, ask, crowdLine, picture } from "./game/questions.ts";
import {
  boardRow,
  challengeButton,
  challengeText,
  hands,
  landing,
  nextSteps,
  review,
  reviewParts,
  shareButton,
} from "./game/results.ts";
import { countdown, guardLeaving, questionHead, readyClock, startScreen, timer, trail, upNext } from "./game/run.ts";
import { api, deliver } from "./lib/api.ts";
import { keepAwake } from "./lib/awake.ts";
import { type Child, computed, effect, h, onCleanup, signal, untracked } from "./lib/dom.ts";
import { ordinal, place } from "./lib/ordinal.ts";
import { musicOn } from "./lib/prefs.ts";
import { pushable, pushOn, turnOn } from "./lib/push.ts";
import { byTap, go, goBack, title } from "./lib/router.ts";
import { feelKit, liveAudio, loadFeel, play, playAnswer, playCount, soundOn } from "./lib/sound.ts";
import { withName } from "./lib/words.ts";
import type { DuelView } from "./screens/duel.ts";
import { clock, coming, dayWord, when } from "./screens/modes.ts";
import type { Steps } from "./screens/outcome.ts";
import { changeGame, mixes } from "./screens/rooms.ts";
import { categories, hostCss, outcomeCss, player, playing, topics, user } from "./state.ts";
import {
  avatar,
  back,
  explain,
  fact,
  formatNumber,
  meaning,
  meter,
  pageArt,
  profileHref,
  record,
  standingCard,
  until,
  verdict,
  who,
} from "./ui.ts";

export const kit = {
  answered,
  api,
  ask,
  avatar,
  back,
  boardRow,
  byTap,
  categories,
  challengeButton,
  challengeText,
  changeGame,
  clock,
  coming,
  dayWord,
  computed,
  countdown,
  crowdLine,
  deliver,
  effect,
  duelResult,
  emblem,
  explain,
  fact,
  feelKit,
  formatNumber,
  go,
  goBack,
  guardLeaving,
  hands,
  hostCss,
  h,
  keepAwake,
  landing,
  liveAudio,
  loadDuelResult,
  meaning,
  meter,
  mixes,
  musicOn,
  news,
  nextSteps,
  onCleanup,
  ordinal,
  pageArt,
  picture,
  place,
  play,
  playAnswer,
  playCount,
  player,
  playing,
  profileHref,
  pushable,
  pushOn,
  questionHead,
  readyClock,
  record,
  review,
  reviewParts,
  shareButton,
  signal,
  soundOn,
  standingCard,
  startScreen,
  timer,
  title,
  topics,
  trail,
  turnOn,
  untracked,
  until,
  upNext,
  user,
  verdict,
  when,
  who,
  withName,
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
 * where there's another duel to play (else a friend's has a rematch), `more` what the game earned. */
export function duelResult(d: DuelView, again: Child | Steps = null, more: Child = null): Child {
  const screen = signal<Outcome | null>(null);
  const failed = signal(false);
  loadDuelResult().then(screen.set, () => failed.set(true));
  return () => {
    const m = screen();
    if (m) return untracked(() => m.outcome(kit, d, again, more));
    return failed()
      ? h("p", { class: "bad", role: "alert" }, "Резултатът не се зареди. Провери връзката и опитай пак.")
      : h("p", { class: "muted" }, "…");
  };
}

/** A screen that loads the first time it's opened: a line while it comes, and one if it can't. */
export function later(load: () => Promise<(kit: Kit, params: string[]) => Child>): (params: string[]) => Child {
  return (params) => {
    const screen = signal<((kit: Kit, params: string[]) => Child) | null>(null);
    const failed = signal(false);
    load().then(
      (s) => screen.set(s),
      () => failed.set(true),
    );
    return () => {
      const s = screen();
      if (s) return untracked(() => s(kit, params));
      return failed()
        ? h("p", { class: "bad", role: "alert" }, "Страницата не се зареди. Провери връзката и опитай пак.")
        : h("p", { class: "muted" }, "…");
    };
  };
}

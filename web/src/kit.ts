// A screen that loads on its own, the first time it's opened (the room's, screens/room.ts, Роял's, screens/royal.ts,
// and a live duel's, screens/live.ts: only those who play there need them), is handed the app's pieces it uses from
// here, and imports nothing of the app but types. A module it
// imported would be one app.js imports too, and esbuild would split every such module into a shared file that each
// page then loads first (cmd/build fails if there is one).

import { emblem } from "./art/emblem.ts";
import { news } from "./game/news.ts";
import { answered, ask, crowdLine, picture } from "./game/questions.ts";
import { boardRow, nextSteps, review, reviewParts, shareButton } from "./game/results.ts";
import { questionHead, timer, trail, upNext } from "./game/run.ts";
import { api } from "./lib/api.ts";
import { keepAwake } from "./lib/awake.ts";
import { type Child, computed, effect, h, onCleanup, signal, untracked } from "./lib/dom.ts";
import { ordinal, place } from "./lib/ordinal.ts";
import { pushable, pushOn, turnOn } from "./lib/push.ts";
import { go, title } from "./lib/router.ts";
import { play, playAnswer, playCount } from "./lib/sound.ts";
import { ended, standingCard } from "./screens/duel.ts";
import { clock, coming, when } from "./screens/modes.ts";
import { mixes } from "./screens/rooms.ts";
import { categories, hostCss, player, playing, topics, user } from "./state.ts";
import { avatar, back, fact, formatNumber, pageArt, verdict, who } from "./ui.ts";

export const kit = {
  answered,
  api,
  ask,
  avatar,
  back,
  boardRow,
  categories,
  clock,
  coming,
  computed,
  crowdLine,
  effect,
  emblem,
  ended,
  fact,
  formatNumber,
  go,
  hostCss,
  h,
  keepAwake,
  mixes,
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
  pushable,
  pushOn,
  questionHead,
  review,
  reviewParts,
  shareButton,
  signal,
  standingCard,
  timer,
  title,
  topics,
  trail,
  turnOn,
  untracked,
  upNext,
  user,
  verdict,
  when,
  who,
};

export type Kit = typeof kit;

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

// A screen that loads on its own, the first time it's opened (the room's, screens/room.ts: only those who play in a
// room need it), is handed the app's pieces it uses from here, and imports nothing of the app but types. A module it
// imported would be one app.js imports too, and esbuild would split every such module into a shared file that each
// page then loads first (cmd/build fails if there is one).

import { news } from "./game/news.ts";
import { answered, ask, crowdLine, picture } from "./game/questions.ts";
import { boardRow, nextSteps, reviewParts, shareButton } from "./game/results.ts";
import { questionHead, timer, upNext } from "./game/run.ts";
import { api } from "./lib/api.ts";
import { keepAwake } from "./lib/awake.ts";
import { type Child, computed, effect, h, onCleanup, signal, untracked } from "./lib/dom.ts";
import { title } from "./lib/router.ts";
import { play, playAnswer } from "./lib/sound.ts";
import { mixes } from "./screens/rooms.ts";
import { categories, player, playing, user } from "./state.ts";
import { avatar, formatNumber, verdict } from "./ui.ts";

export const kit = {
  answered,
  api,
  ask,
  avatar,
  boardRow,
  categories,
  computed,
  crowdLine,
  effect,
  formatNumber,
  h,
  keepAwake,
  mixes,
  news,
  nextSteps,
  onCleanup,
  picture,
  play,
  playAnswer,
  player,
  playing,
  questionHead,
  reviewParts,
  shareButton,
  signal,
  timer,
  title,
  untracked,
  upNext,
  user,
  verdict,
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

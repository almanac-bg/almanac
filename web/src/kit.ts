// app.js holds what a daily visit uses: Днес, a game, the screens a game leads to. A screen a daily visit doesn't
// open loads on its own, the first time it's opened: Профил's places, the Алманах and the
// friends (me, settings, avatar, almanac, friends with its duels' cards, player). Each is handed the app's
// pieces it uses from here, and imports nothing of the app but types: a module it imported would be one app.js
// imports too, and esbuild would split every such module into a shared file that each page then loads first
// (cmd/build fails if there is one). What only such a screen uses (lib/hash.ts, the boards') it imports itself. So a
// release that doesn't change such a screen leaves its file as it was, cached; and app.js stays small, within the
// first screen's budget (cmd/build).

import { recover } from "./fresh.ts";
import { news } from "./game/news.ts";
import { hands, reviewSheet } from "./game/results.ts";
import { shareWordsOut } from "./game/share.ts";
import { ApiError, api, errorText, lastOf, setIfNew } from "./lib/api.ts";
import { dayInBulgaria } from "./lib/day.ts";
import { type Child, computed, effect, h, lifetime, onCleanup, signal, untracked, when } from "./lib/dom.ts";
import { reportProblem } from "./lib/errors.ts";
import { setTick, tickOn } from "./lib/prefs.ts";
import { needsHomeScreen, pushable, pushOn, pushPrefs, setPushPref, turnOff, turnOn } from "./lib/push.ts";
import { go, rename, title } from "./lib/router.ts";
import { feelKit, loadFeel, play, quietWhenSilent, setSound, soundOn } from "./lib/sound.ts";
import { dateWords, leftWords, searchWords, withWord } from "./lib/words.ts";
import { acceptedLine, startDuel } from "./screens/duel.ts";
import { keepGame, mailAsk } from "./screens/keep.ts";
import { missing } from "./screens/missing.ts";
import { noEmail, signIn } from "./screens/signin.ts";
import { loadStats } from "./screens/stats.ts";
import { chapters, checkNews, look, notice, player, sawFriends, setLook, user } from "./state.ts";
import {
  avatar,
  back,
  chapterName,
  emailWords,
  failure,
  formatNumber,
  glyph,
  inSight,
  isOwnTag,
  leaf,
  mini,
  nameWords,
  pictureCredit,
  playerRow,
  profileHead,
  profileHref,
  record,
  schemeSwitch,
  seal,
  sealsSection,
  shapeNames,
  sheet,
  standing,
  textWords,
  who,
} from "./ui.ts";

export const kit = {
  shareWordsOut,
  acceptedLine,
  inSight,
  isOwnTag,
  lastOf,
  setIfNew,
  api,
  avatar,
  back,
  chapterName,
  chapters,
  computed,
  dateWords,
  dayInBulgaria,
  effect,
  errorText,
  failure,
  feelKit,
  formatNumber,
  sawFriends,
  checkNews,
  glyph,
  go,
  h,
  hands,
  keepGame,
  leaf,
  nameWords,
  emailWords,
  textWords,
  pictureCredit,
  searchWords,
  leftWords,
  lifetime,
  loadFeel,
  loadStats,
  mailAsk,

  mini,
  missing,
  needsHomeScreen,
  news,

  notice,
  onCleanup,
  standing,
  play,
  player,
  profileHead,
  profileHref,
  pushable,
  pushOn,
  pushPrefs,
  quietWhenSilent,
  record,
  rename,
  reportProblem,
  reviewSheet,
  schemeSwitch,
  seal,
  sealsSection,
  setPushPref,
  setSound,
  setTick,
  setLook,
  look,
  shapeNames,
  sheet,
  signal,
  signIn,
  noEmail,
  soundOn,
  startDuel,
  tickOn,
  title,
  turnOff,
  turnOn,
  untracked,
  user,
  when,
  withWord,
  who,
  playerRow,
};

export type Kit = typeof kit;

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

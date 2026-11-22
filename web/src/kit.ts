// app.js holds what a daily visit uses: Начало, a game, the screens a game leads to. A screen a daily visit doesn't
// open loads on its own, the first time it's opened: Профил's places, the Алманах and the
// friends (me, settings, avatar, almanac, friends with its duels' cards, player). Each is handed the app's
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
import { board, boardRow, hands, reviewed, scoreCard, summary } from "./game/results.ts";
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
import { calm, setTick, tickOn } from "./lib/prefs.ts";
import { needsHomeScreen, pushable, pushOn, pushPrefs, setPushPref, turnOff, turnOn } from "./lib/push.ts";
import { byTap, go, goBack, rename, title } from "./lib/router.ts";
import { feelKit, loadFeel, play, playAnswer, playCount, quietWhenSilent, setSound, soundOn } from "./lib/sound.ts";
import { dateWords, issueWords, leftWords, listWords, searchWords, weekday, withWord } from "./lib/words.ts";
import { acceptedLine, startDuel } from "./screens/duel.ts";
import { keepGame, mailAsk } from "./screens/keep.ts";
import { missing } from "./screens/missing.ts";
import { nameFirst } from "./screens/name.ts";
import { noEmail, noEmailLine, signIn } from "./screens/signin.ts";
import { loadStats } from "./screens/stats.ts";
import { rankName, rankNames } from "./seal.ts";
import {
  bulgaria,
  categories,
  checkNews,
  look,
  notice,
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
  tabDot,
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
  leaf,
  lifetime,
  listen,
  listWords,
  nameWords,
  emailWords,
  textWords,
  pictureCredit,
  searchWords,
  leftWords,
  loadFeel,
  loadStats,
  mailAsk,

  mini,
  missing,
  nameFirst,
  needsHomeScreen,
  news,

  notice,
  onCleanup,
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
  rightsOf,
  rename,
  reportProblem,
  reviewed,
  schemeSwitch,
  scoreCard,
  seal,
  sealsSection,
  segmented,
  tabDot,
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

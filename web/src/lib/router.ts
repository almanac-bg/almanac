// Pages without page loads: links inside the app change the screen in place, and Back and Forward work as they should.
//
// Each entry of the tab's history that the app makes keeps a little in its state (Entry): its place in the history,
// the page it was opened from, and how far down the page was scrolled; back comes to a page where it was left. A game
// under way guards its screen (beforeLeaving): a link out, the browser's back (or a phone's) and the game's own arrow
// all ask first, and only „Излез“ goes on, to where they were going. A game gets an entry of its own when its screen
// has none behind it in the app (hold): the day's ten on Начало, a game opened by a link from outside; so that back, mid-question, lands on the guard and not outside the game. Under
// a game opened from outside is Начало, not the game's page again: „Излез“ leaves the game, and its page drawn anew
// would take the player straight back into it.
//
// A page that has fallen behind (a new version of the game out, another account signed in: fresh.ts) opens its next
// screen by loading the page anew (loadAnew), not in place: a moment between screens, which costs the player nothing.
// A link from outside the page (a notification, a link opened in the app) goes the way a tapped one does (navigate).
// A screen that sends the player on as it's drawn goes on once it is drawn, so that the page sent to is what shows.
// A screen whose heading comes after what it loads gets the focus with it (settle), as one drawn at once does. A sheet
// over the page (a <dialog> on the body, outside any screen: a game's news, the name asked for) goes with the screen
// it was over.

import { type Child, mount, signal } from "./dom.ts";

export interface Route {
  path: RegExp;
  view: (params: string[]) => Child;
}

/** What the app keeps in an entry of the tab's history. */
export interface Entry {
  /** The entry's place in the history: back from it is one less. */
  i: number;
  /** The page it was opened from, in the app (none: the first page opened, or one opened again in place of another). */
  from?: string;
  /** An entry of a game's own, over the same page (hold): back from it is back to that page. */
  game?: boolean;
  /** How far down the page was scrolled. */
  y?: number;
  /** A game finished on this page: its result shows again here (a reload, back to it). */
  result?: number;
  /** Opened by a tap, and loaded anew for it (loadAnew): the page so loaded opens as the tap would have. */
  tap?: boolean;
}

/** The path shown now (for navigation to highlight where you are). */
export const path = signal(location.pathname);

let routes: Route[] = [];
let missing: () => Child = () => null;
let root: Element;
let disposeView: (() => void) | null = null;

/** The entry shown now, as the app keeps it. */
export const entry = (): Partial<Entry> => (history.state ?? {}) as Partial<Entry>;

/** The page shown now, with its query and hash. */
const here = () => location.pathname + location.search + location.hash;

/** The place in the history of the entry shown. */
let at = 0;

/** Whether the screen shown was opened by a tap in the app (a link, a button): not by back or forward, a reload, or a
 * link from outside. */
let tapped = false;

/** Moves through the history of the app's own (put back after a back that asked first, then on): what each does once
 * its popstate comes, in order. */
const moves: (() => void)[] = [];

export function start(target: Element, list: Route[], notFound: () => Child): void {
  root = target;
  routes = list;
  missing = notFound;
  try {
    history.scrollRestoration = "manual"; // the app puts each page back where it was (restore)
  } catch {
    // an old browser: it scrolls as it likes
  }
  // A page's address with a slash after it (/almanac/) is that page (the server sends it so): shown without the slash.
  const bare = location.pathname.replace(/\/+$/, "");
  if (bare && bare !== location.pathname && !bare.startsWith("//"))
    history.replaceState(history.state, "", bare + location.search + location.hash);
  if (typeof entry().i !== "number") history.replaceState({ ...entry(), i: 0 }, "");
  at = entry().i ?? 0;
  // A screen loaded anew for a tap opens as one tapped (once: a reload of it after isn't).
  if (entry().tap) {
    tapped = true;
    history.replaceState({ ...entry(), tap: undefined }, "");
  }
  addEventListener("popstate", popped);
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.("a");
    if (
      !a ||
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      a.target ||
      a.hasAttribute("download") ||
      a.origin !== location.origin ||
      !routed(a.pathname) // a page of the server's own (/privacy)
    )
      return;
    e.preventDefault();
    const to = a.pathname + a.search + a.hash;
    // A way back (back(), a game's arrow) goes back to where it points if that's the page before; any other link opens
    // its page.
    const way = a.hasAttribute("data-back") ? () => leave(to) : () => go(to);
    if (!leaving?.(way)) way();
  });
  // How far down the page is, kept in its entry as it scrolls (a moment after it stops: a browser allows only so many
  // writes to the history).
  let still = 0;
  addEventListener(
    "scroll",
    () => {
      clearTimeout(still);
      still = window.setTimeout(() => {
        if (!restoring) mark({ y: Math.round(scrollY) });
      }, 200);
    },
    { passive: true },
  );
  render(false, true);
  restore(entry().y);
}

/** Whether a path is a screen of the app's (else a page of the server's own: /privacy, /mail/off). */
const routed = (pathname: string): boolean => routes.some((r) => r.path.test(pathname));

/** Opens a link to the game that came from outside the page (a notification tapped, a link opened in the app) as a tap
 * on a link would: a game under way asks first; a page of the server's own loads as a page. */
export function navigate(link: string): void {
  let u: URL;
  try {
    u = new URL(link, location.href);
  } catch {
    return; // not a link: nothing to open
  }
  if (u.origin !== location.origin) return;
  if (!routed(u.pathname)) {
    location.assign(u.href);
    return;
  }
  const to = u.pathname + u.search + u.hash;
  const way = () => go(to);
  if (!leaving?.(way)) way();
}

/** Whether the next screen opens by loading the page anew (fresh.ts says when), not in place. */
let anew: () => boolean = () => false;

/** Has the screens opened from now on load the page anew while `when` says so. */
export function loadAnew(when: () => boolean): void {
  anew = when;
}

/** While leaving the screen would cost the player something (a question with its time running), a way
 * out first asks this: it takes the way on (`proceed`), and says whether it holds the way out back until then. */
let leaving: ((proceed: () => void) => boolean) | null = null;

/** Asks `fn` before a link, back or the game's arrow leaves the screen, until the returned function is called. */
export function beforeLeaving(fn: (proceed: () => void) => boolean): () => void {
  leaving = fn;
  return () => {
    if (leaving === fn) leaving = null;
  };
}

/** Back or forward in the tab's history (a browser's button, a phone's): a game that asks first is asked, its entry
 * put back meanwhile, and „Излез“ goes on to where it was going. */
function popped(): void {
  const s = entry();
  const to = typeof s.i === "number" ? s.i : at - 1;
  const move = moves.shift();
  if (move) {
    at = to;
    move();
    return;
  }
  const by = to - at;
  if (by && leaving?.(() => travel(by, arrive))) {
    // Put back the entry of the screen that asks, without drawing it again.
    travel(-by, () => {});
    return;
  }
  at = to;
  arrive();
}

/** A page come to by back or forward: drawn again where it was scrolled to. */
function arrive(): void {
  tapped = false;
  render(false);
  restore(entry().y);
}

/** Moves `by` entries through the history, doing `then` once there (not drawing the page unless `then` does). */
function travel(by: number, then: () => void): void {
  moves.push(then);
  history.go(by);
}

/** Gives the entry shown another address, the screen staying as it is (a board's choice: a reload comes back to it).
 * A game's own entry so renamed stays the game's: its end (release) gives the page under it that address. */
export function rename(to: string): void {
  history.replaceState(entry(), "", to);
  path.set(location.pathname);
}

/** Gives the address shown this fragment (`hash`: „#…“, or "" for none), the screen staying as it is. While a move
 * through the history is under way (a game's end going back from its own entry: release), it's given once the move
 * has arrived: else the move's own address would take it away (Safari arrives later than Chromium, after a quick
 * answer from the server), if `still` says it's still wanted then. */
export function fragment(hash: string, still: () => boolean = () => true): void {
  const set = () => {
    if (!still()) return; // its screen gone meanwhile
    try {
      history.replaceState(history.state, "", location.pathname + location.search + hash);
    } catch {
      // too many writes for a moment: the address keeps the fragment it had
    }
  };
  const last = moves.length - 1;
  const then = moves[last];
  if (!then) {
    set();
    return;
  }
  moves[last] = () => {
    then();
    set();
  };
}

/** Keeps this in the entry shown. */
export function mark(patch: Partial<Entry>): void {
  try {
    history.replaceState({ ...entry(), ...patch }, "");
  } catch {
    // too many writes for a moment: kept with the next
  }
}

/** Opens a path in the app; the one already open opens afresh (Начало, tapped in the middle of the day's ten, is
 * Начало again, not the question). A game's own entry (hold) is the game's, not a page: a path opened from it opens
 * from the page under it, gone back to first, so that back from there comes to that page once, not to it twice (and
 * the path it was opened over is that page itself). */
export function go(to: string, replace = false): void {
  open(to, replace, true);
}

/** Opens `to` (`tap`: as a tap does); `under`: from the page under a game's own entry, which keeps where it was
 * scrolled to before the game (hold). */
function open(to: string, replace: boolean, tap: boolean, under = false): void {
  // Asked by a screen as it's drawn: once it is, or the screen drawn over the new page would be this one, empty.
  if (drawing) {
    queueMicrotask(() => open(to, replace, tap, under));
    return;
  }
  const s = entry();
  if (s.game) {
    travel(-1, () => (!replace && s.from === to ? arrive() : open(to, replace, tap, true)));
    return;
  }
  const here_ = here();
  if (replace) history.replaceState({ i: at, from: s.from }, "", to);
  else if (to !== here_) {
    if (!under) mark({ y: Math.round(scrollY) });
    at += 1;
    history.pushState({ i: at, from: here_ }, "", to);
  }
  tapped = tap;
  render(true);
}

/** Goes to `to` the way back: back in the history if it's the page before, else opening it in place of this one (a
 * page reached from outside, its way back to Начало): never a new entry, so that back after it doesn't come here
 * again. */
export function leave(to: string): void {
  if (entry().from === to) travel(-1, arrive);
  else go(to, true);
}

/** Back where the screen was come to from (a game's count backed out of): the page before, if it's the app's, else
 * `fallback` in place of this one. */
export function goBack(fallback: string): void {
  if (canGoBack()) travel(-1, arrive);
  else go(fallback, true);
}

/** Backs out of a game's count („Откажи“): back where the screen was come to from (goBack); a game holding an entry of
 * its own (hold: a page opened from outside the app, Начало under it) gives it back instead, and its screen's start
 * shows again in place (`stay`), not Начало. */
export function backOut(fallback: string, stay: () => void): void {
  if (!entry().game) {
    goBack(fallback);
    return;
  }
  release();
  stay();
}

/** Whether the screen shown was opened by a tap in the app, rather than come to by back or forward, a reload or a link
 * from outside: a game counts in only after a tap. */
export const byTap = (): boolean => tapped;

/** Whether back stays in the app: the page before is one of its own. */
export const canGoBack = (): boolean => entry().from !== undefined;

/** Gives a game under way an entry of its own over the page it's played on, unless back from the page stays in the
 * app already (`always`: even then; the day's ten, on Начало, whose back would leave Начало itself): back, mid-game,
 * comes to the game's guard, then to the page under it. A game opened from outside the app (nothing of the app's
 * before its page) has Начало under it: back and „Излез“ come there, out of the game, and back again leaves. */
export function hold(always = false): void {
  const s = entry();
  if (s.game || (!always && s.from !== undefined)) return;
  const page = here();
  const under = s.from === undefined ? "/" : page;
  if (under === page) mark({ y: Math.round(scrollY) });
  else history.replaceState({ i: at }, "", under);
  at += 1;
  history.pushState({ i: at, from: under, game: true }, "", page);
}

/** A game over: its entry of its own (hold) goes, back to the page under it, which takes the game's address (Начало
 * under a game opened from outside) and keeps what's given (its result); the screen stays as it is. */
export function release(keep: Partial<Entry> = {}): void {
  if (!entry().game) {
    mark(keep);
    return;
  }
  const page = here();
  travel(-1, () => {
    try {
      history.replaceState({ ...entry(), ...keep }, "", page);
    } catch {
      // too many writes for a moment: the page under keeps its own address
    }
    path.set(location.pathname);
  });
}

/** Whether a screen is being drawn now (render). */
let drawing = false;

/** Draws the screen of the page shown (`first`: as the page loads). */
function render(scrollTop: boolean, first = false): void {
  stopRestoring(); // the place the screen before was put back at isn't this one's
  if (!first && anew()) {
    // The page fallen behind: this screen comes with the page loaded anew, as it was come to.
    if (tapped) mark({ tap: true });
    location.reload();
    return;
  }
  path.set(location.pathname);
  let view: () => Child = missing;
  for (const r of routes) {
    const m = r.path.exec(location.pathname);
    if (m) {
      view = () => r.view(m.slice(1));
      break;
    }
  }
  disposeView?.();
  for (const sheet of document.querySelectorAll?.<HTMLDialogElement>("dialog[open]") ?? []) sheet.close();
  drawing = true;
  try {
    disposeView = mount(root, view);
  } finally {
    drawing = false;
  }
  if (scrollTop) scrollTo(0, 0);
  settle();
}

/** Stops waiting for the heading of the screen before (settle). */
let unsettled = () => {};

/** Screen readers (and the keyboard) start at the new screen's heading: there now, or, for a screen that draws it once
 * what it shows has loaded, as it comes (within ten seconds), unless the player has put the focus somewhere meanwhile. */
function settle(): void {
  unsettled();
  const focus = (heading: HTMLElement) => {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  };
  const now = root.querySelector<HTMLElement>("h1");
  if (now) {
    focus(now);
    return;
  }
  const seen = new MutationObserver(() => {
    const heading = root.querySelector<HTMLElement>("h1");
    if (!heading) return;
    unsettled();
    const at = document.activeElement;
    if (!at || at === document.body || !at.isConnected) focus(heading);
  });
  const timeout = setTimeout(() => unsettled(), 10_000);
  unsettled = () => {
    seen.disconnect();
    clearTimeout(timeout);
    unsettled = () => {};
  };
  seen.observe(root, { childList: true, subtree: true });
}

/** Whether the page is being put back where it was scrolled to: its scrolling meanwhile isn't the player's. */
let restoring = false;
let stopRestoring = () => {};

/** What ends the wait to put the page back (restore): the player scrolling, pressing a key, or touching or clicking
 * anywhere (a click may open another screen, or open something on this one). */
const playerMoves = ["wheel", "touchstart", "pointerdown", "mousedown", "keydown"];

/** Puts the page back where it was scrolled to (`y`), once it's tall enough, and keeps it there while the screen draws
 * what it loads after it opens: tall enough already, what loads above would otherwise move it (the browser's scroll
 * anchoring). A move of the player's (playerMoves), another screen drawn (render), or five seconds end the wait. */
function restore(y = 0): void {
  stopRestoring();
  scrollTo(0, y);
  if (y <= 0) return;
  restoring = true;
  const seen = new ResizeObserver(() => scrollTo(0, y));
  const stop = () => {
    restoring = false;
    seen.disconnect();
    clearTimeout(timeout);
    for (const e of playerMoves) removeEventListener(e, stop, true);
    if (stopRestoring === stop) stopRestoring = () => {};
  };
  const timeout = setTimeout(stop, 5000);
  for (const e of playerMoves) addEventListener(e, stop, { capture: true, passive: true });
  seen.observe(root);
  stopRestoring = stop;
}

/** Sets the tab's title for the screen. */
export function title(text?: string): void {
  document.title = text ? `${text} · АЛМАНАХ` : "АЛМАНАХ";
}

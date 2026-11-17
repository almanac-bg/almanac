// The page kept current. A page stays open for days (a tab, the app's web view) while the game changes under it: a
// deploy (several a day) renames the files its screens load and may change the API, and another tab may sign in, out,
// or as someone else.
//
// Every API answer says the server's version (X-Almanac-Version: server/api.go); a session the server says has ended
// ends here too; and each tab tells the others of the player it has (a BroadcastChannel). A page that has fallen behind
// (stale) loads itself anew at the next moment that costs the player nothing: the next screen opened (router.ts,
// loadAnew: that screen is going anyway), or the page come back into view while no game is under way (playing) and no
// screen holds it (staying: a live duel's wait for an opponent). Back after a while away (a phone's app brought back),
// the page asks the server first (GET /api/me) whether it's behind. A screen's own file that doesn't load is most
// likely one of a version gone by: the page loads anew for it, once (recover).

import { api, hearing } from "./lib/api.ts";
import { version } from "./lib/boot.ts";
import { effect, onCleanup, signal } from "./lib/dom.ts";
import { loadAnew } from "./lib/router.ts";
import { playing, type User, user } from "./state.ts";

/** Why the page is behind: a new version of the game, or another player's session in the browser ("": it isn't). */
export const stale = signal<"" | "version" | "session">("");

const behind = (why: "version" | "session") => {
  if (!stale.peek()) stale.set(why);
};

/** What would be lost to a reload now, as each screen says (staying). */
const holds = new Set<() => boolean>();

/** While `costs` says so, a reload of the page would cost the player something the screen can't bring back (a place in
 * the queue for a duel): the page waits for the next screen to load anew. For as long as the screen lasts. */
export function staying(costs: () => boolean): void {
  holds.add(costs);
  onCleanup(() => holds.delete(costs));
}

/** A moment a reload costs nothing: no game under way, no screen that holds the page. */
const quiet = () => !playing.peek() && ![...holds].some((costs) => costs());

/** Loads the page anew if it's behind and the moment is quiet. */
function catchUp(): void {
  if (stale.peek() && quiet() && !document.hidden) location.reload();
}

/** The player as each tab of the browser has it, told to the others: the same JSON, or none (signed out). */
const said = (u: User | null) => (u ? JSON.stringify(u) : "");
let told = said(user.peek());

/** Another tab has `next` as the player (the cookie is the browser's, not the tab's). The same player, maybe renamed:
 * taken as is. A player where this tab had none (a guest made there): taken too, nothing on screen being anyone's.
 * Anyone else, or none: this page is someone else's now, and loads anew when it can. */
function heardOf(next: User | null): void {
  const mine = user.peek();
  if (said(next) === said(mine)) return;
  if (next && (!mine || mine.id === next.id)) {
    told = said(next);
    user.set(next);
    return;
  }
  behind("session");
  catchUp();
}

let asked = 0;

/** Asks the server who the player is (and, by its answer, its version): after a while away. */
async function check(): Promise<void> {
  if (Date.now() - asked < 5_000) return;
  asked = Date.now();
  try {
    const r = await api<{ user: User | null }>("GET", "/api/me");
    heardOf(r.user);
  } catch {
    // no line: the next answer will tell
  }
  catchUp();
}

/** Away for at least this long, the page asks whether it's behind as it comes back. */
const away = 60_000;

/** The page brought back by the phone's app (lib/phone.ts), whose web view may not say it was hidden: is it behind? */
export function resumed(): void {
  if (stale.peek()) catchUp();
  else void check();
}

/** Keeps the page current (above): from the start, for good. */
export function keepFresh(): void {
  hearing.push((res, code) => {
    const v = res.headers.get("X-Almanac-Version");
    if (v && version && v !== version) behind("version");
    // A session that has ended (signed out in another tab, the profile deleted, sent out by a sign-in elsewhere): the
    // page is no one's now, and loads anew as one (at once, unless a game is under way).
    if (code === "signed_out" && user.peek()) {
      user.set(null);
      behind("session");
      catchUp();
    }
  });
  loadAnew(() => stale.peek() !== "");
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("almanac.player");
  if (channel) channel.onmessage = (e: MessageEvent<{ user: User | null }>) => heardOf(e.data?.user ?? null);
  effect(() => {
    const u = user();
    if (said(u) === told) return;
    told = said(u);
    channel?.postMessage({ user: u });
  });
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (stale.peek()) catchUp();
    else if (hiddenAt && Date.now() - hiddenAt >= away) void check();
  });
}

/** A file of the page's own that didn't load (a screen's, loaded the first time it opens): if the server answers, the
 * line is fine and the file most likely one of a version gone by, so the page loads anew (true), once for the page and
 * version (a file truly missing isn't loaded again and again). False: no line, or loaded anew already. */
export async function recover(): Promise<boolean> {
  try {
    await api("GET", "/api/me");
  } catch {
    return false;
  }
  const key = "almanac.anew";
  const mark = `${version} ${location.pathname}`;
  try {
    if (sessionStorage.getItem(key) === mark) return false;
    sessionStorage.setItem(key, mark);
  } catch {
    return false; // no storage: not a reload that might never end
  }
  location.reload();
  return true;
}

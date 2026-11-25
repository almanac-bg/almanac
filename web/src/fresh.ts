// The page kept current. A page stays open for days (a tab, the app's web view) while the game changes under it: a
// deploy (several a day) renames the files the page loads and may change the API, and another tab may sign in, out,
// or as someone else.
//
// Every API answer says the server's version (X-Almanac-Version: server/api.go); a session the server says has ended
// ends here too; and each tab tells the others of the player it has (a BroadcastChannel). A page that has fallen behind
// (stale) loads itself anew at the next moment that costs the player nothing: the next screen opened (router.ts,
// loadAnew: that screen is going anyway), or the page come back into view while no game is under way (playing) and no
// report is half written (quiet). Back after a while away (a phone's app brought back), the page asks the server first
// (GET /api/me) whether it's behind.

import { api, hearing } from "./lib/api.ts";
import { version } from "./lib/boot.ts";
import { effect, signal } from "./lib/dom.ts";
import { loadAnew } from "./lib/router.ts";
import { playing, type User, user } from "./state.ts";

/** Why the page is behind: a new version of the game, or another player's session in the browser ("": it isn't). */
export const stale = signal<"" | "version" | "session">("");

const behind = (why: "version" | "session") => {
  if (!stale.peek()) stale.set(why);
};

/** A moment a reload costs nothing: no game under way, and nothing being written in a dialog (a question's report:
 * the player may have gone to look up a source, and comes back to finish it). */
const quiet = () => !playing.peek() && !document.querySelector<HTMLTextAreaElement>("dialog[open] textarea")?.value;

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

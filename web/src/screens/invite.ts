// An invite link (server/invite.go, play/invite.go), opened: /f/<code> is Днес, the invite over the day's issue (its
// cover, to a visitor not signed in): whose it is, with their avatar and seal, and „Добави като приятел“. One tap
// makes the two friends. A visitor who hasn't finished a game plays first: the tap is kept on this device (a week at
// most, and only while the device's player is the same: forgetOnSignOut), and the link taken as a game ends
// (takeWaiting, from Днес's result), or as Днес next opens (takeWaitingOnce), its line over Днес. The address stays
// the link's until the invite is answered (leaveInvite: then Днес's), so that an app's own browser opening the page in
// the phone's browser (its menu, or coverExit) opens the invite, not only the day.

import { ApiError, api, errorText } from "../lib/api.ts";
import { boot } from "../lib/boot.ts";
import { type Child, effect, h, onCleanup, signal, slot } from "../lib/dom.ts";
import { rename } from "../lib/router.ts";
import { withWord } from "../lib/words.ts";
import { user } from "../state.ts";
import { avatar, type Look, worn } from "../ui.ts";

/** An invite link's path: /f/ and its code. */
export const invitePath = /^\/f\/([a-z2-9]{10})$/;

/** An invite as its opener sees it (play.Invite): whose it is, and whether it's the opener's own, or a friend's
 * already. */
interface Invite extends Look {
  code: string;
  name: string;
  tag: string;
  mine?: boolean;
  friends?: boolean;
}

/** What Днес shows of an invite opened: the invite, that the link isn't one (any more), or why it couldn't be looked
 * up now (too many from here, no line: in the server's words or the API's). */
type Opened = Invite | { gone: true } | { error: string };

/** The invite the page was opened at, until Днес has taken it (inviteCard). */
let opened: Opened | null = null;

/** The words for a link that isn't one (any more): the server's for no_invite. */
const goneWords = "Тази връзка вече не важи. Поискай нова.";

/** Gives Днес its own address once the invite is answered (or isn't one): a reload, or the address copied, is the
 * day's then. */
function leaveInvite(): void {
  if (invitePath.test(location.pathname)) rename("/");
}

/** An invite link (/f/<code>), opened: Днес (`day`), with the invite as the page came with it, or as asked for (the
 * link come back to through the history, the page's own boot spent). */
export function invited([code = ""]: string[], day: () => Child): Child {
  const inPage = boot.invite as (Partial<Invite> & { gone?: boolean; error?: string }) | undefined;
  boot.invite = undefined;
  if (inPage && (inPage.gone || inPage.error || inPage.code === code)) {
    opened = inPage.error ? { error: inPage.error } : inPage.gone ? { gone: true } : (inPage as Invite);
    return day();
  }
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  api<Invite>("GET", `/api/invites/${code}`).then(
    (inv) => {
      opened = inv;
      screen.show(day);
    },
    (err) => {
      // Only a 404 is a link that isn't; anything else (too many from here, no line) is said as it is.
      opened = err instanceof ApiError && err.status === 404 ? { gone: true } : { error: errorText(err) };
      screen.show(day);
    },
  );
  return screen;
}

/** Where a tap on an invite waits for the player's first game, on this device: its code and when it was tapped. */
const waitingKey = "almanac.invite";
const waitingFor = 7 * 24 * 60 * 60 * 1000;

function keepWaiting(code: string): void {
  try {
    localStorage.setItem(waitingKey, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // no storage here: the link opened again does it
  }
}

function waiting(): string {
  try {
    const w = JSON.parse(localStorage.getItem(waitingKey) ?? "null") as { code?: string; at?: number } | null;
    if (w?.code && Date.now() - (w.at ?? 0) < waitingFor) return w.code;
    localStorage.removeItem(waitingKey);
  } catch {
    // nothing kept
  }
  return "";
}

function dropWaiting(): void {
  try {
    localStorage.removeItem(waitingKey);
  } catch {
    // nothing kept
  }
}

/** A tap kept is the device's player's: signed out, or their profile deleted, it goes, so that whoever plays here
 * next doesn't befriend a stranger by it. */
export function forgetOnSignOut(): void {
  let had = !!user.peek();
  effect(() => {
    const now = !!user();
    if (had && !now) dropWaiting();
    had = now;
  });
}

/** The answers that end an invite for good: a link that isn't, one's own, the opener's list full, its player's list
 * full (asked again for a week, it would only say so again). Anything else (no line, the server for a moment, too many
 * from here, the link's day spent) may pass. */
const final = new Set(["no_invite", "self", "many_friends", "inviter_full"]);
const isFinal = (err: unknown) => err instanceof ApiError && final.has(err.code);

/** What an invite's card says under the name: the two are friends (`done`: with the way to Приятели), or the add
 * waits, or why it can't be (`bad`; `end`: for good). */
type Said = { text: string; bad?: boolean; done?: boolean; end?: boolean };

/** What came of an invite taken after the player's first game, said once over Днес (or in its card). */
export const inviteSaid = signal<Said | null>(null);

let taking: Promise<void> | null = null;

/** Takes the invite waiting for the player's first game, if one does: once a game has ended, or Днес opens. Still too
 * early (no game counts yet) it waits on, unsaid; an answer that may pass is said and it waits for the next game; a
 * final one ends it. */
export function takeWaiting(): Promise<void> {
  const code = waiting();
  if (!code || !user.peek()) return Promise.resolve();
  taking ??= api<{ name: string }>("POST", `/api/invites/${code}`)
    .then(
      (r) => {
        dropWaiting();
        leaveInvite();
        inviteSaid.set({ text: `Вече сте приятели ${withWord(r.name)}.`, done: true });
      },
      (err) => {
        if (err instanceof ApiError && err.code === "play_first") return;
        const end = isFinal(err);
        if (end) {
          dropWaiting();
          leaveInvite();
        }
        inviteSaid.set({ text: errorText(err), bad: true, end });
      },
    )
    .finally(() => {
      taking = null;
    });
  return taking;
}

let triedOnce = false;

/** Takes a waiting tap once a page load, as Днес opens: its game may have ended on another visit, the result not seen
 * since. */
export function takeWaitingOnce(): void {
  if (triedOnce || !user.peek() || !waiting()) return;
  triedOnce = true;
  takeWaiting();
}

/** The invite opened at the page (once: a later Днес is the day's alone), or what came of one taken after a game,
 * over Днес (`played`: its result). Its tap kept for the player's first game is that game's to take: the card says
 * it waits, and on the result what came of it is said instead (a reload mid-game, at the link). */
export function inviteCard(played = false): Child {
  let o = opened;
  opened = null;
  const kept = !!o && "code" in o && waiting() === o.code;
  if (kept && played) o = null;
  if (!o) {
    // Said once: gone as the screen goes.
    onCleanup(() => inviteSaid.set(null));
    return () => {
      const s = inviteSaid();
      return s ? h("p", { class: "notice", role: s.bad ? "alert" : "status" }, s.text) : null;
    };
  }
  if ("gone" in o) {
    leaveInvite();
    return h("p", { class: "notice", role: "status" }, goneWords);
  }
  if ("error" in o) return h("p", { class: "notice", role: "alert" }, o.error);
  const inv = o;
  if (inv.mine || inv.friends) leaveInvite();
  // What the card says under the name, once there's something to say: the two are friends, or the add waits, or why
  // it can't be (`end`: for good).
  const waits = `Първо изиграй днешния брой. След него ще сте приятели ${withWord(inv.name)}.`;
  const said = signal<Said | null>(
    inv.mine
      ? { text: "Това е твоята връзка. Който я отвори, може да те добави с едно докосване." }
      : inv.friends
        ? { text: `Вече сте приятели ${withWord(inv.name)}.`, done: true }
        : kept
          ? { text: waits }
          : null,
  );
  // The tap kept, taken as Днес opened (takeWaitingOnce: its game played on another visit): what came of it, in the
  // card's line (friends: the way to Приятели with it).
  if (kept) {
    effect(() => {
      const s = inviteSaid();
      if (s) said.set(s);
    });
    onCleanup(() => inviteSaid.set(null));
  }
  const busy = signal(false);
  const playFirst = () => {
    keepWaiting(inv.code);
    said.set({ text: waits });
  };
  const add = async () => {
    // Not a player yet: nobody to be friends with until their first game.
    if (!user.peek()) return playFirst();
    busy.set(true);
    try {
      const r = await api<{ name: string }>("POST", `/api/invites/${inv.code}`);
      dropWaiting();
      leaveInvite();
      said.set({ text: `Вече сте приятели ${withWord(r.name)}.`, done: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "play_first") playFirst();
      else {
        const end = isFinal(err);
        if (end) leaveInvite();
        said.set({ text: errorText(err), bad: true, end });
      }
    } finally {
      busy.set(false);
    }
  };
  return h(
    "section",
    { class: "invite-card", "aria-label": "Връзка за приятелство" },
    avatar(inv.avatar, { name: inv.name }),
    h(
      "div",
      { class: "invite-text" },
      h("p", { class: "invite-name" }, h("strong", null, inv.name), worn(inv.seal)),
      () => {
        const s = said();
        if (!s) return h("p", { class: "invite-line" }, "те кани да сте приятели в АЛМАНАХ.");
        return h(
          "p",
          { class: s.bad ? "invite-line bad" : "invite-line", role: s.bad ? "alert" : "status" },
          s.text,
          s.done ? [" ", h("a", { class: "invite-go", href: "/friends" }, "Към Приятели")] : null,
        );
      },
    ),
    () => {
      const s = said();
      if (inv.mine || s?.done || s?.end || (s && !s.bad)) return null;
      // On a phone the card is one row: „Добави“ alone on its button (app.css), its name whole for a screen reader.
      return h(
        "button",
        { class: "btn inline", type: "button", disabled: busy, onclick: add, "aria-label": "Добави като приятел" },
        // One run of words: the button's gap never inside „Добави като приятел“.
        h("span", null, "Добави", h("span", { class: "invite-more" }, " като приятел")),
      );
    },
  );
}

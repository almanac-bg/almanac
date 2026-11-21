// What the whole app shares: who's playing, and the categories. The server puts both in the page (lib/boot.ts); who's
// playing is kept true to the session's cookie by fresh.ts.

import { api } from "./lib/api.ts";
import { boot } from "./lib/boot.ts";
import { effect, onCleanup, signal, untracked } from "./lib/dom.ts";
import { play } from "./lib/sound.ts";

export interface User {
  id: number;
  name: string;
  /** The player's tag, without the @: how friends find them. */
  tag: string;
  email?: string;
  admin?: boolean;
  /** Still the name drawn for them (an animal and three digits): asked for one of their own (screens/name.ts). */
  drawn?: boolean;
}

export interface Category {
  id: string;
  name: string;
}

export const user = signal<User | null>(boot.user ?? null);
export const categories: Category[] = boot.categories ?? [];
/** „Микс“: the questions of every topic at once, a topic of its own (play.MixTopic). */
export const mix: Category = { id: "mix", name: "Микс" };
/** „България“: the questions about Bulgaria from every topic, a topic of its own (play/bulgaria.go). Its tile shows
 * while the bank has a game's worth of them (open); its games keep its name after. */
export const bulgaria = { id: "bulgaria", name: "България", open: boot.bulgaria === true };
/** Every topic a game can be of, the bank's, „Микс“ and „България“: for naming a game's topic. */
export const topics: Category[] = [...categories, mix, bulgaria];
/** The key browsers subscribe to notifications with ("": none here). */
export const pushKey = boot.push ?? "";
/** The style of a duel's result (outcome.css): loaded with it (kit.ts). */
export const outcomeCss = boot.outcomeCss ?? "";

/** A guest on its way: one, however many ask for the player meanwhile (a double tap on a first „Започни“). */
let making: Promise<User> | null = null;

/** The player, made a guest first if they have no account yet (the first time they play). */
export function player(): Promise<User> {
  const u = user.peek();
  if (u) return Promise.resolve(u);
  making ??= api<{ user: User }>("POST", "/api/guest", {})
    .then((r) => {
      user.set(r.user);
      return r.user;
    })
    .finally(() => {
      making = null;
    });
  return making;
}

/** The animals a new player is given one of, by their id (play.Starters): their avatar until they choose one. */
const starters = ["fox", "bear", "cat", "hare", "hedgehog", "dog", "deer", "stork", "frog"];

/** The player's avatar as the server last said it (the page's, a choice made since: screens/avatar.ts), or "". */
const avatarSaid = signal(boot.avatar ?? "");

/** The player's avatar, as the corner of every page shows it: as the server said, or the one a new player is given. */
export const look = (): string => {
  const said = avatarSaid();
  const u = user();
  return said || (u ? starters[u.id % starters.length] : "") || "";
};

/** The player's avatar, chosen just now. */
export const setLook = (avatar: string) => avatarSaid.set(avatar);

/** Днес is a new visitor's cover (the day alone, before any game begun: screens/today.ts): the frame's places step
 * aside. */
export const cover = signal(false);

/** What became of the profile just now, said once where the player lands, on Днес: deleted (Настройки), or a game
 * brought from another browser (screens/keep.ts). */
export const notice = signal("");

/** The seal the player wears (play.Seal), on the frame's avatar: as the page came with it, and as the server last
 * said it since (GET /api/me after a rank risen, Профил's numbers, a seal chosen). */
export const wornSeal = signal<{ chapter: string; level: number } | null>(boot.seal ?? null);

/** Asks the server again which seal the player wears (a rank just risen may have changed it). */
export function refreshSeal(): void {
  if (!user.peek()) return;
  api<{ seal?: { chapter: string; level: number } }>("GET", "/api/me").then(
    (r) => wornSeal.set(r.seal ?? null),
    () => {},
  );
}

/** How many friend requests wait for the player's answer. */
export const friendRequests = signal(0);

/** How many friends' duels wait for the player to play them. */
export const duelsWaiting = signal(0);

/** How many parts of the screen hold that a game is under way (playingWhile), and whether any does. */
let holds = 0;
const held = signal(false);

/** A game is under way on the screen: nothing else asks for the player's attention then (a friend's request's ping),
 * the header and the bar of places step aside on a phone, and the page isn't loaded anew under it (fresh.ts).
 * Only read: what shows a game holds it (playingWhile). */
export const playing: (() => boolean) & { peek(): boolean } = Object.assign(() => held(), { peek: () => held.peek() });

/** Holds that a game is under way for as long as the current scope lasts and `now` says so: a game's count, the
 * moment its first question is on its way, its questions. Each part holds it for itself, and it's let
 * go once none does: a part handing the screen to the next (the count to the question) takes it again before the
 * moment is over, so the header doesn't come back between them. */
export function playingWhile(now: () => boolean = () => true): void {
  effect(() => {
    if (!now()) return;
    holds++;
    held.set(true);
    onCleanup(() => {
      holds--;
      queueMicrotask(() => {
        if (!holds) held.set(false);
      });
    });
  });
}

/** Looks again, now, whether something waits for the player (after they've answered a request, say). */
export let checkWaiting: () => Promise<void> = async () => {};

/** How long between two looks for what waits for the player: half a minute, twice as long after each that found
 * nothing new, up to five minutes. */
const lookEvery = 30_000;
const lookAtMost = 300_000;

/** Looks, while the page is in view and no game is under way, whether someone asks to be friends or a friend's duel
 * waits: every half minute,
 * less often while nothing changes (lookEvery); and again at once each time the page comes back into view, and each
 * time a game ends. */
export function watchWaiting(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let quiet = 0; // looks in a row that found nothing new
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => checkWaiting(), Math.min(lookEvery * 2 ** quiet, lookAtMost));
  };
  checkWaiting = async () => {
    if (!user.peek()) {
      // Signed out, or the account deleted: its requests and duels go with it.
      friendRequests.set(0);
      duelsWaiting.set(0);
      return;
    }
    // Hidden, or in a game (whose end looks again): no asking, nor any sound over a question.
    if (document.hidden || playing.peek()) return;
    try {
      const r = await api<{ requests: number; duels?: number }>("GET", "/api/friends/requests");
      const duels = r.duels ?? 0;
      const news = r.requests > friendRequests.peek() || duels > duelsWaiting.peek();
      const same = r.requests === friendRequests.peek() && duels === duelsWaiting.peek();
      quiet = same ? Math.min(quiet + 1, 4) : 0;
      if (news && !playing.peek()) play("ping"); // never over a question
      friendRequests.set(r.requests);
      duelsWaiting.set(duels);
    } catch {
      // Offline for a moment: the next look will tell.
    }
    later();
  };
  effect(() => {
    user();
    if (!playing()) untracked(checkWaiting);
  });
  document.addEventListener("visibilitychange", () => {
    quiet = 0;
    checkWaiting();
  });
}

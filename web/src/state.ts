// What the whole app shares: who's playing, and the categories. The server puts both in the page (lib/boot.ts); who's
// playing is kept true to the session's cookie by fresh.ts.

import { api } from "./lib/api.ts";
import { boot } from "./lib/boot.ts";
import { effect, onCleanup, signal, untracked } from "./lib/dom.ts";
import { play } from "./lib/sound.ts";
import type { Open } from "./ui.ts";

export interface User {
  id: number;
  name: string;
  /** The player's tag, without the @: how friends find them. */
  tag: string;
  email?: string;
  admin?: boolean;
  /** Still the name drawn for them (an animal and three digits): a room asks for one first. */
  drawn?: boolean;
}

export interface Category {
  id: string;
  name: string;
}

export const user = signal<User | null>(boot.user ?? null);
/** Which of the game's systems the player has met (play/unfold.go), for what any screen shows of them: an avatar's
 * level waits for XP. The page has it from the server; Начало's day, Профил and a game's news say it again as it
 * grows (met). Nothing yet before a first game. */
export const opened = signal<Partial<Open>>(boot.open ?? {});
/** The player's systems, as an answer just said them. */
export const met = (open?: Open) => {
  if (open) opened.set(open);
};
export const categories: Category[] = boot.categories ?? [];
/** „България“: the questions about Bulgaria from every topic, a topic of its own (play/bulgaria.go). Its tile shows
 * while the bank has a game's worth of them (open); its games keep its name after. */
export const bulgaria = { id: "bulgaria", name: "България", open: boot.bulgaria === true };
/** Every topic a game can be of, the bank's and „България“: for naming a game's topic. */
export const topics: Category[] = [...categories, bulgaria];
/** The key browsers subscribe to notifications with ("": none here). */
export const pushKey = boot.push ?? "";
/** The platforms the game's app gets notifications on ("ios", "android"). */
export const phonePlatforms: string[] = boot.phones ?? [];
/** The style of a duel's result (outcome.css): loaded with it (kit.ts). */
export const outcomeCss = boot.outcomeCss ?? "";

/** Where the page was first opened: a new guest says it, so the admin page can tell where players come from (an
 * invite, a shared day, a room …), whatever pages they went through before their first game. */
const landing = location.pathname;

/** A guest on its way: one, however many ask for the player meanwhile (a double tap on a first „Започни“). */
let making: Promise<User> | null = null;

/** The player, made a guest first if they have no account yet (the first time they play). */
export function player(): Promise<User> {
  const u = user.peek();
  if (u) return Promise.resolve(u);
  making ??= api<{ user: User }>("POST", "/api/guest", { from: landing })
    .then((r) => {
      user.set(r.user);
      return r.user;
    })
    .finally(() => {
      making = null;
    });
  return making;
}

/** What became of the profile just now, said once where the player lands, on Начало: deleted (Настройки), or a game
 * brought from another browser (screens/keep.ts). */
export const notice = signal("");

/** How many friend requests wait for the player's answer. */
export const friendRequests = signal(0);

/** How many parts of the screen hold that a game is under way (playingWhile), and whether any does. */
let holds = 0;
const held = signal(false);

/** A game is under way on the screen: nothing else asks for the player's attention then (a friend's challenge, its
 * ping), the header and the bar of places step aside on a phone, and the page isn't loaded anew under it (fresh.ts).
 * Only read: what shows a game holds it (playingWhile). */
export const playing: (() => boolean) & { peek(): boolean } = Object.assign(() => held(), { peek: () => held.peek() });

/** Holds that a game is under way for as long as the current scope lasts and `now` says so: a game's count, the
 * moment its first question is on its way, its questions, a live game's. Each part holds it for itself, and it's let
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

/** A friend's challenge waiting for the player: who, and until when. */
export interface Challenge {
  id: number;
  from: string;
  expiresAt: number;
  /** Begun and not finished. */
  started?: boolean;
}

/** The friends' challenges waiting for the player, the soonest to run out first. */
export const challenges = signal<Challenge[]>([]);

/** Looks again, now, whether something waits for the player (after they've answered a challenge, say). */
export let checkWaiting: () => Promise<void> = async () => {};

/** How long between two looks for what waits for the player: half a minute, twice as long after each that found
 * nothing new, up to five minutes. */
const lookEvery = 30_000;
const lookAtMost = 300_000;

/** Looks, while the page is in view and no game is under way, whether a friend has challenged the player, or someone
 * asks to be friends: every half minute, less often while nothing changes (lookEvery); and again at once each time
 * the page comes back into view, and each time a game ends, so a challenge just played doesn't stay on the notice. */
export function watchWaiting(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let quiet = 0; // looks in a row that found nothing new
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => checkWaiting(), Math.min(lookEvery * 2 ** quiet, lookAtMost));
  };
  checkWaiting = async () => {
    if (!user.peek()) {
      // Signed out, or the account deleted: its challenges and requests go with it.
      challenges.set([]);
      friendRequests.set(0);
      return;
    }
    // Hidden, or in a game (whose end looks again): no asking, nor any sound over a question.
    if (document.hidden || playing.peek()) return;
    try {
      const r = await api<{ requests: number; challenges: Challenge[] }>("GET", "/api/friends/invites");
      const known = new Set(challenges.peek().map((c) => c.id));
      const news = r.requests > friendRequests.peek() || r.challenges.some((c) => !known.has(c.id));
      const same = !news && r.requests === friendRequests.peek() && r.challenges.length === known.size;
      quiet = same ? Math.min(quiet + 1, 4) : 0;
      if (news && !playing.peek()) play("ping"); // never over a question
      friendRequests.set(r.requests);
      challenges.set(r.challenges);
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

// What the whole app shares: who's playing, and the categories. The server puts both in the page.

import { api } from "./lib/api.ts";
import { effect, signal, untracked } from "./lib/dom.ts";
import { play } from "./lib/sound.ts";

export interface User {
  id: number;
  name: string;
  /** The player's tag, without the @: how friends find them. */
  tag: string;
  email?: string;
  admin?: boolean;
}

export interface Category {
  id: string;
  name: string;
}

interface Boot {
  user: User | null;
  categories: Category[];
  version: string;
  push: string;
}

const boot: Boot = JSON.parse(document.getElementById("boot")?.textContent || "{}");

export const user = signal<User | null>(boot.user ?? null);
export const categories: Category[] = boot.categories ?? [];
export const version = boot.version ?? "";
/** The key browsers subscribe to notifications with ("": none here). */
export const pushKey = boot.push ?? "";

/** The player, made a guest first if they have no account yet (the first time they play). */
export async function player(): Promise<User> {
  const u = user.peek();
  if (u) return u;
  const r = await api<{ user: User }>("POST", "/api/guest", {});
  user.set(r.user);
  return r.user;
}

/** How many friend requests wait for the player's answer. */
export const friendRequests = signal(0);

/** A game is under way on the screen: nothing else asks for the player's attention then. */
export const playing = signal(false);

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

/** Asks every half minute, while the page is in view, whether a friend has challenged the player, or someone asks
 * to be friends. */
export function watchWaiting(): void {
  checkWaiting = async () => {
    if (!user.peek()) {
      // Signed out, or the account deleted: its challenges and requests go with it.
      challenges.set([]);
      friendRequests.set(0);
      return;
    }
    if (document.hidden) return;
    try {
      const r = await api<{ requests: number; challenges: Challenge[] }>("GET", "/api/friends/invites");
      const known = new Set(challenges.peek().map((c) => c.id));
      const news = r.requests > friendRequests.peek() || r.challenges.some((c) => !known.has(c.id));
      if (news && !playing.peek()) play("ping"); // never over a question
      friendRequests.set(r.requests);
      challenges.set(r.challenges);
    } catch {
      // Offline for a moment: the next look will tell.
    }
  };
  effect(() => {
    user();
    untracked(checkWaiting);
  });
  setInterval(checkWaiting, 30_000);
  document.addEventListener("visibilitychange", () => checkWaiting());
}

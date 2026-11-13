// What the whole app shares: who's playing, and the categories. The server puts both in the page.

import { api } from "./lib/api.ts";
import { signal } from "./lib/dom.ts";
import { play } from "./lib/sound.ts";

export interface User {
  id: number;
  name: string;
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

/** A duel a friend asks the player to, waiting for them. */
export interface Invitation {
  code: string;
  from: string;
  fromId: number;
  leftMs: number;
}

/** The duels friends ask the player to now: Заедно lists them, and the nav marks that there are some. */
export const invitations = signal<Invitation[]>([]);

/** Asks every half minute, while the page is in view, whether a friend calls the player to a duel. */
export function watchInvitations(): void {
  const check = async () => {
    if (!user.peek() || document.hidden) return;
    try {
      const now = (await api<{ invites: Invitation[] }>("GET", "/api/friends/invites")).invites;
      if (now.some((i) => !invitations.peek().some((was) => was.code === i.code))) play("ping");
      invitations.set(now);
    } catch {
      // Offline for a moment: the next look will tell.
    }
  };
  check();
  setInterval(check, 30_000);
  document.addEventListener("visibilitychange", check);
}

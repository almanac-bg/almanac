// What the whole app shares: who's playing, and the categories. The server puts both in the page.

import { api } from "./lib/api.ts";
import { signal } from "./lib/dom.ts";

export interface User {
  id: number;
  name: string;
  email?: string;
  admin?: boolean;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
}

interface Boot {
  user: User | null;
  categories: Category[];
  version: string;
}

const boot: Boot = JSON.parse(document.getElementById("boot")?.textContent || "{}");

export const user = signal<User | null>(boot.user ?? null);
export const categories: Category[] = boot.categories ?? [];
export const version = boot.version ?? "";

/** The player, made a guest first if they have no account yet (the first time they play). */
export async function player(): Promise<User> {
  const u = user.peek();
  if (u) return u;
  const r = await api<{ user: User }>("POST", "/api/guest", {});
  user.set(r.user);
  return r.user;
}

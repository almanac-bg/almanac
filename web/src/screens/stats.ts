// How a player stands, as Профил shows them their own: their seal, the streak (and their longest) and this week. No
// lifetime totals, and no list of past games: a game isn't gone over after its day (play/stats.go).

import { api } from "../lib/api.ts";
import { wornSeal } from "../state.ts";

export interface Stats {
  /** The player's avatar, as others see it ("shape-tone"). */
  avatar: string;
  /** The seal they wear (play.Seal): a chapter's rank. */
  seal?: { chapter: string; level: number; name: string; quarter: number };
  /** The worn seal's chapter's ink, as the book has it (its Алманах card's number). */
  ink?: number;
  streak: number;
  /** The longest streak the player has had. */
  best: number;
  week: boolean[];
  /** This week's day missed that the streak forgave, Monday first. */
  forgiven: boolean[];
  /** Whether this week would still forgive a day missed. */
  spare: boolean;
}

export const loadStats = () =>
  api<Stats>("GET", "/api/me/stats").then((s) => {
    // The seal worn, for the frame's avatar too.
    wornSeal.set(s.seal ?? null);
    return s;
  });

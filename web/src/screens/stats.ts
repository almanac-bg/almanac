// How a player stands, as Профил shows them their own: each chapter's ink, the streak as it is now and what this week
// forgave. No
// lifetime totals, and no list of past games: a game isn't gone over after its day (play/stats.go).

import { api } from "../lib/api.ts";

export interface Stats {
  /** The player's avatar, as others see it (a shape). */
  avatar: string;
  /** Each chapter's ink, as the book has it (its Алманах card's number): Профил's seals say it. */
  ink?: Record<string, number>;
  streak: number;
  /** This week's day missed that the streak forgave, Monday first. */
  forgiven: boolean[];
  /** Whether this week would still forgive a day missed. */
  spare: boolean;
}

export const loadStats = () => api<Stats>("GET", "/api/me/stats");

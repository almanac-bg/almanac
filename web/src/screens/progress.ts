// A player's progress as the server keeps it: the level, every achievement, and what they may look like.

import { api } from "../lib/api.ts";
import type { AchievementInfo, Division, Tier, TitleRef, Unlock } from "../ui.ts";
import type { Standing } from "./duel.ts";

export interface Progress {
  level: number;
  xp: number;
  from: number;
  to: number;
  achievements: AchievementInfo[];
  avatar: string;
  title: string;
  shapes: { shape: string; locked?: boolean; how?: string }[];
  tones: string[];
  standing: Standing;
  /** Every title, the champion's first (named by how many times it's won): yours, or locked with what
   * unlocks it. */
  titles: TitleView[];
  /** The wardrobe: the frame and pattern worn ("" for none), and all there are. */
  frame: string;
  backdrop: string;
  frames: Cosmetic[];
  backdrops: Cosmetic[];
  /** What comes next: the next level that unlocks something, and the division above the rating. */
  next: {
    level?: number;
    levelUnlocks: Unlock[];
    division?: Division;
    divisionUnlocks: Unlock[];
  };
  /** What the first achievement of a tier unlocks, of what the player doesn't have yet. */
  tierUnlocks: Partial<Record<Tier, Unlock[]>>;
}

/** A frame or a pattern: free or unlocked, or locked with what unlocks it. */
export interface Cosmetic {
  id: string;
  name: string;
  locked?: boolean;
  how?: string;
}

/** Who you are in the game: your avatar with your level, your name, your title. */

export const loadProgress = () => api<Progress>("GET", "/api/me/progress");

/** A title as the wardrobe lists it: yours to wear, or locked with what unlocks it. */
export interface TitleView extends TitleRef {
  /** Where it comes from: the level, an achievement, a topic's mastery, or the rating and the league (a division, Роял, first place in a high league). */
  group: "level" | "achievement" | "topic" | "rank";
  locked?: boolean;
  how?: string;
}

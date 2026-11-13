// A player's progress as the server keeps it: the level, every achievement, and what they may look like.

import { api } from "../lib/api.ts";
import type { AchievementInfo, Tier } from "../ui.ts";
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
  /** The titles of a season's podium, first to third: won some times, or not yet (0). */
  podium: { id: string; name: string; tier: Tier; won: number }[];
  /** The wardrobe: the frame and pattern worn ("" for none), and all there are. */
  frame: string;
  backdrop: string;
  frames: Cosmetic[];
  backdrops: Cosmetic[];
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

/** A title as the wardrobe lists it: a podium's or an achievement's; earned, or with what unlocks it. */
export interface TitleInfo {
  id: string;
  name: string;
  tier: Tier;
  earned: boolean;
  how: string;
}

const podiumHow = ["първо място в сезон", "второ място в сезон", "трето място в сезон"];

/** Every title there is: the podium's first, then the achievements'. */
export function titlesOf(p: Progress): TitleInfo[] {
  return [
    ...p.podium.map((t, i) => ({ id: t.id, name: t.name, tier: t.tier, earned: t.won > 0, how: podiumHow[i] ?? "" })),
    ...p.achievements.map((a) => ({
      id: a.id,
      name: a.name,
      tier: a.tier,
      earned: !!a.at,
      how: a.about.charAt(0).toLowerCase() + a.about.slice(1),
    })),
  ];
}

// A player's progress as the server keeps it: the level, every achievement, and what they may look like.

import { api } from "../lib/api.ts";
import type { AchievementInfo } from "../ui.ts";
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

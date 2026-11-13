// A player's progress as the server keeps it: the level, every achievement, and what they may look like.

import { api } from "../lib/api.ts";
import type { AchievementInfo } from "../ui.ts";

export interface Progress {
  level: number;
  points: number;
  from: number;
  to: number;
  achievements: AchievementInfo[];
  avatar: string;
  title: string;
  shapes: { shape: string; locked?: boolean; how?: string }[];
  tones: string[];
}

/** Who you are in the game: your avatar with your level, your name, your title. */

export const loadProgress = () => api<Progress>("GET", "/api/me/progress");

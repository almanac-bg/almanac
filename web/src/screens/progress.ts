// A player's progress as the server keeps it: the level, every achievement, and what they may look like.

import { api } from "../lib/api.ts";
import { met } from "../state.ts";
import type { AchievementInfo, Division, Open, Standing, Tier, TitleRef, Unlock } from "../ui.ts";

export interface Progress {
  level: number;
  xp: number;
  from: number;
  to: number;
  achievements: AchievementInfo[];
  avatar: string;
  title: string;
  /** No title chosen yet: the level's is worn (`title`; "" before „Любопитен ум“), not „Без титла“, a choice. */
  titleByLevel?: boolean;
  shapes: Shape[];
  tones: string[];
  standing: Standing;
  /** Every title: yours, or locked with what unlocks it. */
  titles: TitleView[];
  /** The wardrobe: the frame and pattern worn ("" for none), and all there are. */
  frame: string;
  backdrop: string;
  frames: Cosmetic[];
  backdrops: Cosmetic[];
  /** What comes next: the next level that unlocks something, the division above the rating (once it's set), and the
   * next title of the days on which the day's questions were played. */
  next: {
    level?: number;
    levelUnlocks: Unlock[];
    division?: Division;
    divisionUnlocks: Unlock[];
    days?: { title: Unlock; days: number; have: number };
  };
  /** What the first achievement of a tier unlocks, of what the player doesn't have yet. */
  tierUnlocks: Partial<Record<Tier, Unlock[]>>;
  /** Which of the game's systems the player has met (play/unfold.go): what Профил shows. */
  open: Open;
}

/** A frame or a pattern: free or unlocked, or locked with what unlocks it. */
/** What unlocks something still locked: the phrase after „с“ („ниво 7“, „постижението „Цяла седмица““), and the level
 * or the achievement it takes, to say how far along the player is. */
export interface Lock {
  locked?: boolean;
  how?: string;
  level?: number;
  achievement?: string;
}

export interface Shape extends Lock {
  shape: string;
}

export interface Cosmetic extends Lock {
  id: string;
  name: string;
}

/** Who you are in the game: your avatar with your level, your name, your title. */

export const loadProgress = () =>
  api<Progress>("GET", "/api/me/progress").then((p) => {
    met(p.open);
    return p;
  });

/** A title as the wardrobe lists it: yours to wear, or locked with what unlocks it. */
export interface TitleView extends TitleRef {
  /** Where it comes from: the level, the days of the day's questions, an achievement, a topic's mastery, or the rating
   * (a division). */
  group: "level" | "days" | "achievement" | "topic" | "rank";
  locked?: boolean;
  how?: string;
}

/** The achievements not yet earned nearest to done (of those that tell how far along they are, first), the hidden
 * ones left out. */
export function nearest(list: AchievementInfo[], n: number): AchievementInfo[] {
  const share = (a: AchievementInfo) => (a.progress ?? 0) / (a.goal ?? 1);
  return list
    .filter((a) => !a.at && !a.hidden)
    .sort((a, b) => share(b) - share(a) || (a.goal ?? 1) - (b.goal ?? 1))
    .slice(0, n);
}

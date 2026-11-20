// Badges: an achievement's medal, drawn with the other pictures (art/pictures.ts) in its tier's colour.
//
// The tier gives the medal its form, so it reads even without colour: common is a round coin, rare a hexagon, epic an
// eight-pointed star, legendary a sunburst with ribbons. The achievement's own picture fills its face: every achievement
// has one (medalPictures), apart from the avatar it unlocks, which is the game's rule (internal/play). Within a family
// the picture grows with the deed: a flame, a torch, a bonfire, a phoenix, a sun. A locked medal is grey (how far along it is
// shows beside it, as a bar); a hidden one shows only a question mark.

import type { Tier } from "../ui.ts";
import { picture } from "./picture.ts";

/** Each achievement's picture on its medal, by its id (art only: what it unlocks is the server's). */
export const medalPictures: Record<string, string> = {
  streak3: "flame",
  streak7: "torch",
  streak30: "bonfire",
  streak100: "phoenix",
  streak365: "year",
  noMiss: "calendar",
  facts100: "book",
  facts1000: "books",
  facts5000: "topic-general",
  wholeTopic: "topic-literature",
  fast: "bolt",
  lastSecond: "hourglass",
  duel1: "shield",
  duel10: "blades",
  duel50: "helmet",
  friend1: "heart",
  friends5: "hearts",
  perfect: "star",
  topicPerfect: "spark",
  exact: "target",
  allTopics: "compass",
  nightOwl: "owl",
  earlyBird: "sun",
  games100: "trophy",
  master: "cap",
  master5: "wreath",
  allTypes: "clover",
  fullDay: "mode-almanac",
  fullDays30: "medal",
  royalWin: "crown",
};

export interface BadgeOptions {
  tier: Tier;
  /** The achievement's id, for its picture. */
  id: string;
  /** The avatar it unlocks, or "secret" for a hidden one not found yet. */
  icon: string;
  earned: boolean;
  size?: "s" | "m" | "l";
}

/** A medal for an achievement: decoration (its words are beside it). */
export function badgeArt(o: BadgeOptions): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = `badge t-${o.tier} ${o.earned ? "earned" : "locked"} badge-${o.size ?? "m"}`;
  wrap.setAttribute("aria-hidden", "true");
  wrap.append(picture(`badge-${o.tier}`, "badge-medal"));
  if (o.icon === "secret") {
    const mark = document.createElement("span");
    mark.className = "badge-glyph secret";
    mark.textContent = "?";
    wrap.append(mark);
  } else wrap.append(picture(medalPictures[o.id] ?? o.icon, "badge-glyph"));
  return wrap;
}

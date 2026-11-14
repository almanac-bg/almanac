// Badges: an achievement's medal, drawn with the other pictures (art/pictures.ts) in its tier's colour.
//
// The tier gives the medal its form, so it reads even without colour: common is a round coin, rare a hexagon, epic an
// eight-pointed star, legendary a sunburst with ribbons. The achievement's own picture fills its face: every achievement
// has one (medalPictures), apart from the avatar it unlocks, which is the game's rule (internal/play). Within a family
// the picture grows with the deed: a flame, a torch, a bonfire, a phoenix. A locked medal is grey, with a ring for how
// far along it is; a hidden one shows only a question mark.

import type { Tier } from "../ui.ts";
import { picture } from "./picture.ts";

const svgNS = "http://www.w3.org/2000/svg";

/** Each achievement's picture on its medal, by its id (art only: what it unlocks is the server's). */
export const medalPictures: Record<string, string> = {
  streak3: "flame",
  streak7: "torch",
  streak30: "bonfire",
  streak100: "phoenix",
  answers100: "book",
  answers1000: "books",
  fast: "bolt",
  lastSecond: "hourglass",
  duel1: "shield",
  duel10: "blades",
  duel50: "helmet",
  friend1: "heart",
  friends5: "hearts",
  friendWin: "knight",
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
};

export interface BadgeOptions {
  tier: Tier;
  /** The achievement's id, for its picture. */
  id: string;
  /** The avatar it unlocks, or "secret" for a hidden one not found yet. */
  icon: string;
  earned: boolean;
  /** How far along a locked one is, 0–1. */
  progress?: number;
  size?: "s" | "m" | "l";
}

/** The ring of a locked medal's progress. */
function ring(progress: number): SVGSVGElement {
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", "badge-ring");
  const c = 2 * Math.PI * 31;
  for (const [cls, dash] of [
    ["badge-track", ""],
    ["badge-done", `${(c * progress).toFixed(1)} ${c.toFixed(1)}`],
  ]) {
    const circle = document.createElementNS(svgNS, "circle");
    for (const [k, v] of Object.entries({
      cx: "32",
      cy: "32",
      r: "31",
      class: cls ?? "",
      transform: "rotate(-90 32 32)",
    }))
      circle.setAttribute(k, v);
    if (dash) circle.setAttribute("stroke-dasharray", dash);
    svg.append(circle);
  }
  return svg;
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
  const p = Math.max(0, Math.min(1, o.progress ?? 0));
  if (!o.earned && p > 0) wrap.append(ring(p));
  return wrap;
}

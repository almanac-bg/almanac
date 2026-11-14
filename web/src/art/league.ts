// League emblems: a mountain for each of the week's leagues, drawn with the other pictures (art/pictures.ts:
// Странджа's hills to Рила's snow and star), in the league's colour from the theme (--lg-*).

import { picture } from "./picture.ts";

/** A league's emblem (decoration: its name is beside it), by its tier (0 the lowest). */
export function leagueEmblem(tier: number, size: "s" | "m" | "l" = "m"): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = `emblem lg-${tier} emblem-${size}`;
  wrap.setAttribute("aria-hidden", "true");
  wrap.append(picture(`league-${tier}`));
  return wrap;
}

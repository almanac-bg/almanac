// Division emblems: a crest for each band of rating, drawn with the other pictures (art/pictures.ts: Бронз a plain
// shield, Сребро a chevron, Злато wings, Платина a star, Диамант a cut gem, Легенда a crowned shield with rays), in the
// division's colour from the theme (--div-*).

import { picture } from "./picture.ts";

export type DivisionID = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "legend";

/** A division's emblem (decoration: its name is beside it). */
export function emblem(d: DivisionID, size: "s" | "m" | "l" = "m"): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = `emblem d-${d} emblem-${size}`;
  wrap.setAttribute("aria-hidden", "true");
  wrap.append(picture(`division-${d}`));
  return wrap;
}

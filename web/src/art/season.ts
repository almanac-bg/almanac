// Season art: the medals of a season's podium — gold, silver, bronze — drawn with the other pictures
// (art/pictures.ts), in the divisions' metals.

import { picture } from "./picture.ts";

/** A season's name: its month and year, in lower case as Bulgarian writes months („Сезон ноември 2026“). */
export function seasonName(id: string): string {
  const [y = 2026, m = 1] = id.split("-").map(Number);
  const month = new Intl.DateTimeFormat("bg", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 15)),
  );
  return `${month} ${y}`;
}

/** The metal of a podium's place: 1 gold, 2 silver, 3 bronze. */
export const metal = (place: number) => (place === 1 ? "gold" : place === 2 ? "silver" : "bronze");

/** A podium's medal (place 1–3), won or still an empty place (decoration). */
export function podiumMedal(place: number, won: boolean, size: "m" | "s" = "m"): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = `season-medal d-${metal(place)}${won ? " earned" : ""}${size === "s" ? " s" : ""}`;
  wrap.setAttribute("aria-hidden", "true");
  wrap.append(picture("medal"));
  return wrap;
}

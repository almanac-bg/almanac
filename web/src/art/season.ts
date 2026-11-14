// Season art: the medals of a season's podium — gold, silver, bronze — generated, like the badges and emblems.

const svgNS = "http://www.w3.org/2000/svg";

function el(name: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(svgNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A season's name: its month and year, in lower case as Bulgarian writes months („Сезон ноември 2026“). */
export function seasonName(id: string): string {
  const [y = 2026, m = 1] = id.split("-").map(Number);
  const month = new Intl.DateTimeFormat("bg", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 15)),
  );
  return `${month} ${y}`;
}

/** A five-pointed star's points around a centre. */
export function starPoints(cx: number, cy: number, r: number): string {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = ((-90 + i * 36) * Math.PI) / 180;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return p.join(" ");
}

/** The metal of a podium's place: 1 gold, 2 silver, 3 bronze. */
export const metal = (place: number) => (place === 1 ? "gold" : place === 2 ? "silver" : "bronze");

/** A podium's medal (place 1–3), won or still an empty place (decoration). */
export function podiumMedal(place: number, won: boolean, size: "m" | "s" = "m"): HTMLElement {
  const svg = el("svg", { viewBox: "0 0 48 48", "aria-hidden": "true" });
  svg.append(
    el("path", { d: "M16 4 L24 18 L32 4", class: "medal-ribbon" }),
    el("circle", { cx: 24, cy: 29, r: 15, class: "season-medal-face" }),
    el("polygon", { points: starPoints(24, 29, 8), class: "season-medal-star" }),
  );
  const wrap = document.createElement("span");
  wrap.className = `season-medal d-${metal(place)}${won ? " earned" : ""}${size === "s" ? " s" : ""}`;
  wrap.setAttribute("aria-hidden", "true");
  wrap.append(svg);
  return wrap;
}

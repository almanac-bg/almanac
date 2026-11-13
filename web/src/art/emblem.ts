// Division emblems: a crest for each band of rating, generated in code like the medals (art/badge.ts).
//
// Each division has its own silhouette, so they read apart without colour: Бронз a plain shield; Сребро a shield
// with a chevron; Злато a shield with wings; Платина a shield with a star; Диамант a cut gem; Легенда a star shield
// under a crown, with rays. The colour of each comes from the theme (--div-*), in CSS.

const svgNS = "http://www.w3.org/2000/svg";

function el(name: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(svgNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export type DivisionID = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "legend";

const shield = "M32 8 L52 15 V31 C52 44 43 53 32 58 C21 53 12 44 12 31 V15 Z";

function star(cx: number, cy: number, r: number): string {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = ((-90 + i * 36) * Math.PI) / 180;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return p.join(" ");
}

function parts(d: DivisionID): SVGElement[] {
  const face = (path: string) => el("path", { d: path, class: "emblem-face" });
  const line = (path: string) => el("path", { d: path, class: "emblem-line" });
  switch (d) {
    case "bronze":
      return [face(shield), line("M32 17 V49")];
    case "silver":
      return [face(shield), line("M18 28 L32 38 L46 28")];
    case "gold":
      return [
        el("path", { d: "M14 20 C4 22 2 32 6 40 C10 34 13 31 16 30 Z", class: "emblem-wing" }),
        el("path", { d: "M50 20 C60 22 62 32 58 40 C54 34 51 31 48 30 Z", class: "emblem-wing" }),
        face(shield),
        line("M18 28 L32 38 L46 28"),
      ];
    case "platinum":
      return [face(shield), el("polygon", { points: star(32, 31, 11), class: "emblem-mark" })];
    case "diamond":
      return [
        face("M18 12 H46 L58 26 L32 58 L6 26 Z"),
        line("M6 26 H58 M18 12 L26 26 L32 58 L38 26 L46 12 M26 26 L32 12 L38 26"),
      ];
    case "legend":
      return [
        el("polygon", { points: star(32, 35, 30), class: "emblem-rays" }),
        face("M32 16 L50 22 V35 C50 46 42 53 32 57 C22 53 14 46 14 35 V22 Z"),
        el("path", { d: "M19 15 L23 5 L32 11 L41 5 L45 15 Z", class: "emblem-crown" }),
        el("polygon", { points: star(32, 35, 9), class: "emblem-mark" }),
      ];
  }
}

/** A division's emblem (decoration: its name is beside it). */
export function emblem(d: DivisionID, size: "s" | "m" | "l" = "m"): HTMLElement {
  const svg = el("svg", { viewBox: "0 0 64 64", "aria-hidden": "true" });
  svg.append(...parts(d));
  const wrap = document.createElement("span");
  wrap.className = `emblem d-${d} emblem-${size}`;
  wrap.setAttribute("aria-hidden", "true");
  wrap.append(svg);
  return wrap;
}

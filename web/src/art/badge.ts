// Badges: an achievement drawn as a medal, generated from its tier and its shape, in the game's colours.
//
// The tier gives the medal its form, so it reads even without colour: common is round, rare a hexagon, epic an
// eight-pointed star, legendary a sunburst with laurels. The shape of the achievement (the avatar it unlocks) sits in
// the middle. A locked one is drawn hollow, with a ring for how far along it is; a hidden one shows only a question
// mark.

import type { Tier } from "../ui.ts";

const svgNS = "http://www.w3.org/2000/svg";

function el(name: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(svgNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A regular polygon (or a star, with an inner radius) around the centre of a 64 × 64 box. */
function polygon(points: number, outer: number, inner = outer, turn = -90): string {
  const n = inner === outer ? points : points * 2;
  const p: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = inner === outer || i % 2 === 0 ? outer : inner;
    const a = ((turn + (360 / n) * i) * Math.PI) / 180;
    p.push(`${(32 + r * Math.cos(a)).toFixed(2)},${(32 + r * Math.sin(a)).toFixed(2)}`);
  }
  return p.join(" ");
}

/** The medal's form for a tier, as SVG with a class to colour it by (app.css: .medal-*). */
function medal(tier: Tier, cls: string): SVGElement[] {
  switch (tier) {
    case "common":
      return [el("circle", { cx: 32, cy: 32, r: 26, class: cls })];
    case "rare":
      return [el("polygon", { points: polygon(6, 28), class: cls })];
    case "epic":
      return [el("polygon", { points: polygon(8, 30, 23, -90), class: cls })];
    case "legendary":
      return [el("polygon", { points: polygon(16, 31, 24, -90), class: cls })];
  }
}

/** Laurels: two arcs of leaves along the bottom of a legendary medal. */
function laurels(): SVGElement[] {
  return ([1, -1] as const).map((side) =>
    el("path", { d: `M${32 + side * 6} 55 Q${32 + side * 22} 52 ${32 + side * 25} 36`, class: "medal-laurel" }),
  );
}

export interface BadgeOptions {
  tier: Tier;
  /** The shape in the middle (an avatar shape's name), or "secret" for a hidden one. */
  icon: string;
  earned: boolean;
  /** How far along a locked one is, 0–1. */
  progress?: number;
  size?: "s" | "m" | "l";
}

/** A medal for an achievement: decoration (its words are beside it). */
export function badgeArt(o: BadgeOptions): HTMLElement {
  const svg = el("svg", { viewBox: "0 0 64 64", class: "badge-medal", "aria-hidden": "true" });
  if (o.earned) {
    // The face in the tier's colour, a darker rim inside it, a light across the top: depth without a gradient,
    // all coloured in CSS from the theme.
    svg.append(...medal(o.tier, "medal-face"));
    svg.append(el("circle", { cx: 32, cy: 32, r: 18, class: "medal-rim" }));
    if (o.tier === "legendary") svg.append(...laurels());
    svg.append(el("path", { d: "M17 25 Q32 12 47 25", class: "medal-shine" }));
  } else {
    svg.append(...medal(o.tier, "medal-hollow"));
    const p = Math.max(0, Math.min(1, o.progress ?? 0));
    if (p > 0) {
      const c = 2 * Math.PI * 30;
      svg.append(
        el("circle", {
          cx: 32,
          cy: 32,
          r: 30,
          class: "medal-progress",
          "stroke-dasharray": `${(c * p).toFixed(1)} ${c.toFixed(1)}`,
          transform: "rotate(-90 32 32)",
        }),
      );
    }
  }
  const glyph = document.createElement("span");
  glyph.className = o.icon === "secret" ? "badge-glyph secret" : `badge-glyph av-${o.icon}`;
  if (o.icon === "secret") glyph.textContent = "?";
  const wrap = document.createElement("span");
  wrap.className = `badge t-${o.tier} ${o.earned ? "earned" : "locked"} badge-${o.size ?? "m"}`;
  wrap.setAttribute("aria-hidden", "true");
  wrap.append(svg, glyph);
  return wrap;
}

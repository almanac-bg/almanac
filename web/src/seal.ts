// The seal (печат) is a chapter's rank, drawn: a badge of its own, never the logo (the rosette's four petals). Its
// colour and its glyph are the chapter's; its silhouette is the rank, one change a rank, soft (a medal's scallops, a
// ribbon), never a gear's teeth; it reads at 24px, its smallest.
//
//   1 Бележка   an open ring
//   2 Страница  a solid disc
//   3 Тетрадка  six shallow scallops
//   4 Книга     the six scallops, a 2px ink ring inside them
//   5 Том       ten shallow scallops and a ribbon's tail
//   6 Летопис   the ten scallops and two tails
//   7 and up    Летопис with its number on a tab („Летопис · 2“), from 32px
//
// How far the chapter has come towards its next rank isn't on the seal: it's said beside it, over a slim bar of the way
// (ui.ts, standing), on Профил's seals, a chapter's page and card, and the result's line; on an avatar, nothing.
//
// This file only draws (the paths, as strings, on a 48 × 48 grid); ui.ts (seal) puts the chapter's glyph in its
// middle, and app.css colours it (.seal: --tv, the chapter's vivid; the inks from the tokens).

/** The six ranks a chapter's ink reaches, in order (DECISIONS.md, the direction). */
export const rankNames = ["Бележка", "Страница", "Тетрадка", "Книга", "Том", "Летопис"];

/** A rank's name: 1–6 by the list, then „Летопис · 2“ and on for each further hundred. */
export function rankName(rank: number): string {
  return rank <= 6 ? (rankNames[rank - 1] ?? "") : `Летопис · ${rank - 5}`;
}

const f = (v: number) => Math.round(v * 100) / 100;

/** A closed edge round (24, 22): `r(θ)` gives the radius at each angle, from the top, clockwise. */
function edge(r: (a: number) => number, steps = 240): string {
  let d = "";
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const R = r(a);
    d += `${i ? "L" : "M"}${f(24 + R * Math.sin(a))} ${f(cy - R * Math.cos(a))}`;
  }
  return `${d}Z`;
}

/** The seal's middle: a little over its centre, to leave room under it for a ribbon on the two highest ranks. */
const cy = 23;

const circle = (R: number) => `M${f(24 - R)} ${cy}a${R} ${R} 0 1 0 ${f(2 * R)} 0a${R} ${R} 0 1 0 ${f(-2 * R)} 0Z`;

/** Shallow scallops, `n` of them, `depth` deep from `R`: round bumps meeting in soft valleys. */
const scallop = (n: number, R: number, depth: number) =>
  edge((a) => R - depth + depth * Math.abs(Math.cos((n * a) / 2)) ** 0.7);

/** A ribbon's tail under the seal, cut in a V: on the left (`side` −1) or the right (1). */
const tail = (side: number) => {
  const x = (v: number) => f(24 + side * v);
  return `M${x(3)} 36L${x(11)} 36L${x(13.5)} 47.4L${x(9.2)} 44.4L${x(5.4)} 47.6Z`;
};

/** One painted part of a seal: a path and how it's painted (a fill or a stroke, in one of the seal's inks). */
export interface SealPart {
  d: string;
  fill?: "vivid" | "ink" | "core" | "none";
  stroke?: "vivid" | "ink" | "outline";
  width?: number;
}

/** Where the glyph goes: its box on the 48 grid. */
export const glyphBox = { x: 12.2, y: 11.2, size: 23.6 };

/** The parts of a rank's seal, back to front (the glyph goes on top of them, in glyphBox). */
export function sealParts(rank: number): SealPart[] {
  const r = Math.min(Math.max(rank, 1), 6);
  const parts: SealPart[] = [];
  let silhouette: string;
  if (r === 6) parts.push({ d: tail(-1), fill: "vivid" }, { d: tail(1), fill: "vivid" });
  if (r === 5) parts.push({ d: tail(1), fill: "vivid" });
  if (r === 1) {
    silhouette = circle(19.6);
    parts.push({ d: silhouette, fill: "none", stroke: "vivid", width: 2.6 });
  } else if (r === 2) {
    silhouette = circle(20.6);
    parts.push({ d: silhouette, fill: "vivid" });
  } else if (r <= 4) {
    silhouette = scallop(6, 21.4, 2.6);
    parts.push({ d: silhouette, fill: "vivid" });
    if (r === 4) parts.push({ d: circle(16), fill: "none", stroke: "ink", width: 2 });
  } else {
    silhouette = scallop(10, 21.4, 2.2);
    parts.push({ d: silhouette, fill: "vivid" });
  }
  // A fine outline in the chapter's deep colour by day, so a light chapter keeps its shape on white (the ribbon's
  // tails have their own).
  parts.push({ d: silhouette, fill: "none", stroke: "outline", width: 1 });
  if (r >= 5) parts.push({ d: tail(1), fill: "none", stroke: "outline", width: 1 });
  if (r === 6) parts.push({ d: tail(-1), fill: "none", stroke: "outline", width: 1 });
  // The core: the glyph on white.
  parts.push({ d: circle(13.2), fill: "core" });
  return parts;
}

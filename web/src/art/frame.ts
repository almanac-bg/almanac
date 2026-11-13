// Avatar frames: drawn around the avatar's rounded tile, generated in code like the medals and emblems.
//
// Each frame has its own drawing, coloured from the theme in CSS (.fr-*): a ring, a double ring, a ring of dots,
// flames along the top, laurel branches down the sides, gems at the corners, a halo with rays.

import { seasonHue } from "./season.ts";

const svgNS = "http://www.w3.org/2000/svg";

function el(name: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(svgNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// The tile sits at 8–56 in a 64 box (the frame's box is a third larger than the avatar); its corners round at 30%.
const tile = (inset: number) => {
  const s = 48 + 2 * inset;
  return { x: 8 - inset, y: 8 - inset, width: s, height: s, rx: s * 0.3 };
};

function parts(frame: string): SVGElement[] {
  switch (frame) {
    case "ring":
      return [el("rect", { ...tile(3), class: "frame-line" })];
    case "double":
      return [
        el("rect", { ...tile(2.5), class: "frame-line thin" }),
        el("rect", { ...tile(5.5), class: "frame-line thin" }),
      ];
    case "dots":
      return [el("rect", { ...tile(4), class: "frame-dots" })];
    case "flames": {
      const flames = [14, 24, 32, 40, 50].map((x, i) => {
        const h = i % 2 ? 7 : 10;
        return el("path", { d: `M${x - 4} 6 Q${x} ${6 - h} ${x + 4} 6 Q${x} 3 ${x - 4} 6Z`, class: "frame-flame" });
      });
      return [el("rect", { ...tile(3), class: "frame-line" }), ...flames];
    }
    case "laurel": {
      const leaves: SVGElement[] = [];
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          const y = 50 - i * 8;
          const x = 32 + side * (27 - Math.abs(i - 2) * 0.8);
          leaves.push(
            el("ellipse", {
              cx: x,
              cy: y,
              rx: 2.4,
              ry: 5,
              transform: `rotate(${side * (25 + i * 6)} ${x} ${y})`,
              class: "frame-leaf",
            }),
          );
        }
      }
      return leaves;
    }
    case "gem": {
      const gem = (cx: number, cy: number) =>
        el("polygon", {
          points: `${cx},${cy - 4.5} ${cx + 4},${cy} ${cx},${cy + 4.5} ${cx - 4},${cy}`,
          class: "frame-gem",
        });
      return [el("rect", { ...tile(3), class: "frame-line" }), gem(9, 9), gem(55, 9), gem(9, 55), gem(55, 55)];
    }
    case "season": {
      const stars = [
        [9, 9],
        [55, 9],
        [9, 55],
        [55, 55],
      ].map(([x = 0, y = 0]) => el("polygon", { points: starPoints(x, y, 4.5), class: "frame-gem" }));
      return [el("rect", { ...tile(3), class: "frame-line glow" }), ...stars];
    }
    case "halo": {
      const rays: SVGElement[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        rays.push(
          el("line", {
            x1: 32 + Math.cos(a) * 31,
            y1: 32 + Math.sin(a) * 31,
            x2: 32 + Math.cos(a) * 35,
            y2: 32 + Math.sin(a) * 35,
            class: "frame-ray",
          }),
        );
      }
      return [el("rect", { ...tile(3.5), class: "frame-line glow" }), ...rays];
    }
  }
  return [];
}

function starPoints(cx: number, cy: number, r: number): string {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = ((-90 + i * 36) * Math.PI) / 180;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return p.join(" ");
}

/** A frame for an avatar (decoration), or null for none. A season's frame ("season-YYYY-MM") is drawn in its
 * season's colour. */
export function frameArt(frame: string | undefined): SVGElement | null {
  if (!frame) return null;
  const season = frame.startsWith("season-") ? frame.slice(7) : "";
  const drawn = parts(season ? "season" : frame);
  if (!drawn.length) return null;
  const svg = el("svg", {
    viewBox: "0 0 64 64",
    class: `avatar-frame fr-${season ? "season" : frame}`,
    "aria-hidden": "true",
  });
  if (season) svg.style.setProperty("--frame", `hsl(${seasonHue(season)} 72% 62%)`);
  svg.append(...drawn);
  return svg;
}

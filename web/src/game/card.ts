// The card a day is shared with (DECISIONS.md, the direction: „The share“), drawn in the browser as it's shared: the
// mark and the name, the issue and its date, the ten tiles in their chapters' colours (filled right, half близо, hollow
// not) each with its glyph, and almanac.bg. Never an answer, never a name, never the streak. Always the day's colours,
// whatever the screen's: it's looked at elsewhere. The server draws it again for a link's preview (internal/card, in
// Go: change both together; its colours and glyphs are held equal to these in card.test.ts and card_test.go).

// It imports nothing that runs: what it needs comes with the call (the pictures, the date in words), so that it
// loads as a file of its own with nothing shared (cmd/build).
import type { Mark } from "./types.ts";

/** The chapters' vivid colours and deep ones, as app.css has them by day (card.test.ts holds them equal). */
export const vivid: Record<string, string> = {
  general: "#ffc21a",
  science: "#22ccc4",
  history: "#ff6b4a",
  geography: "#4b90ff",
  movies: "#e863e6",
  music: "#9a82ff",
  sports: "#ff9a2e",
  technology: "#a3db2e",
  literature: "#ff77ae",
  nature: "#33cf7a",
  mix: "#c9c4de",
  bulgaria: "#2ec4a0",
};

export const deep: Record<string, string> = {
  general: "#8a5d00",
  science: "#00777a",
  history: "#c33a1c",
  geography: "#1f5fd6",
  movies: "#a52ba6",
  music: "#5a43e0",
  sports: "#ad5300",
  technology: "#4c7700",
  literature: "#c42d6c",
  nature: "#0f8148",
  mix: "#4a4766",
  bulgaria: "#0b7a60",
};

const ink = "#16132b";
const ink3 = "#5d5a77";
const page = "#f3f4fa";
const gold = "#e0a81e";
const W = 1200;
const H = 630;

/** Mixes two colours (#rrggbb), `p` of the first. */
export function mix(a: string, b: string, p: number): string {
  const n = (h: string, i: number) => Number.parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  const c = [0, 1, 2].map((i) => Math.round(n(a, i) * p + n(b, i) * (1 - p)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** A chapter's art as a picture of its own (no stylesheet reaches into one): its paths with their inks set from its
 * tone, as app.css's .pic sets them by day. */
function glyphImage(paths: string, tone: string): Promise<HTMLImageElement> {
  const k = {
    k0: "#140f26",
    k1: mix(tone, "#140f26", 0.42),
    k2: mix(tone, "#140f26", 0.7),
    k3: tone,
    k4: mix(tone, "#ffffff", 0.72),
    k5: mix(tone, "#ffffff", 0.32),
  };
  const style = [
    ...Object.entries(k).map(([c, v]) => `.${c}{fill:${v}}`),
    `.kw{fill:#fff}.ks{fill:#140f26;opacity:.2}.kh{fill:#fff;opacity:.32}.kt{fill:${tone};opacity:.26}`,
    ".l0,.l1,.l2,.l3,.l4,.l5{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
    ...Object.entries(k).map(([c, v]) => `.${c.replace("k", "l")}{stroke:${v}}`),
  ].join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128"><style>${style}</style>${paths}</svg>`;
  return new Promise((done, fail) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = fail;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** A rectangle with round corners, as a path on the canvas. */
function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** The mark: the rosette, four petals, the gold one up and to the left (ui.ts, rosette). */
function rosette(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const petal = new Path2D("M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z");
  const scale = size / 54;
  for (const turn of [-45, 45, 135, 225]) {
    c.save();
    c.translate(x + size / 2, y + size / 2);
    c.scale(scale, scale);
    c.rotate((turn * Math.PI) / 180);
    c.translate(-32, -32);
    c.fillStyle = turn < 0 ? gold : ink;
    c.fill(petal);
    c.restore();
  }
}

/** How each of the day's ten is drawn on the card, in the issue's order (each mark in its question's place, so that a
 * tile keeps its chapter): right filled, близо half, wrong dashed, a question that counts for nobody (Mark.void)
 * dashed and empty, as the tiles on the screen are (ui.ts, tiles). */
export function cardTiles(marks: Mark[]): ("right" | "near" | "wrong" | "void")[] {
  return Array.from({ length: 10 }, (_, i) => {
    const m = marks[i];
    return m?.void ? "void" : m?.right ? "right" : m?.close ? "near" : "wrong";
  });
}

/** The day's card as a PNG (1200 × 630), one look in every theme, read at a chat's 300px: the mark and the name, „Брой
 * N“ big with its date, and the ten tiles two rows of five, each its chapter's colour with its glyph, filled right,
 * half близо, dashed and hollow wrong (so they part in grey too), and almanac.bg. `topics` in the issue's order,
 * `marks` how each went, `date` the issue's in words, `pictures` the game's art. */
export async function drawCard(
  issue: number,
  date: string,
  marks: Mark[],
  topics: string[],
  pictures: Record<string, string>,
): Promise<File | null> {
  await Promise.all(
    ['900 100px "Sofia Sans Extra Condensed"', '900 40px "Sofia Sans"', '800 30px "Sofia Sans"'].map((f) =>
      document.fonts?.load(f, "Брой 0123456789 АЛМАНАХ almanac.bg ноември").catch(() => []),
    ),
  );
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.fillStyle = page;
  c.fillRect(0, 0, W, H);
  // The mark and the name.
  rosette(c, 64, 58, 52);
  c.fillStyle = ink;
  c.font = '900 34px "Sofia Sans"';
  c.letterSpacing = "7px";
  c.textBaseline = "middle";
  c.fillText("АЛМАНАХ", 134, 86);
  c.letterSpacing = "0px";
  // The issue: „Брой“, its number set big, and the date.
  c.textBaseline = "alphabetic";
  c.font = '900 56px "Sofia Sans"';
  c.fillText("Брой", 64, 238);
  // Smaller, should it ever run into the tiles (internal/card does the same).
  c.font = '900 250px "Sofia Sans Extra Condensed"';
  const wide = c.measureText(String(issue)).width;
  if (wide > 370) c.font = `900 ${(250 * 370) / wide}px "Sofia Sans Extra Condensed"`;
  c.fillText(String(issue), 56, 456);
  c.font = '800 44px "Sofia Sans"';
  c.fillText(date, 64, 530);
  c.fillStyle = ink3;
  c.font = '800 34px "Sofia Sans"';
  c.fillText("almanac.bg", 64, 590);
  // The ten tiles, two rows of five.
  const size = 120;
  const gap = 18;
  const x0 = W - 64 - 5 * size - 4 * gap;
  const y0 = (H - 2 * size - gap) / 2;
  const art = await Promise.all(
    topics.map((t) => glyphImage(pictures[`topic-${t}`] ?? "", vivid[t] ?? "#c9c4de").catch(() => null)),
  );
  const states = cardTiles(marks);
  for (let i = 0; i < 10; i++) {
    const t = topics[i] ?? "mix";
    const state = states[i];
    const x = x0 + (i % 5) * (size + gap);
    const y = y0 + Math.floor(i / 5) * (size + gap);
    const r = size * 0.24;
    const tone = vivid[t] ?? "#c9c4de";
    const edge = deep[t] ?? ink;
    const right = state === "right";
    const near = state === "near";
    const empty = state === "void";
    c.fillStyle = "#fff";
    rounded(c, x, y, size, size, r);
    c.fill();
    if (right) {
      c.fillStyle = tone;
      rounded(c, x, y, size, size, r);
      c.fill();
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(x + size / 2, y + size / 2, size * 0.37, 0, Math.PI * 2);
      c.fill();
    } else if (near) {
      c.save();
      rounded(c, x, y, size, size, r);
      c.clip();
      c.fillStyle = tone;
      c.fillRect(x, y, size / 2, size);
      c.restore();
    }
    if (!right) {
      // A void one's dashes in the page's grey: it counts for nobody, nothing of its chapter.
      c.strokeStyle = empty ? ink3 : edge;
      c.lineWidth = 6;
      c.setLineDash(near ? [] : [14, 9]);
      rounded(c, x + 3, y + 3, size - 6, size - 6, r - 3);
      c.stroke();
      c.setLineDash([]);
    }
    const img = empty ? null : art[i];
    if (img) {
      const g = right ? size * 0.64 : size * 0.6;
      c.globalAlpha = right || near ? 1 : 0.45;
      c.drawImage(img, x + (size - g) / 2, y + (size - g) / 2, g, g);
      c.globalAlpha = 1;
    }
  }
  return new Promise<File | null>((done) =>
    canvas.toBlob((b) => done(b ? new File([b], `almanah-${issue}.png`, { type: "image/png" }) : null), "image/png"),
  );
}

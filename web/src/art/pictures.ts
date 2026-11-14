// Pictures: the game's illustrations — the avatars, the topics, the ways to play, the avatars' frames, the divisions'
// emblems and the season's medal — drawn by hand as paths on a 64 × 64 grid, in one style, so that they belong
// together (web/DESIGN.md, Pictures).
//
// The style: flat shapes with depth, no outlines, lit from the top left. Every picture is painted from one ramp of
// its tone (the topic's, the avatar's, the mode's, the frame's, the tier's) with the night ink and white, so a
// picture always sits in the colours around it and follows the theme. The inks are classes coloured in app.css
// (.pic):
//
//   k0 night ink · k1 deep · k2 shade · k3 the tone itself · k4 light · k5 pale · kw white
//   ks a shadow over what's below · kh a light over it · kt a tint of the tone (a ground behind a picture)
//   l0–l5 the same inks as strokes (round ends, no fill)
//
// This module is loaded on its own after the game starts (art/picture.ts), so its weight never holds up the first
// screen. It imports nothing, so that it stays one file of its own.

type Layer = [ink: string, d: string, attrs?: string];

const n = (v: number) => Math.round(v * 100) / 100;
/** A circle as a path. */
const C = (x: number, y: number, r: number) =>
  `M${n(x - r)} ${n(y)}a${r} ${r} 0 1 0 ${n(2 * r)} 0a${r} ${r} 0 1 0 ${n(-2 * r)} 0Z`;
/** An ellipse as a path. */
const E = (x: number, y: number, rx: number, ry: number) =>
  `M${n(x - rx)} ${n(y)}a${rx} ${ry} 0 1 0 ${n(2 * rx)} 0a${rx} ${ry} 0 1 0 ${n(-2 * rx)} 0Z`;
/** Both sides of a symmetric part: `f` draws one, with x(dx) measured from the middle; it's drawn again mirrored. */
const both = (f: (x: (dx: number) => number) => string) => f((dx) => n(32 + dx)) + f((dx) => n(32 - dx));
const at = (cx: number, cy: number, r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return `${n(cx + r * Math.cos(a))} ${n(cy + r * Math.sin(a))}`;
};
/** A star of `points` points, outer radius R and inner r, its first point straight up. */
const star = (cx: number, cy: number, R: number, r: number, points = 5) => {
  let d = "";
  for (let i = 0; i < points * 2; i++) d += `${i ? "L" : "M"}${at(cx, cy, i % 2 ? r : R, -90 + (180 / points) * i)}`;
  return `${d}Z`;
};
/** A five-pointed star cut into facets: the lit half of each point, then the half in shade. */
const facets = (cx: number, cy: number, R: number, r: number): [string, string] => {
  let lit = "";
  let shade = "";
  for (let i = 0; i < 5; i++) {
    const tip = -90 + 72 * i;
    lit += `M${cx} ${cy}L${at(cx, cy, R, tip)}L${at(cx, cy, r, tip + 36)}Z`;
    shade += `M${cx} ${cy}L${at(cx, cy, r, tip - 36)}L${at(cx, cy, R, tip)}Z`;
  }
  return [lit, shade];
};
/** A four-pointed sparkle. */
const sparkle = (cx: number, cy: number, R: number) => {
  const k = R * 0.16;
  return `M${cx} ${n(cy - R)}Q${n(cx + k)} ${n(cy - k)} ${n(cx + R)} ${cy}Q${n(cx + k)} ${n(cy + k)} ${cx} ${n(cy + R)}Q${n(cx - k)} ${n(cy + k)} ${n(cx - R)} ${cy}Q${n(cx - k)} ${n(cy - k)} ${cx} ${n(cy - R)}Z`;
};
/** Spikes along an arc, from one angle to another (a hedgehog's quills, a sun's rays). */
const spikes = (cx: number, cy: number, R: number, r: number, from: number, to: number, count: number) => {
  const step = (to - from) / count;
  let d = `M${at(cx, cy, r, from)}`;
  for (let i = 0; i < count; i++)
    d += `L${at(cx, cy, R, from + step * (i + 0.5))}L${at(cx, cy, r, from + step * (i + 1))}`;
  return `${d}L${cx} ${cy}Z`;
};
/** Rays around a centre: thin wedges from r1 out to r2. */
const rays = (cx: number, cy: number, r1: number, r2: number, count: number, half: number, turn = -90) => {
  let d = "";
  for (let i = 0; i < count; i++) {
    const a = turn + (360 / count) * i;
    d += `M${at(cx, cy, r1, a - half)}L${at(cx, cy, r2, a)}L${at(cx, cy, r1, a + half)}Z`;
  }
  return d;
};
/** A soft shadow under a shape: the same path, set down and right a little. */
const lift = (d: string, dy = 2.5): Layer => ["ks", d, `transform="translate(1 ${dy})"`];
/** Eyes: a dark eye on each side with a glint of light. */
const eyes = (dx: number, y: number, r: number): Layer[] => [
  ["k0", both((x) => C(x(dx), y, r))],
  ["kw", both((x) => C(n(x(dx) + r * 0.35), n(y - r * 0.4), n(r * 0.36)))],
];
const shoulders = "M7 66C8 54 19 48 32 48C45 48 56 54 57 66Z";
/** Laurel branches up both sides of a circle, from `from` degrees (the bottom) to `to`, leaves alternating in two
 * inks; the left branch is drawn, then the right mirrors it. */
const laurel = (cx: number, cy: number, r: number, from: number, to: number, count: number, leaf = 5): Layer[] => {
  let stems = "";
  const leaves: Layer[] = [];
  for (const s of [-1, 1]) {
    // The left branch climbs clockwise from the bottom; the right one is its mirror.
    const angle = (t: number) => (s < 0 ? t : 180 - t);
    stems += `M${at(cx, cy, r, angle(from))}A${r} ${r} 0 0 ${s < 0 ? 1 : 0} ${at(cx, cy, r, angle(to))}`;
    for (let i = 0; i < count; i++) {
      const t = from + ((to - from) * (i + 0.6)) / count;
      const out = i % 2 ? 1 : -1; // leaves alternate outside and inside the stem
      const [x = 0, y = 0] = at(cx, cy, r + out * leaf * 0.45, angle(t))
        .split(" ")
        .map(Number);
      const along = angle(t) + s * -90; // the way the branch grows, upward
      const turn = n(along + s * out * 26);
      // Each leaf turns on its own centre, so each is a path of its own.
      leaves.push([
        i % 2 ? "k4" : "k3",
        `M${n(x - leaf)} ${y}Q${x} ${n(y - leaf * 0.62)} ${n(x + leaf)} ${y}Q${x} ${n(y + leaf * 0.62)} ${n(x - leaf)} ${y}Z`,
        `transform="rotate(${turn} ${x} ${y})"`,
      ]);
    }
  }
  return [["l2", stems, 'stroke-width="1.4"'], ...leaves];
};
/** The avatar's tile (8–56 in a frame's box), grown by `inset`, as a path: its corners round at 30%. */
const tile = (inset: number) => {
  const x = 8 - inset;
  const s = 48 + 2 * inset;
  const r = n(s * 0.3);
  return `M${n(x + r)} ${n(x)}H${n(x + s - r)}A${r} ${r} 0 0 1 ${n(x + s)} ${n(x + r)}V${n(x + s - r)}A${r} ${r} 0 0 1 ${n(x + s - r)} ${n(x + s)}H${n(x + r)}A${r} ${r} 0 0 1 ${n(x)} ${n(x + s - r)}V${n(x + r)}A${r} ${r} 0 0 1 ${n(x + r)} ${n(x)}Z`;
};
/** Points evenly along the tile's outline (grown by `inset`), clockwise from the top middle. */
const around = (inset: number, count: number, shift = 0): [number, number][] => {
  const x0 = 8 - inset;
  const s = 48 + 2 * inset;
  const r = s * 0.3;
  const flat = s - 2 * r;
  const arc = (Math.PI * r) / 2;
  const corners: [number, number, number][] = [
    [x0 + s - r, x0 + r, -90],
    [x0 + s - r, x0 + s - r, 0],
    [x0 + r, x0 + s - r, 90],
    [x0 + r, x0 + r, 180],
  ];
  const sides: [number, number, number, number][] = [
    [x0 + r, x0, 1, 0],
    [x0 + s, x0 + r, 0, 1],
    [x0 + s - r, x0 + s, -1, 0],
    [x0, x0 + s - r, 0, -1],
  ];
  const total = 4 * (flat + arc);
  const out: [number, number][] = [];
  for (let k = 0; k < count; k++) {
    let d = (((k + shift) / count) * total + flat / 2) % total;
    for (let i = 0; i < 4; i++) {
      const [sx, sy, dx, dy] = sides[i] as [number, number, number, number];
      if (d <= flat) {
        out.push([n(sx + dx * d), n(sy + dy * d)]);
        break;
      }
      d -= flat;
      if (d <= arc) {
        const [ccx, ccy, a0] = corners[i] as [number, number, number];
        const a = ((a0 + (d / arc) * 90) * Math.PI) / 180;
        out.push([n(ccx + r * Math.cos(a)), n(ccy + r * Math.sin(a))]);
        break;
      }
      d -= arc;
    }
  }
  return out;
};
/** A tongue of flame standing on (x, y): h tall, w wide each side of its foot, its tip leaning `lean` sideways. */
const flame = (x: number, y: number, h: number, w: number, lean = 0) => {
  const tx = n(x + lean);
  return `M${n(x - w)} ${y}C${n(x - w * 1.2)} ${n(y - h * 0.5)} ${n(tx - w * 0.5)} ${n(y - h * 0.62)} ${tx} ${n(y - h)}C${n(tx + w * 0.4)} ${n(y - h * 0.62)} ${n(x + w * 1.2)} ${n(y - h * 0.5)} ${n(x + w)} ${y}Q${x} ${n(y + w * 0.6)} ${n(x - w)} ${y}Z`;
};
/** A cut gem: a rhombus in four facets, lit from the top left. */
const gem = (x: number, y: number, r: number): Layer[] => {
  const t = `${x} ${n(y - r)}`;
  const rt = `${n(x + r * 0.8)} ${y}`;
  const b = `${x} ${n(y + r)}`;
  const lf = `${n(x - r * 0.8)} ${y}`;
  const c = `${x} ${n(y - r * 0.1)}`;
  return [
    ["ks", `M${t}L${rt}L${b}L${lf}Z`, 'transform="translate(0.6 1.2)"'],
    ["k5", `M${t}L${c}L${lf}Z`],
    ["k3", `M${t}L${rt}L${c}Z`],
    ["k4", `M${lf}L${c}L${b}Z`],
    ["k2", `M${c}L${rt}L${b}Z`],
  ];
};

// ---- Avatars: nine animals everyone has, and fifteen emblems that achievements unlock. Each is drawn over a tile in
// its tone (k3), so it's painted in the ramp's darker and lighter inks. The animals are portraits, cut at the tile's
// bottom edge; the emblems stand in the middle.

const avatars: Record<string, Layer[]> = {
  fox: [
    ["k1", shoulders],
    ["k5", "M25 66C25.5 57 28.5 52.5 32 52.5C35.5 52.5 38.5 57 39 66Z"],
    ["k1", both((x) => `M${x(5.5)} 24L${x(16.5)} 7.5Q${x(19.5)} 6 ${x(20.5)} 9.5L${x(21.5)} 29Z`)],
    ["k0", both((x) => `M${x(9.5)} 22.5L${x(16)} 12.5Q${x(17.6)} 11.6 ${x(18)} 13.6L${x(18.6)} 25Z`)],
    [
      "k2",
      "M32 53.5C28 53.5 23 49.5 19 44.5L12 37C11 28 19 19.5 32 19.5C45 19.5 53 28 52 37L45 44.5C41 49.5 36 53.5 32 53.5Z",
    ],
    ["kh", "M23.5 24C27 21.6 37 21.6 40.5 24C37.4 26.4 34.2 30 32 34.5C29.8 30 26.6 26.4 23.5 24Z"],
    [
      "k5",
      "M12 37C17 35 23 36.5 27 40C29.5 42.3 31 43.6 32 43.6C33 43.6 34.5 42.3 37 40C41 36.5 47 35 52 37L45 44.5C41 49.5 36 53.5 32 53.5C28 53.5 23 49.5 19 44.5Z",
    ],
    ["k0", both((x) => `M${x(4.6)} 33.6Q${x(8.2)} 29.4 ${x(12.4)} 31.8Q${x(9)} 36.2 ${x(4.6)} 33.6Z`)],
    ["kw", both((x) => C(x(9.4), 32.2, 0.8))],
    ["k0", "M28.8 48.6Q32 46.6 35.2 48.6Q34.2 51.6 32 51.8Q29.8 51.6 28.8 48.6Z"],
  ],
  bear: [
    ["k1", shoulders],
    ["k2", both((x) => C(x(13.5), 20.5, 6.8))],
    ["k1", both((x) => C(x(13.5), 21, 3.6))],
    ["k2", E(32, 34, 17.5, 16)],
    ["kh", "M20 27C22 22 27 19.5 32 19.5C27.5 21.5 24.5 24.5 23 28.5Z"],
    ["k4", E(32, 41.5, 8.8, 7.2)],
    ["k0", "M28.2 38.2Q32 36.3 35.8 38.2Q34.7 41.7 32 41.9Q29.3 41.7 28.2 38.2Z"],
    ["l0", "M32 42V44.6M29.2 45.2Q32 47.6 34.8 45.2", 'stroke-width="1.5"'],
    ...eyes(7.6, 31, 2.2),
  ],
  cat: [
    ["k1", shoulders],
    ["k2", both((x) => `M${x(5)} 22.5L${x(15.5)} 8.5Q${x(18.5)} 7 ${x(19)} 10.5L${x(18.5)} 28Z`)],
    ["k4", both((x) => `M${x(8.6)} 21.8L${x(14.8)} 13.2Q${x(16.3)} 12.6 ${x(16.4)} 14.2L${x(16.2)} 24.5Z`)],
    [
      "k2",
      "M32 52.5C21 52.5 13.5 46.5 13.5 37.5C13.5 27 21.5 20.5 32 20.5C42.5 20.5 50.5 27 50.5 37.5C50.5 46.5 43 52.5 32 52.5Z",
    ],
    ["k1", "M32 21.5L30.4 27.6L32 29.4L33.6 27.6ZM26.4 22.2L25.8 26.4L27.6 27ZM37.6 22.2L38.2 26.4L36.4 27Z"],
    ["k5", C(29, 42.8, 4.7) + C(35, 42.8, 4.7)],
    ["k4", both((x) => E(x(8), 34, 3.8, 4))],
    ["k0", both((x) => E(x(8), 34, 1.25, 3.2))],
    ["kw", both((x) => C(n(x(8) + 1.4), 32.4, 0.8))],
    ["k1", "M29.6 39.2Q32 38.3 34.4 39.2L32 42Z"],
    ["l5", both((x) => `M${x(7.5)} 42.6L${x(18)} 41M${x(7.5)} 45L${x(17.5)} 47`), 'stroke-width="1"'],
  ],
  hare: [
    ["k1", shoulders],
    ["k2", both((x) => `M${x(3.5)} 27C${x(1.5)} 15 ${x(3)} 3 ${x(9)} 2.5C${x(15)} 2 ${x(15.5)} 14 ${x(11.5)} 27Z`)],
    ["k4", both((x) => `M${x(6)} 24.5C${x(5)} 15 ${x(6)} 7 ${x(9)} 6.5C${x(12)} 6.5 ${x(12.5)} 15 ${x(10)} 24.5Z`)],
    ["k2", E(32, 38.5, 15.5, 14.5)],
    ["kh", "M20 33C21.5 28 26 25 31 24.5C27 27 24 30 23 34Z"],
    ["k5", E(27.4, 44.5, 5.7, 4.5) + E(36.6, 44.5, 5.7, 4.5)],
    ["k1", "M29.8 40.6Q32 39.5 34.2 40.6Q33 42.9 32 42.9Q31 42.9 29.8 40.6Z"],
    ["kw", "M30.6 47H33.4V49.6Q32 50.4 30.6 49.6Z"],
    ...eyes(7.2, 35, 2.2),
  ],
  hedgehog: [
    ["k1", spikes(32, 40, 28, 19, 160, 380, 13)],
    ["k2", E(32, 41, 20, 17)],
    ["k1", shoulders],
    ["k5", "M19 40.5C19 32 25 28 32 28C39 28 45 32 45 40.5C45 46.5 38.5 51.5 32 56C25.5 51.5 19 46.5 19 40.5Z"],
    ["k4", both((x) => E(x(9.2), 45.5, 2.8, 1.7))],
    ["k0", C(32, 54.2, 2.7)],
    ...eyes(6.2, 38.5, 2.1),
  ],
  dog: [
    ["k1", shoulders],
    ["k2", "M32 20C42 20 48 26.5 48 35C48 44.5 41.5 52.5 32 52.5C22.5 52.5 16 44.5 16 35C16 26.5 22 20 32 20Z"],
    ["kh", "M19 30C20 25 24.5 21.5 30 21C26 23.5 22.5 26.5 21.5 31Z"],
    ["k1", E(38.6, 31, 6, 5.6)],
    [
      "k1",
      both(
        (x) =>
          `M${x(9.5)} 21.5C${x(16)} 19 ${x(21.5)} 22 ${x(22)} 28.5C${x(22.5)} 35.5 ${x(20.5)} 42.5 ${x(17)} 44.5C${x(13.5)} 46 ${x(12)} 40.5 ${x(12)} 35C${x(12)} 30 ${x(10.5)} 26 ${x(9.5)} 21.5Z`,
      ),
    ],
    ["k5", E(32, 43.2, 9.2, 7.6)],
    ["k4", "M30.4 46.4H33.6V49.4Q33.6 51.2 32 51.2Q30.4 51.2 30.4 49.4Z"],
    ["k0", "M28.2 39.2Q32 37.1 35.8 39.2Q34.9 42.7 32 42.9Q29.1 42.7 28.2 39.2Z"],
    ["l0", "M32 42.9V45.2M28.4 45.4Q30.4 47.8 32 45.4Q33.6 47.8 35.6 45.4", 'stroke-width="1.4"'],
    ...eyes(6.6, 32, 2.2),
  ],
  deer: [
    ["k1", shoulders],
    ["k4", C(17, 58, 1.7) + C(22.5, 53.5, 1.4) + C(44.5, 55, 1.7) + C(48, 60.5, 1.4) + C(14, 63, 1.3)],
    [
      "l1",
      both(
        (x) =>
          `M${x(6)} 21C${x(8)} 15 ${x(10)} 10 ${x(10)} 3M${x(9)} 12.5C${x(13)} 11.5 ${x(16)} 8.5 ${x(17)} 4.5M${x(9.7)} 7.5C${x(7.4)} 6.5 ${x(5.8)} 5 ${x(5.2)} 2.5`,
      ),
      'stroke-width="2.8"',
    ],
    [
      "k2",
      both((x) => `M${x(8)} 25.5C${x(13)} 19.5 ${x(20)} 19 ${x(24.5)} 22C${x(21)} 27.5 ${x(14)} 29.5 ${x(8)} 28.5Z`),
    ],
    [
      "k4",
      both(
        (x) =>
          `M${x(10.5)} 26.3C${x(14.2)} 22.6 ${x(18.4)} 22 ${x(21.4)} 23C${x(18.4)} 26.2 ${x(14.4)} 27.2 ${x(10.5)} 27.3Z`,
      ),
    ],
    ["k2", "M32 19C40 19 44.5 25 43.5 33C42.5 41 38 51 32 53C26 51 21.5 41 20.5 33C19.5 25 24 19 32 19Z"],
    ["kh", E(32, 26.5, 4, 5)],
    ["k4", E(32, 46, 7, 6.6)],
    ["k0", E(32, 47.3, 3.7, 2.7)],
    ...eyes(5.6, 33, 2.1),
  ],
  stork: [
    [
      "k5",
      "M14 66C15 54 20 44 24.5 36C27.5 30.5 26.5 24 29.5 18.5C32.5 13 40 12.5 43 17C45.5 21 43 25.5 40.5 29C36.5 35 37 45 44 54C47 58 49 62 50 66Z",
    ],
    ["k0", "M7 66C8 58 12 53 18.5 51.5C24 55.5 26.5 60.5 27 66Z"],
    ["l1", "M12 61L17 56M16 64L21 58.5", 'stroke-width="1.2"'],
    ["ks", "M40.5 29C36.5 35 37 45 44 54C47 58 49 62 50 66H44C41 58 33 48 34.5 37C35 33 37.5 30.5 40.5 29Z"],
    ["k1", "M41.5 15.5L61 24.4Q61.6 25.6 60.4 25.7L42 21.8Z"],
    ["k0", C(36.8, 17.6, 2)],
    ["kw", C(37.5, 16.9, 0.65)],
  ],
  frog: [
    ["k1", "M9 66C9 60 16 56.5 32 56.5C48 56.5 55 60 55 66Z"],
    ["k2", both((x) => C(x(12), 27, 9.2))],
    ["k2", "M7 46C7 35 17 30 32 30C47 30 57 35 57 46C57 56.5 46 62 32 62C18 62 7 56.5 7 46Z"],
    ["kh", "M13 38C16 33.5 23 31.5 31 31.5C24 33 18 35.5 15.5 40Z"],
    ["k5", both((x) => C(x(12), 26.5, 6.3))],
    ["k0", both((x) => C(x(11.3), 27, 3.4))],
    ["kw", both((x) => C(x(10.2), 25.6, 1.1))],
    ["k4", both((x) => E(x(19), 47.5, 3.4, 2.2))],
    ["k1", both((x) => C(x(3), 40.5, 1))],
    ["l1", "M17 47Q32 55.5 47 47", 'stroke-width="2.2"'],
  ],

  flame: [
    lift(
      "M32 6C34 15 46 21 46 37C46 47 40 54 32 54C24 54 18 47 18 38C18 31 21 26 25 22C25.5 27 27.5 30 30.5 31C29 24 29 14 32 6Z",
    ),
    [
      "k4",
      "M32 6C34 15 46 21 46 37C46 47 40 54 32 54C24 54 18 47 18 38C18 31 21 26 25 22C25.5 27 27.5 30 30.5 31C29 24 29 14 32 6Z",
    ],
    ["ks", "M32 6C34 15 46 21 46 37C46 47 40 54 32 54C38 50 41.5 44 40.5 36C39.5 26 33 18 32 6Z"],
    [
      "k5",
      "M32 22C33.5 29 41 32 41 41C41 47 37 51 32 51C27 51 23 47 23 42C23 37 25.5 34 28 32C28.5 36 30 37.5 32 38C31 33 30.5 27 32 22Z",
    ],
    [
      "kw",
      "M32 36C33 40 36.5 41.5 36.5 45.5C36.5 48.5 34.5 50.5 32 50.5C29.5 50.5 27.5 48.5 27.5 45.5C27.5 42.5 30.5 40.5 32 36Z",
    ],
    ["k5", C(15, 21, 1.6) + C(49.5, 15, 1.3) + C(51, 27, 1)],
  ],
  book: [
    lift("M5 22C14 19.5 24 19.5 32 23.5C40 19.5 50 19.5 59 22V53C50 50.5 40 50.5 32 54.5C24 50.5 14 50.5 5 53Z"),
    ["k1", "M5 22C14 19.5 24 19.5 32 23.5C40 19.5 50 19.5 59 22V53C50 50.5 40 50.5 32 54.5C24 50.5 14 50.5 5 53Z"],
    ["kw", "M9 17.5C17.5 15.5 26 16.5 31 20.5V49.5C26 46 17.5 45 9 47Z"],
    ["k5", "M55 17.5C46.5 15.5 38 16.5 33 20.5V49.5C38 46 46.5 45 55 47Z"],
    [
      "l4",
      "M13.5 23.5C18 22.6 23 23 27 25M13.5 29C18 28.1 23 28.5 27 30.5M13.5 34.5C18 33.6 23 34 27 36M37 25C41 23 46 22.6 50.5 23.5M37 30.5C41 28.5 46 28.1 50.5 29M37 36C41 34 46 33.6 50.5 34.5",
      'stroke-width="1.6"',
    ],
    ["k0", "M41 46.4V59L44 56L47 59V45.8Z"],
  ],
  bolt: [
    lift("M36.5 4L13.5 36.5H28.5L24.5 60L50.5 26H35.5L41.5 4Z"),
    ["k4", "M36.5 4L13.5 36.5H28.5L24.5 60L50.5 26H35.5L41.5 4Z"],
    ["k5", "M36.5 4L13.5 36.5H28.5L24.5 60L32.5 33H23Z"],
    ["kw", "M35.3 7.2L18.5 31.5H21.4L36.6 9Z"],
  ],
  shield: [
    lift("M32 6L52 12.5V30C52 43 43.5 52.5 32 58C20.5 52.5 12 43 12 30V12.5Z"),
    ["k1", "M32 6L52 12.5V30C52 43 43.5 52.5 32 58C20.5 52.5 12 43 12 30V12.5Z"],
    ["k5", "M32 11L47.5 16V30C47.5 40.5 41 48.5 32 53C23 48.5 16.5 40.5 16.5 30V16Z"],
    ["k4", "M32 11L47.5 16V30C47.5 40.5 41 48.5 32 53Z"],
    ["k1", "M21 30.5L32 38.5L43 30.5V36L32 44L21 36Z"],
    ["k1", star(32, 23, 5.2, 2.2)],
  ],
  heart: [
    lift(
      "M32 55C32 55 8 41 8 24.5C8 16 14 10 21.5 10C26.5 10 30 13 32 17C34 13 37.5 10 42.5 10C50 10 56 16 56 24.5C56 41 32 55 32 55Z",
    ),
    [
      "k5",
      "M32 55C32 55 8 41 8 24.5C8 16 14 10 21.5 10C26.5 10 30 13 32 17C34 13 37.5 10 42.5 10C50 10 56 16 56 24.5C56 41 32 55 32 55Z",
    ],
    ["k4", "M32 17C34 13 37.5 10 42.5 10C50 10 56 16 56 24.5C56 41 32 55 32 55Z"],
    ["kw", E(19, 20, 3.4, 2.2), 'transform="rotate(-38 19 20)"'],
  ],
  star: (() => {
    const [lit, shade] = facets(32, 33.5, 27, 11.5);
    return [lift(star(32, 33.5, 27, 11.5)), ["k5", lit], ["k4", shade]] as Layer[];
  })(),
  target: [
    lift(C(29, 35, 24)),
    ["k5", C(29, 35, 24)],
    ["k1", C(29, 35, 18.5)],
    ["k5", C(29, 35, 13)],
    ["k1", C(29, 35, 7.5)],
    ["k4", C(29, 35, 3)],
    ["l0", "M30 34L52 12", 'stroke-width="2.8"'],
    ["k0", "M52 12L50.4 4.6L56 9.2ZM52 12L59.4 13.6L54.8 8Z"],
  ],
  compass: [
    lift(C(32, 34, 24.5)),
    ["l1", C(32, 6.6, 3), 'stroke-width="2.6"'],
    ["k1", C(32, 34, 24.5)],
    ["k5", C(32, 34, 20)],
    ["l2", "M32 16.5V20M32 48V51.5M14.5 34H18M46 34H49.5", 'stroke-width="2.2"'],
    ["k0", "M32 18L37.6 34H26.4Z", 'transform="rotate(28 32 34)"'],
    ["k4", "M32 50L37.6 34H26.4Z", 'transform="rotate(28 32 34)"'],
    ["k1", C(32, 34, 3)],
    ["kw", C(32, 34, 1.3)],
  ],
  owl: [
    ["k1", "M9 66C9 52 18 44 32 44C46 44 55 52 55 66Z"],
    ["k2", both((x) => `M${x(8)} 16L${x(17.5)} 5.5L${x(18.5)} 20Z`)],
    ["k2", "M32 12C45 12 52 21 52 33C52 46 44 57 32 57C20 57 12 46 12 33C12 21 19 12 32 12Z"],
    [
      "k1",
      both((x) => `M${x(17)} 31C${x(23)} 39 ${x(22.5)} 51 ${x(15.5)} 57.5C${x(12.5)} 51 ${x(12)} 41 ${x(17)} 31Z`),
    ],
    ["k4", "M23 47C23 42.5 27 40.5 32 40.5C37 40.5 41 42.5 41 47C41 52.5 37 57 32 57C27 57 23 52.5 23 47Z"],
    ["l2", "M27 46.6L29 48.6L31 46.6M33 46.6L35 48.6L37 46.6M30 51.6L32 53.6L34 51.6", 'stroke-width="1.3"'],
    ["k4", both((x) => C(x(9), 30, 9.4))],
    ["k5", both((x) => C(x(9), 30, 6.6))],
    ["k3", both((x) => C(x(9), 30, 4.2))],
    ["k0", both((x) => C(x(9), 30, 2.5))],
    ["kw", both((x) => C(n(x(9) + 1.4), 28.5, 1))],
    ["k0", "M29.4 35.5H34.6L32 41.5Z"],
  ],
  sun: [
    ["k4", rays(32, 32, 19, 30, 12, 7)],
    ["k5", rays(32, 32, 19, 25, 12, 6, -75)],
    lift(C(32, 32, 17)),
    ["k5", C(32, 32, 17)],
    ["k4", "M32 15A17 17 0 0 1 32 49A20 20 0 0 0 32 15Z"],
    ["l1", both((x) => `M${x(3.6)} 29.6Q${x(6.8)} 26.8 ${x(10)} 29.6`), 'stroke-width="2"'],
    ["l1", "M26.5 37.5Q32 42.5 37.5 37.5", 'stroke-width="2"'],
    ["k4", both((x) => E(x(10.5), 35.5, 2.6, 1.6))],
  ],
  hourglass: [
    lift("M12 7H52V13H48C48 23 37 28 35 32C37 36 48 41 48 51H52V57H12V51H16C16 41 27 36 29 32C27 28 16 23 16 13H12Z"),
    ["k5", "M18 13H46C46 23 37 28 35 32C37 36 46 41 46 51H18C18 41 27 36 29 32C27 28 18 23 18 13Z"],
    ["k2", "M22.5 19.5H41.5C40 24.5 34.5 27.8 32 30.4C29.5 27.8 24 24.5 22.5 19.5Z"],
    ["l2", "M32 31V45", 'stroke-width="1.4"'],
    ["k2", "M19.6 51C21 45 27 42 32 41.6C37 42 43 45 44.4 51Z"],
    ["kh", "M21 15.5C22 21.5 26 26 28.6 29L27.2 30.2C23.8 27 20 22 21 15.5Z"],
    [
      "k1",
      "M14 7H50Q52 7 52 9V11Q52 13 50 13H14Q12 13 12 11V9Q12 7 14 7ZM14 51H50Q52 51 52 53V55Q52 57 50 57H14Q12 57 12 55V53Q12 51 14 51ZM15 13H17.6V51H15ZM46.4 13H49V51H46.4Z",
    ],
  ],
  trophy: [
    lift("M18 9H46V22C46 31 40 37 32 38C24 37 18 31 18 22Z"),
    ["l4", both((x) => `M${x(13)} 14H${x(19.5)}C${x(21.5)} 25 ${x(17.5)} 30.5 ${x(11.5)} 31`), 'stroke-width="3.2"'],
    ["k5", "M18 9H46V22C46 31 40 37 32 38C24 37 18 31 18 22Z"],
    ["k4", "M32 9H46V22C46 31 40 37 32 38Z"],
    ["k4", "M17 7H47Q48.6 7 48.6 8.6V11H15.4V8.6Q15.4 7 17 7Z"],
    ["k1", star(32, 21.5, 6.2, 2.7)],
    ["k1", "M29 37.4H35L36.6 46H27.4Z"],
    ["k1", "M21 46H43Q45 46 45 48V56H19V48Q19 46 21 46Z"],
    ["k4", "M24.5 49.5H39.5V52.4H24.5Z"],
  ],
  spark: [
    lift(sparkle(28, 35, 22)),
    ["k5", sparkle(28, 35, 22)],
    [
      "k4",
      `M28 35L${28 + 22} 35Q${n(28 + 3.5)} ${n(35 + 3.5)} 28 ${35 + 22}ZM28 35L${28 - 22} 35Q${n(28 - 3.5)} ${n(35 - 3.5)} 28 ${35 - 22}Z`,
    ],
    ["kw", sparkle(49, 13, 8)],
    ["k4", sparkle(50, 51, 5.5)],
  ],
  clover: (() => {
    const leaf =
      "M32 31C27 27 21.5 23 21.5 17C21.5 12.5 24.5 9.5 28 9.5C30 9.5 31.5 11 32 12.5C32.5 11 34 9.5 36 9.5C39.5 9.5 42.5 12.5 42.5 17C42.5 23 37 27 32 31Z";
    const turn = (deg: number) => `transform="rotate(${deg} 32 31)"`;
    return [
      ["l1", "M33 32C35 42 40 50 47 56.5", 'stroke-width="3.2"'],
      lift(C(32, 31, 21)),
      ["k5", leaf, turn(-45)],
      ["k4", leaf, turn(45)],
      ["k5", leaf, turn(135)],
      ["k4", leaf, turn(225)],
      ["l2", "M32 31L23 22M32 31L41 22M32 31L41 40M32 31L23 40", 'stroke-width="1.2"'],
      ["k1", C(32, 31, 2.2)],
    ] as Layer[];
  })(),
  crown: [
    lift("M9 21L21 32L32 11L43 32L55 21L49.5 52H14.5Z"),
    ["k5", "M9 21L21 32L32 11L43 32L55 21L49.5 52H14.5Z"],
    ["k4", "M32 11L43 32L55 21L49.5 52H32Z"],
    ["k1", "M14.5 43.5H49.5L49.5 52H14.5Z"],
    ["k5", C(23, 47.7, 2) + C(41, 47.7, 2)],
    ["k4", "M32 44.6L35.2 47.7L32 50.8L28.8 47.7Z"],
    ["k1", "M32 24L36.4 30L32 36L27.6 30Z"],
    ["k5", C(9, 20, 3.2) + C(32, 9.5, 3.6) + C(55, 20, 3.2)],
    ["kw", C(31, 8.4, 1.1)],
  ],
};

// ---- Topics: one picture each, on a soft disc of the topic's tone, over the card (not on a tile of the tone), so
// the tone itself (k3) is the picture's main colour.

const ground: Layer = ["kt", C(32, 32, 30)];

const topics: Record<string, Layer[]> = {
  general: [
    ground,
    ["l3", "M32 2.5V6.5M12.5 10.5L15.5 13.5M51.5 10.5L48.5 13.5M5.5 28H9.5M54.5 28H58.5", 'stroke-width="2.6"'],
    [
      "k3",
      "M32 10C42.5 10 49 18 49 27C49 34 45 38 41.5 42C40 43.8 39.5 45.5 39.5 47.5H24.5C24.5 45.5 24 43.8 22.5 42C19 38 15 34 15 27C15 18 21.5 10 32 10Z",
    ],
    ["k4", "M32 14C40 14 45 20 45 27C45 32 42 35.5 39 39H25C22 35.5 19 32 19 27C19 20 24 14 32 14Z"],
    ["k5", C(32, 26, 7)],
    ["l1", "M27.5 41V34.5L29.7 31.5L32 34.5L34.3 31.5L36.5 34.5V41", 'stroke-width="1.8"'],
    ["kw", "M21.5 23.5C22.5 18.5 26 15.5 30 15C27 17.5 24.5 20.5 23.6 24.6Z"],
    ["k1", "M24 47H40V51Q40 53 38 53H26Q24 53 24 51Z"],
    ["k2", "M25 54H39V56.6Q39 58.6 37 58.6H27Q25 58.6 25 56.6Z"],
    ["k0", "M28.5 59H35.5Q34 61.6 32 61.6Q30 61.6 28.5 59Z"],
  ],
  science: [
    ground,
    ["k4", C(45, 21, 2.6) + C(50.5, 12.5, 1.9) + C(45.5, 5.5, 1.3)],
    ["k5", "M27.5 12V24L14 47C12 51 14.5 55.5 19 55.5H45C49.5 55.5 52 51 50 47L36.5 24V12Z"],
    ["k3", "M20.4 36H43.6L50 47C52 51 49.5 55.5 45 55.5H19C14.5 55.5 12 51 14 47Z"],
    ["k2", "M38.5 36H43.6L50 47C52 51 49.5 55.5 45 55.5H39C44.5 52.5 46 48 42.6 42.4Z"],
    ["k4", "M20.4 36H43.6L44.8 38H19.2Z"],
    ["k5", C(25.5, 47.5, 2.3) + C(32.5, 43, 1.5) + C(36.5, 49.5, 1.9)],
    ["kh", "M29.4 13.5H31.6V24.6L22 41H19.6L29.4 24.2Z"],
    ["k1", "M25 6.5H39Q40.6 6.5 40.6 8.1V10.4Q40.6 12 39 12H25Q23.4 12 23.4 10.4V8.1Q23.4 6.5 25 6.5Z"],
  ],
  history: [
    ground,
    ["l1", both((x) => `M${x(6.5)} 14C${x(15.5)} 13 ${x(17.5)} 18.5 ${x(13)} 25.5`), 'stroke-width="3"'],
    [
      "k3",
      "M26.5 9H37.5V11C37.5 14 36.5 15 36.5 17C36.5 19 47 23 47 34C47 44 40 51 35 56H29C24 51 17 44 17 34C17 23 27.5 19 27.5 17C27.5 15 26.5 14 26.5 11Z",
    ],
    ["ks", "M36.5 17C36.5 19 47 23 47 34C47 44 40 51 35 56H31.5C36.5 50 42 43 42 34C42 25 36 21 36.5 17Z"],
    ["k1", "M17.6 30H46.4C46.7 31.3 46.9 32.6 47 34V37.5H17V34C17.1 32.6 17.3 31.3 17.6 30Z"],
    ["k5", [21, 26.5, 32, 37.5, 43].map((x) => `M${x} 31.4L${x + 2.2} 33.75L${x} 36.1L${x - 2.2} 33.75Z`).join("")],
    ["kh", "M21.5 40C21.8 44.5 24.5 48.5 28 51.5C24 50 20.5 45.5 20 40Z"],
    ["k4", "M22 28C22.6 24 25.5 21.5 28.5 20.5C26.5 23 25 25.5 24.6 28Z"],
    [
      "k1",
      "M24.5 5.6H39.5Q40.6 5.6 40.6 6.7V8.4Q40.6 9.5 39.5 9.5H24.5Q23.4 9.5 23.4 8.4V6.7Q23.4 5.6 24.5 5.6ZM28 55.5H36L38 60.5H26Z",
    ],
  ],
  geography: [
    ground,
    ["l1", "M32 8A23.5 23.5 0 0 1 32 55", 'stroke-width="3"'],
    ["k3", C(30, 31.5, 19)],
    [
      "k1",
      "M16.5 25C18.5 18 25.5 14.5 30 16.5C33 18.5 29 21.5 31 25C33 28 28 31 24 30C21 33 23 38.5 20 41C15.5 37.5 14.5 30.5 16.5 25ZM35 34.5C38 31.5 43 32.5 45 35.5C46 40.5 42 45.5 38 47.5C36 44.5 37 40.5 34 38.5ZM36.5 15C39.5 14 43.5 17 44.5 20.5C41.5 21.5 38.5 19.5 36.5 15Z",
    ],
    ["l4", "M11.6 27Q30 31.5 48.4 27M11.6 38Q30 42.5 48.4 38", 'stroke-width="1"'],
    ["ks", "M42.2 16.9A19 19 0 0 1 15.4 43.7A21.5 21.5 0 0 0 42.2 16.9Z"],
    ["kh", E(23, 21.5, 5, 2.6), 'transform="rotate(-35 23 21.5)"'],
    ["k2", C(32, 8, 2) + C(32, 55, 2)],
    ["k1", "M29.5 55H34.5V58.5H29.5ZM21 58.5H43Q45 58.5 45 60.5V62H19V60.5Q19 58.5 21 58.5Z"],
  ],
  movies: [
    ground,
    ["k1", "M10 27H54V54Q54 57 51 57H13Q10 57 10 54Z"],
    ["k5", "M14 27H20.5L16.5 34H10V31ZM27 27H33.5L29.5 34H23ZM40 27H46.5L42.5 34H36ZM53 27H54V34H49Z"],
    ["k1", "M10 16H54V23H10Z", 'transform="rotate(-13 10 24)"'],
    [
      "k5",
      "M13 16H19.5L15.5 23H10V20ZM26 16H32.5L28.5 23H22ZM39 16H45.5L41.5 23H35ZM52 16H54V19.5L51.5 23H48Z",
      'transform="rotate(-13 10 24)"',
    ],
    ["k5", C(11.6, 25.2, 1.7)],
    ["l3", "M16 41H32M16 47.5H27", 'stroke-width="2.6"'],
    ["k3", "M38.5 38L48.5 44.5L38.5 51Z"],
    ["kh", "M10 34H54V36H10Z"],
  ],
  music: [
    ground,
    ["k0", C(27, 34, 22)],
    ["l1", C(27, 34, 18) + C(27, 34, 14.5) + C(27, 34, 11), 'stroke-width="0.9"'],
    ["kh", "M10.5 26A18 18 0 0 1 19.5 17.6L21 20.5A15 15 0 0 0 13.5 27.5Z"],
    ["k3", C(27, 34, 7.5)],
    ["k5", C(27, 34, 1.6)],
    lift("M51 13H54V47.5A6.4 4.8 -20 1 1 51 43.6Z", 2),
    ["k4", "M51 13H54V47.5A6.4 4.8 -20 1 1 51 43.6Z"],
    ["k4", "M54 13C55.5 19.5 61.5 21 60.5 28.5C59 24.5 56.5 23 54 23Z"],
    ["kw", E(45.5, 46.4, 2, 1.2), 'transform="rotate(-20 45.5 46.4)"'],
  ],
  sports: (() => {
    const cx = 32;
    const cy = 31;
    const R = 23;
    const patches: string[] = [];
    const seams: string[] = [];
    for (let i = 0; i < 5; i++) {
      const t = -90 + 72 * i;
      patches.push(
        `M${at(cx, cy, 15.5, t)}L${at(cx, cy, 19.5, t - 15)}L${at(cx, cy, R, t - 11)}A${R} ${R} 0 0 1 ${at(cx, cy, R, t + 11)}L${at(cx, cy, 19.5, t + 15)}Z`,
      );
      seams.push(
        `M${at(cx, cy, 7.4, t)}L${at(cx, cy, 15.5, t)}M${at(cx, cy, 19.5, t + 15)}L${at(cx, cy, 17.5, t + 36)}L${at(cx, cy, 19.5, t + 57)}M${at(cx, cy, 17.5, t + 36)}L${at(cx, cy, R, t + 36)}`,
      );
    }
    let pentagon = "";
    for (let i = 0; i < 5; i++) pentagon += `${i ? "L" : "M"}${at(cx, cy, 7.4, -90 + 72 * i)}`;
    return [
      ground,
      ["ks", E(32, 58.5, 15, 2.6)],
      ["k5", C(cx, cy, R)],
      ["l2", seams.join(""), 'stroke-width="1.3"'],
      ["k1", `${pentagon}Z${patches.join("")}`],
      ["ks", "M49.6 16A23 23 0 0 1 16.1 47.6A25 25 0 0 0 49.6 16Z"],
      ["kw", E(23.5, 18.5, 5.5, 2.8), 'transform="rotate(-35 23.5 18.5)"'],
    ] as Layer[];
  })(),
  technology: [
    ground,
    lift(
      "M18 20H46C53 20 57 26 58.5 34L60 43C61 49.5 57 54 52 54C48 54 46 51 44 48L41.5 44H22.5L20 48C18 51 16 54 12 54C7 54 3 49.5 4 43L5.5 34C7 26 11 20 18 20Z",
    ),
    [
      "k3",
      "M18 20H46C53 20 57 26 58.5 34L60 43C61 49.5 57 54 52 54C48 54 46 51 44 48L41.5 44H22.5L20 48C18 51 16 54 12 54C7 54 3 49.5 4 43L5.5 34C7 26 11 20 18 20Z",
    ],
    ["kh", "M18 23H46C50 23 53 25 54.5 28H9.5C11 25 14 23 18 23Z"],
    [
      "ks",
      "M5 40C10 46 16 47 22.5 44L20 48C18 51 16 54 12 54C7 54 3 49.5 4 43ZM59 40C54 46 48 47 41.5 44L44 48C46 51 48 54 52 54C57 54 61 49.5 60 43Z",
    ],
    ["k1", "M15 30.5H19V34.5H23V38.5H19V42.5H15V38.5H11V34.5H15Z"],
    ["k1", C(45, 31.5, 2.7) + C(50.5, 37, 2.7)],
    ["k5", C(39.5, 37, 2.7) + C(45, 42.5, 2.7)],
    ["k2", "M27.5 33H31V35.2H27.5ZM33 33H36.5V35.2H33Z"],
    ["k4", sparkle(51, 9.5, 5.5)],
  ],
  literature: [
    ground,
    ["k5", "M33 35C34 27 38 16 46 9C50 6 54 4.6 57.4 4.6C57.4 9 55 14 51 19C46 26 40 30.6 33 35Z"],
    ["k4", "M33 35C40 30.6 46 26 51 19C55 14 57.4 9 57.4 4.6C52.4 12 44 22.4 33 35Z"],
    ["l1", "M30.5 38.5C38 29 47 17 57.4 4.6", 'stroke-width="1.4"'],
    ["l3", "M41.6 20.4L45.6 21.6M37.6 25.6L41.2 27.2M47 13.6L50.4 14.4", 'stroke-width="1.2"'],
    ["k2", "M26.5 33.5H37.5Q38.5 33.5 38.5 34.5V39H25.5V34.5Q25.5 33.5 26.5 33.5Z"],
    lift(
      "M24.5 38.5H39.5C43 38.5 45 40.5 45.6 43.5L47 52.5C47.5 55.8 45.2 58.5 42 58.5H22C18.8 58.5 16.5 55.8 17 52.5L18.4 43.5C19 40.5 21 38.5 24.5 38.5Z",
    ),
    [
      "k1",
      "M24.5 38.5H39.5C43 38.5 45 40.5 45.6 43.5L47 52.5C47.5 55.8 45.2 58.5 42 58.5H22C18.8 58.5 16.5 55.8 17 52.5L18.4 43.5C19 40.5 21 38.5 24.5 38.5Z",
    ],
    ["k3", "M22.6 45.5H41.4L42.4 52.5H21.6Z"],
    ["l1", "M27 49H37", 'stroke-width="1.4"'],
    ["kh", "M20.6 42.6C21.2 41 22.2 40.4 23.4 40.4L21.6 55.6H19.6Z"],
  ],
  nature: [
    ground,
    [
      "k3",
      both(
        (x) =>
          `M${x(2)} 30C${x(6)} 16 ${x(18)} 8 ${x(25)} 11C${x(30)} 13 ${x(28)} 24 ${x(22)} 29C${x(16)} 33 ${x(8)} 33 ${x(2)} 30Z`,
      ),
    ],
    [
      "k2",
      both(
        (x) =>
          `M${x(2)} 33C${x(10)} 33 ${x(19)} 36 ${x(20)} 44C${x(21)} 51 ${x(14)} 56 ${x(9)} 54C${x(4)} 52 ${x(2)} 44 ${x(2)} 33Z`,
      ),
    ],
    ["kh", both((x) => `M${x(4)} 28C${x(8)} 18 ${x(16)} 12 ${x(22)} 13C${x(15)} 16 ${x(9)} 21 ${x(6)} 29Z`)],
    ["k5", both((x) => C(x(19), 18.5, 3.3) + C(x(12), 44, 2.5))],
    ["k4", both((x) => C(x(24.5), 15, 1.4) + C(x(9), 25, 1.6))],
    ["k0", E(32, 32, 2.4, 15.5) + C(32, 15, 3.1)],
    ["l0", "M31 12.5C29 7.5 26 5.5 22.5 5.5M33 12.5C35 7.5 38 5.5 41.5 5.5", 'stroke-width="1.4"'],
    ["k0", C(22.5, 5.5, 1.5) + C(41.5, 5.5, 1.5)],
  ],
};

// ---- Ways to play: the cards on Начало, each in its mode's tone, over the card.

const sword = (deg: number): Layer[] => {
  const t = `transform="rotate(${deg} 32 34)"`;
  return [
    ["ks", "M32 4L35.2 9.5V41H28.8V9.5Z", `transform="rotate(${deg} 32 34) translate(1 2)"`],
    ["k5", "M32 4L35.2 9.5V41H28.8V9.5Z", t],
    ["k4", "M32 4L35.2 9.5V41H32Z", t],
    ["k1", "M23 41H41Q43 41 43 43V44Q43 46 41 46H23Q21 46 21 44V43Q21 41 23 41ZM30.2 46H33.8V56H30.2Z", t],
    ["k2", C(32, 58.6, 3), t],
  ];
};

const modes: Record<string, Layer[]> = {
  duel: [ground, ...sword(-42), ...sword(42), ["k5", sparkle(32, 14, 5)]],
  arena: [
    ground,
    ["l2", "M22 18V8M42 18V8", 'stroke-width="1.6"'],
    ["k4", "M22 8L29 10.5L22 13ZM42 8L49 10.5L42 13Z"],
    ["k3", "M8 20Q32 13 56 20V55H8Z"],
    ["kh", "M8 20Q32 13 56 20V24Q32 17 8 24Z"],
    ["k1", [13, 21, 29, 37, 45].map((x) => `M${x} 34V31Q${x} 28 ${x + 3} 28Q${x + 6} 28 ${x + 6} 31V34Z`).join("")],
    [
      "k1",
      [11.5, 19.5, 27.5, 35.5, 43.5]
        .map((x) => `M${x} 54V45Q${x} 40.5 ${x + 4.5} 40.5Q${x + 9} 40.5 ${x + 9} 45V54Z`)
        .join(""),
    ],
    ["k2", "M8 36.5H56V38.5H8Z"],
    ["ks", "M44 20.6Q50 21.6 56 22V55H48Q52 40 44 20.6Z"],
    ["k1", "M4 55H60V59H4Z"],
  ],
  royal: [
    ground,
    ...laurel(32, 31, 24, 100, 215, 6, 4.6),
    lift("M13 24L22.5 32.5L32 15L41.5 32.5L51 24L46.5 47H17.5Z"),
    ["k5", "M13 24L22.5 32.5L32 15L41.5 32.5L51 24L46.5 47H17.5Z"],
    ["k4", "M32 15L41.5 32.5L51 24L46.5 47H32Z"],
    ["k1", "M17.5 40H46.5V47H17.5Z"],
    ["k4", C(24.5, 43.5, 1.7) + C(39.5, 43.5, 1.7)],
    ["k5", "M32 40.8L34.8 43.5L32 46.2L29.2 43.5Z"],
    ["k5", C(13, 23, 2.8) + C(32, 13, 3.2) + C(51, 23, 2.8)],
  ],
  room: [
    ground,
    ["k1", "M15 9H49V58H15Z"],
    ["k5", "M19 13H45V58H19Z"],
    ["kh", "M19 58H45L56 64H23Z"],
    ["k3", "M19 13L33.5 17V54.5L19 58Z"],
    ["ks", "M19 13L33.5 17V19.5L19 16Z"],
    ["k5", C(30.4, 37.5, 1.6)],
    ["k1", "M25 3H39Q41 3 41 5V9H23V5Q23 3 25 3Z"],
    ["k4", C(28, 6, 1.1) + C(32, 6, 1.1) + C(36, 6, 1.1)],
  ],
};

// ---- Frames: drawn around an avatar's tile, in the frame's own tone (app.css: .fr-*). The tile sits at 8–56; a
// frame lives in the margin around it and may reach a little past the box.

const band = (inset: number, width: number): Layer[] => [
  ["l1", tile(inset), `stroke-width="${width}"`],
  ["l4", tile(inset), `stroke-width="${n(width * 0.42)}"`],
];

const frames: Record<string, Layer[]> = {
  ring: band(3, 3.4),
  double: [
    ...band(2.2, 2),
    ...band(6, 2.4),
    ...gem(32, 1.8, 3.4),
    ...gem(32, 62.2, 3.4),
    ...gem(1.8, 32, 3.4),
    ...gem(62.2, 32, 3.4),
  ],
  dots: around(4.2, 28).flatMap(([x, y], i): Layer[] =>
    i % 2
      ? [["k2", C(x, y, 1.3)]]
      : [
          ["k4", C(x, y, 2.4)],
          ["kw", C(n(x - 0.7), n(y - 0.8), 0.7)],
        ],
  ),
  flames: [
    ...band(3, 3.2),
    ...(
      [
        [32, 0, 15],
        [24, -3, 12],
        [40, 3, 12],
        [16.5, -7, 9.5],
        [47.5, 7, 9.5],
        [10.5, -10, 6.5],
        [53.5, 10, 6.5],
      ] as const
    ).flatMap(([x, lean, h]): Layer[] => [
      ["k3", flame(x, 7, h, h * 0.36, lean)],
      ["k4", flame(x, 7, h * 0.7, h * 0.24, lean * 0.7)],
      ["k5", flame(x, 7, h * 0.38, h * 0.13, lean * 0.4)],
    ]),
  ],
  laurel: [
    ...laurel(32, 32, 30.5, 98, 236, 7, 5.4),
    ["k1", "M26.5 61.5Q32 58.5 37.5 61.5L36 64.5Q32 62.6 28 64.5Z"],
    ["k4", C(32, 61, 2.2)],
  ],
  gem: [
    ...band(3, 2.6),
    ...around(3, 4, 0.5).flatMap(([x, y]) => gem(x, y, 5)),
    ...around(3, 4).flatMap(([x, y]) => gem(x, y, 3)),
  ],
  halo: [
    ["k3", rays(32, 32, 29, 37, 12, 6.5)],
    ["k5", rays(32, 32, 29, 34, 12, 5, -90 + 15)],
    ...band(3.4, 2.8),
    ["kw", sparkle(9, 9, 3.6) + sparkle(55, 55, 3.6)],
    ["k5", sparkle(55, 9, 2.6) + sparkle(9, 55, 2.6)],
  ],
};

/** A season's podium: a band in the place's metal, a faceted star on top and a sprig of laurel below; the champion's
 * star shines. */
const podium = (place: number): Layer[] => {
  const [lit, shade] = facets(32, 4, 7.4, 3.2);
  return [
    ...(place === 1 ? [["k4", rays(32, 4, 6, 12.5, 8, 9, -90 + 22.5)] as Layer] : []),
    ...laurel(32, 36, 27, 104, place === 1 ? 160 : 140, place === 1 ? 4 : 3, 3.6),
    ...band(3, 3.2),
    lift(star(32, 4, 7.4, 3.2), 1.4),
    ["k5", lit],
    ["k3", shade],
    ...around(3, 4, 0.5)
      .slice(1, 3)
      .map(([x, y]): Layer => ["k5", C(x, y, 2)]),
  ];
};
for (const p of [1, 2, 3]) frames[`podium${p}`] = podium(p);

// ---- Divisions: a crest for each band of rating, in the division's colour (app.css: .d-*). Each has its own
// silhouette, so they read apart without colour: Бронз a plain shield; Сребро a chevron on it; Злато wings; Платина a
// star; Диамант a cut gem; Легенда a crowned shield of stars, with rays.

const shield = "M32 7L52 14V31C52 44 43 53 32 58C21 53 12 44 12 31V14Z";
const shieldIn = "M32 12L47.5 17.5V31C47.5 41.2 40.6 48.8 32 53C23.4 48.8 16.5 41.2 16.5 31V17.5Z";
const shieldInRight = "M32 12L47.5 17.5V31C47.5 41.2 40.6 48.8 32 53Z";
const crest = (...more: Layer[]): Layer[] => [
  lift(shield),
  ["k1", shield],
  ["k3", shieldIn],
  ["k2", shieldInRight],
  ["kh", "M18.5 19L31 14.6V18.6L20.6 22.4Z"],
  ...more,
];
const chevron: Layer[] = [
  ["k5", "M19.5 28.5L32 37.5L44.5 28.5V34.6L32 43.6L19.5 34.6Z"],
  ["k4", "M32 37.5L44.5 28.5V34.6L32 43.6Z"],
];
const wing = (x: (dx: number) => number) =>
  `M${x(19)} 18C${x(27)} 16 ${x(31.5)} 21 ${x(31)} 29C${x(28)} 25.5 ${x(24)} 25 ${x(20)} 26ZM${x(19.5)} 27.5C${x(26)} 27 ${x(30)} 31 ${x(29.5)} 37.5C${x(27)} 35 ${x(23.5)} 34 ${x(20)} 34.5ZM${x(19.5)} 36C${x(25)} 36 ${x(27.5)} 39.5 ${x(27)} 45C${x(25)} 43 ${x(22.5)} 42 ${x(20)} 42Z`;

const divisions: Record<string, Layer[]> = {
  bronze: crest(["k4", "M29.6 18H34.4V50.2Q32 51.6 29.6 50.2Z"], ["k5", "M29.6 18H32V51Q30.8 50.9 29.6 50.2Z"]),
  silver: crest(...chevron),
  gold: [
    ["k4", both(wing)],
    ["k2", both((x) => `M${x(19)} 18C${x(23)} 17.4 ${x(26)} 18.4 ${x(28)} 20.4L${x(20)} 26Z`)],
    ...crest(...chevron),
  ],
  platinum: (() => {
    const [lit, shade] = facets(32, 31.5, 12.5, 5.4);
    return crest(["k5", lit], ["k4", shade]);
  })(),
  diamond: [
    lift("M18 11H46L58 25L32 58L6 25Z"),
    ["k4", "M18 11L6 25H26Z"],
    ["k5", "M18 11L26 25L32 11Z"],
    ["k4", "M32 11L26 25H38Z"],
    ["k5", "M32 11L38 25L46 11Z"],
    ["k3", "M46 11L38 25H58Z"],
    ["k3", "M6 25H26L32 58Z"],
    ["k4", "M26 25H38L32 58Z"],
    ["k2", "M38 25H58L32 58Z"],
    ["kw", sparkle(20.5, 18, 3.4)],
  ],
  legend: (() => {
    const [lit, shade] = facets(32, 36, 10, 4.3);
    const small = "M32 16L49 22V35C49 46 41.5 53 32 57C22.5 53 15 46 15 35V22Z";
    return [
      ["k4", rays(32, 35, 22, 32, 12, 6)],
      lift(small),
      ["k1", small],
      ["k3", "M32 20.5L45 25V35C45 43.6 39.4 49.4 32 52.6C24.6 49.4 19 43.6 19 35V25Z"],
      ["k2", "M32 20.5L45 25V35C45 43.6 39.4 49.4 32 52.6Z"],
      ["k5", lit],
      ["k4", shade],
      lift("M19 17L22 5.5L29 11L32 3.5L35 11L42 5.5L45 17Z", 1.2),
      ["k5", "M19 17L22 5.5L29 11L32 3.5L35 11L42 5.5L45 17Z"],
      ["k4", "M32 3.5L35 11L42 5.5L45 17H32Z"],
      ["k1", C(25.5, 13.5, 1.3) + C(32, 12.5, 1.5) + C(38.5, 13.5, 1.3)],
    ] as Layer[];
  })(),
};

/** A season's medal, in the place's metal: a ribbon, a disc with a rim, a faceted star. */
const medal: Layer[] = (() => {
  const [lit, shade] = facets(32, 40, 10, 4.3);
  return [
    ["k1", "M18 2H28L36 24H26Z"],
    ["k2", "M46 2H36L28 24H38Z"],
    lift(C(32, 40, 19)),
    ["k3", C(32, 40, 19)],
    ["k2", "M32 21A19 19 0 0 1 32 59A21 21 0 0 0 32 21Z"],
    ["l4", C(32, 40, 14.5), 'stroke-width="1.6"'],
    ["k5", lit],
    ["k4", shade],
  ];
})();

const draw = (layers: Layer[]) =>
  layers.map(([ink, d, attrs]) => `<path class="${ink}" d="${d}"${attrs ? ` ${attrs}` : ""}/>`).join("");

/** Every picture's paths, by its id: an avatar's shape ("fox"), "topic-<id>" or "mode-<id>". */
export const pictures: Record<string, string> = {
  ...Object.fromEntries(Object.entries(avatars).map(([id, l]) => [id, draw(l)])),
  ...Object.fromEntries(Object.entries(topics).map(([id, l]) => [`topic-${id}`, draw(l)])),
  ...Object.fromEntries(Object.entries(modes).map(([id, l]) => [`mode-${id}`, draw(l)])),
  ...Object.fromEntries(Object.entries(frames).map(([id, l]) => [`frame-${id}`, draw(l)])),
  ...Object.fromEntries(Object.entries(divisions).map(([id, l]) => [`division-${id}`, draw(l)])),
  medal: draw(medal),
};

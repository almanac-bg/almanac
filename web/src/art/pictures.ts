// Pictures: the game's illustrations — the avatars, the topics, the ways to play, Рила and
// the streak's flame — drawn by hand as paths on a 64 × 64 grid, in one style, so that they belong
// together (web/DESIGN.md, Pictures).
//
// The style: flat shapes with depth, no outlines, lit from the top left. Every picture is painted from one ramp of
// its tone (the topic's, the avatar's, the mode's) with the night ink and white, so a
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
/** A soft shadow under a shape: the same path, set down and right a little. */
const lift = (d: string, dy = 2.5): Layer => ["ks", d, `transform="translate(1 ${dy})"`];
/** Eyes: a dark eye on each side with a glint of light. */
const eyes = (dx: number, y: number, r: number): Layer[] => [
  ["k0", both((x) => C(x(dx), y, r))],
  ["kw", both((x) => C(n(x(dx) + r * 0.35), n(y - r * 0.4), n(r * 0.36)))],
];
const shoulders = "M7 66C8 54 19 48 32 48C45 48 56 54 57 66Z";
const foxChest = "M25 66C25.5 57 28.5 52.5 32 52.5C35.5 52.5 38.5 57 39 66Z";

/** A sword standing on the middle, turned by `deg` (crossed swords are two). */
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

// ---- Avatars: fifteen animals, each anyone's from the first day (play.Animals). Each is drawn over a tile in its tone
// (k3), so it's painted in the ramp's darker and lighter inks: portraits, cut at the tile's bottom edge.

const avatars: Record<string, Layer[]> = {
  fox: [
    ["k1", shoulders],
    ["k5", foxChest],
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

  squirrel: [
    ["k2", "M40 66C56 62 63 46 59 32C56 21 46 15 40 21C47 24 52 31 51 41C50 50 44 55 37 57Z"],
    ["k4", "M41 61C53 57 58 46 56 35C55 29 51 24 46 23C50 28 52 35 51 42C50 50 46 55 41 58Z"],
    ["k1", shoulders],
    ["k2", both((x) => `M${x(4)} 25L${x(11)} 8.5L${x(16)} 25Z`)],
    ["k1", both((x) => `M${x(9.4)} 12L${x(11)} 4.5L${x(13.4)} 12Z`)],
    ["k2", E(32, 36, 14, 13)],
    ["kh", "M20 32C21 27 25.5 23.5 31 23C27 25.5 24 28.5 23 33Z"],
    ["k5", E(32, 43, 8.4, 6.6)],
    ["k0", "M29.6 39.4Q32 38.2 34.4 39.4Q33.4 41.6 32 41.7Q30.6 41.6 29.6 39.4Z"],
    ["kw", "M30.5 44H33.5V47Q32 47.8 30.5 47Z"],
    ...eyes(6.6, 33.5, 2.5),
  ],
  lynx: [
    ["k1", shoulders],
    ["k2", both((x) => `M${x(5)} 23L${x(14.5)} 7.5L${x(18.5)} 27Z`)],
    ["l0", both((x) => `M${x(14.5)} 7.5L${x(14)} 1.5`), 'stroke-width="1.6"'],
    ["k4", both((x) => `M${x(8.4)} 22L${x(14)} 12.5L${x(16.4)} 24Z`)],
    ["k2", both((x) => `M${x(12)} 36L${x(22)} 41L${x(17)} 43L${x(21.5)} 47L${x(15)} 48L${x(17.5)} 51.5L${x(9)} 50Z`)],
    ["k2", E(32, 37, 17, 15.5)],
    ["k1", C(25, 25.5, 1.1) + C(29, 23.5, 1.1) + C(35, 23.5, 1.1) + C(39, 25.5, 1.1) + C(32, 22.5, 1.1)],
    ["k5", "M32 38C36.5 38 41 41 41 45.5C41 49.5 37 52 32 52C27 52 23 49.5 23 45.5C23 41 27.5 38 32 38Z"],
    ["k4", both((x) => E(x(7.6), 34, 3.6, 3.4))],
    ["k0", both((x) => C(x(7.6), 34, 1.7))],
    ["kw", both((x) => C(n(x(7.6) + 0.9), 33, 0.7))],
    ["k1", "M29.6 41.2Q32 40.2 34.4 41.2L32 43.8Z"],
    ["l1", "M32 43.8V45.6M29.4 46.6Q32 48.4 34.6 46.6", 'stroke-width="1.3"'],
  ],
  badger: [
    ["k1", shoulders],
    ["k1", both((x) => C(x(15.5), 24, 4.6))],
    ["k5", "M32 55C27 55 16 45 14 35C13 26.5 21 20 32 20C43 20 51 26.5 50 35C48 45 37 55 32 55Z"],
    [
      "k0",
      both(
        (x) =>
          `M${x(3)} 52C${x(5.5)} 42 ${x(7.5)} 30 ${x(9.5)} 20.6C${x(13)} 21.4 ${x(16)} 23.4 ${x(17.4)} 26.4C${x(15)} 35 ${x(10)} 45 ${x(4.4)} 53.4Z`,
      ),
    ],
    ["kw", both((x) => C(x(10.4), 35, 1.5))],
    ["k0", both((x) => C(x(10.4), 35.2, 0.8))],
    ["k0", E(32, 51.2, 3.2, 2.3)],
    ["kh", "M21 26C24 22.5 28 21.4 31 21.4C28 23 25.5 25 24 27.6Z"],
  ],
  sheep: [
    ["k5", C(10, 63, 8) + C(21, 59, 8.5) + C(32, 58, 8.5) + C(43, 59, 8.5) + C(54, 63, 8)],
    [
      "k1",
      both((x) => `M${x(8.5)} 31C${x(14)} 26.5 ${x(20.5)} 27.5 ${x(23.5)} 31C${x(20.5)} 35 ${x(14)} 35 ${x(8.5)} 33Z`),
    ],
    [
      "k2",
      both(
        (x) => `M${x(10)} 31.6C${x(14)} 29 ${x(18.5)} 29.4 ${x(21)} 31.4C${x(18.5)} 33.2 ${x(14)} 33.2 ${x(10)} 32.4Z`,
      ),
    ],
    ["k5", C(21, 23, 7) + C(32, 19, 8.5) + C(43, 23, 7) + C(26, 14.5, 6) + C(38, 14.5, 6)],
    ["k1", "M32 24C38 24 41 29 41 35C41 43 37 51 32 51C27 51 23 43 23 35C23 29 26 24 32 24Z"],
    ["k5", C(27.6, 25.6, 4.6) + C(32, 23.6, 5.2) + C(36.4, 25.6, 4.6)],
    ["kw", both((x) => C(x(4.6), 36, 2))],
    ["k0", both((x) => C(x(4.6), 36.4, 1.1))],
    ["k0", both((x) => E(x(2.2), 46, 0.9, 0.6))],
    ["l2", "M29.6 48.4Q32 50.2 34.4 48.4", 'stroke-width="1.2"'],
  ],
  turtle: [
    ["k2", "M26 34H38V50H26Z"],
    ["k2", E(32, 28, 11.5, 11)],
    ["kh", "M22 25C23 20.5 27 18 31.5 17.5C28 20 25.5 22.5 24.5 26Z"],
    ["k4", both((x) => E(x(7.4), 33.5, 2.4, 1.6))],
    ...eyes(5.4, 28.5, 2.2),
    ["l1", "M28.4 33.6Q32 36.4 35.6 33.6", 'stroke-width="1.4"'],
    ["k1", "M2 66C2 51 15 42 32 42C49 42 62 51 62 66Z"],
    ["k2", "M25 50.5L32 46.5L39 50.5V58L32 62L25 58ZM9 60L14 52L22 53.5V61L16 66H8ZM55 60L50 52L42 53.5V61L48 66H56Z"],
    ["l4", "M7 58Q32 41 57 58", 'stroke-width="1.2"'],
  ],
  mouse: [
    ["k1", shoulders],
    ["k2", both((x) => C(x(14), 22, 10))],
    ["k4", both((x) => C(x(14), 23, 6.6))],
    ["k2", "M32 55C27 55 18 47 18 38C18 30 24 25 32 25C40 25 46 30 46 38C46 47 37 55 32 55Z"],
    ["kh", "M21.5 34C22.5 29.5 26.5 26.5 31 26.2C27.5 28.5 25 31 24 35Z"],
    ["k5", E(32, 47.5, 6.4, 5.2)],
    ["k4", C(32, 52.2, 2.2)],
    ...eyes(6.2, 38, 2.5),
    ["l5", both((x) => `M${x(6.5)} 47L${x(17)} 45M${x(6.5)} 49L${x(16.5)} 51`), 'stroke-width="0.9"'],
  ],
};

// ---- Marks: pictures of what isn't a player, a topic or a way to play: the streak's flame.

const marks: Record<string, Layer[]> = {
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
};

// ---- Topics: one picture each, on a soft disc of the topic's tone, over the card (not on a tile of the tone), so
// the tone itself (k3) is the picture's main colour.

const ground: Layer = ["kt", C(32, 32, 30)];
/** A petal of the game's rosette (the logo, favicon.svg), upright: turned about the centre for the others. */
const petal = "M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z";

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
  // „Микс“, every topic at once: the game's own rosette, four answers and one of them right, the lightest.
  mix: [
    ground,
    ...[45, 135, 225, -45].map((deg): Layer => [deg < 0 ? "k4" : "k2", petal, `transform="rotate(${deg} 32 32)"`]),
  ],
};

// ---- Ways to play: the cards on Начало, each in its mode's tone, over the card.

/** An avatar's head as a friend on a card: the animal without its tile or its shoulders, set down at (x, y), `s` of
 * its size, turned by `deg`. In front it's one ink lighter than on its tile, so the tone is its main colour, as on the
 * other cards; behind, it keeps its tile's darker inks. */
const lighter: Record<string, string> = { k1: "k2", k2: "k3", k4: "k5", l1: "l2" };
const head = (id: string, x: number, y: number, s: number, deg: number, front: boolean): Layer[] => {
  const t = `transform="translate(${x} ${y}) rotate(${deg}) scale(${s}) translate(-32 -32)"`;
  return (avatars[id] ?? [])
    .filter(([, d]) => d !== shoulders && d !== foxChest)
    .map(([ink, d, attrs]) => [(front && lighter[ink]) || ink, d, attrs ? `${t} ${attrs}` : t]);
};

/** An open book, for Моят Алманах. */
const book: Layer[] = [
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
];

const modes: Record<string, Layer[]> = {
  almanac: [ground, ...book],
  // Two friends side by side, the fox and the bear (the avatars are the players' faces), their heads leaning
  // together with a little space between them, both well inside the disc; the bear, a step behind, in darker inks.
  // Their shoulders and the fox's white chest are the avatars' own, set down with the heads and cut at the disc's edge.
  friends: [
    ground,
    ["k1", "M31 46.32C31.48 40.56 36.76 37.68 43 37.68C49.24 37.68 54.52 40.56 55 46.32V51.26A30 30 0 0 1 31 61.98Z"],
    ...head("bear", 43, 30, 0.48, -4, false),
    ["k2", "M9 50C9.5 44 15 41 21.5 41C28 41 33.5 44 34 50V61.93A30 30 0 0 1 9 51.26Z"],
    ["k5", "M18 50C18.25 45.5 19.75 43.25 21.5 43.25C23.25 43.25 24.75 45.5 25 50V61.17A30 30 0 0 1 18 58.53Z"],
    ...head("fox", 21.5, 33, 0.5, 4, true),
  ],
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
};

// ---- Рила, for the topic „България“: a mountain deep in snow on a round of sky, a star over it. Lit from the left: a
// peak's right face is in shade.

/** A peak on the line y = 50: its lit face, then its face in shade. */
const peak = (cx: number, h: number, w: number, lit = "k3", shade = "k2"): Layer[] => [
  [lit, `M${n(cx - w)} 50L${cx} ${n(50 - h)}L${cx} 50Z`],
  [shade, `M${cx} ${n(50 - h)}L${n(cx + w)} 50L${cx} 50Z`],
];
/** Snow on a peak, `s` down from its top, with a ragged edge: white on the lit face, pale in the shade. */
const snow = (cx: number, h: number, w: number, s: number): Layer[] => {
  const top = 50 - h;
  const x = (w * s) / h;
  return [
    ["kw", `M${cx} ${n(top)}L${n(cx - x)} ${n(top + s)}L${n(cx - x * 0.45)} ${n(top + s * 0.72)}L${cx} ${n(top + s)}Z`],
    ["k5", `M${cx} ${n(top)}L${cx} ${n(top + s)}L${n(cx + x * 0.4)} ${n(top + s * 0.7)}L${n(cx + x)} ${n(top + s)}Z`],
  ];
};
const rila: Layer[] = [
  lift(C(32, 32, 28)),
  ["k5", C(32, 32, 28)],
  ["kh", "M9 25A24 24 0 0 1 25 8.2L26 11.6A20.5 20.5 0 0 0 12.4 26Z"],
  ...peak(19, 23, 8.4, "k2", "k1"),
  ...snow(19, 23, 8.4, 6),
  ...peak(45, 25, 8.4, "k2", "k1"),
  ...snow(45, 25, 8.4, 6),
  ...peak(32, 37, 18),
  ...snow(32, 37, 18, 12),
  ["kw", sparkle(17, 18, 3.8)],
  ["k4", sparkle(47.5, 14, 2.4)],
  ["k1", "M10.55 50A28 28 0 0 0 53.45 50Z"],
];

const draw = (layers: Layer[]) =>
  layers.map(([ink, d, attrs]) => `<path class="${ink}" d="${d}"${attrs ? ` ${attrs}` : ""}/>`).join("");

/** Every picture's paths, by its id: an avatar's shape ("fox"), "topic-<id>", "mode-<id>", "division-<id>" or the
 * streak's "flame". */
export const pictures: Record<string, string> = {
  ...Object.fromEntries(Object.entries(avatars).map(([id, l]) => [id, draw(l)])),
  ...Object.fromEntries(Object.entries(topics).map(([id, l]) => [`topic-${id}`, draw(l)])),
  // „България“, the questions about Bulgaria from every topic: Рила.
  "topic-bulgaria": draw(rila),
  ...Object.fromEntries(Object.entries(modes).map(([id, l]) => [`mode-${id}`, draw(l)])),
  ...Object.fromEntries(Object.entries(marks).map(([id, l]) => [id, draw(l)])),
};

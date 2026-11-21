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
//   l0–l5 the same inks as strokes (round ends, no fill): only for what is a line in life (a whisker, an antler)
//   ka kb an avatar's own accents (an iris, a beak), la the first as a stroke: named, never picked by a layer's place
//
// The rules a picture is drawn to (an avatar's head and eyes, the light, how it reads at 32 px) are in DESIGN.md.
//
// This module is loaded on its own after the game starts (art/picture.ts), so its weight never holds up the first
// screen. It imports nothing, so that it stays one file of its own.

type Layer = [ink: string, d: string, attrs?: string];

const n = (v: number) => Math.round(v * 100) / 100;
/** A circle as a path. */
const C = (x: number, y: number, r: number) =>
  `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
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
/** A point on an ellipse, at an angle (0 is right, 270 is up). */
const on = (cx: number, cy: number, rx: number, ry: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return `${n(cx + rx * Math.cos(a))} ${n(cy + ry * Math.sin(a))}`;
};
/** A crescent inside a round form's edge, between two angles: its light or its shade. */
const rim = (ink: string, cx: number, cy: number, rx: number, ry: number, from: number, to: number): Layer => {
  const p = (deg: number, k: number) => on(cx, cy, rx * k, ry * k, deg);
  return [
    ink,
    `M${p(from, 0.84)}A${n(rx * 0.84)} ${n(ry * 0.84)} 0 0 1 ${p(to, 0.84)}Q${p((from + to) / 2, 0.58)} ${p(from, 0.84)}Z`,
  ];
};
/** The light on a head, lit from the top left. */
const shine = (cx: number, cy: number, rx: number, ry: number) => rim("kh", cx, cy, rx, ry, 194, 258);
/** The shade on a white form, where the light wouldn't show: inside its lower right edge. */
const shade = (cx: number, cy: number, rx: number, ry: number) => rim("ks", cx, cy, rx, ry, 8, 82);
/** The glints of two eyes: up and to the left on both, since the light is one. */
const glints = (dx: number, y: number, r: number) =>
  C(32 - dx - r * 0.33, y - r * 0.38, r * 0.36) + C(32 + dx - r * 0.33, y - r * 0.38, r * 0.36);
/** Eyes, every animal's: a dark eye on each side with a glint of light. */
const eyes = (dx: number, y: number, r = 2.4): Layer[] => [
  ["k0", both((x) => C(x(dx), y, r))],
  ["kw", glints(dx, y, r)],
];
/** A cat's eyes: the same on an iris of its own colour (ka), the pupil upright. */
const catEyes = (dx: number, y: number): Layer[] => [
  ["ka", both((x) => E(x(dx), y, 3.8, 3.9))],
  ["k0", both((x) => E(x(dx), y, 1.6, 3))],
  ["kw", glints(dx, y, 2.4)],
];
const shoulders = "M7 66C8 54 19 48 32 48C45 48 56 54 57 66V72H7Z";
const chest = "M25 66C25.5 57 28.5 52.5 32 52.5C35.5 52.5 38.5 57 39 66V72H25Z";
/** The head's shadow on the chest. */
const chinShadow = E(33, 51.5, 13.5, 4.4);
const chin: Layer = ["ks", chinShadow];

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

// ---- Avatars: fifteen animals, each anyone's from the first day (play.Animals). Each is a bust on a tile of its
// scene, in its own colours (app.css, .tone-natural.sh-<shape>: k1 its darkest fur, k2 its fur, k4 and k5 its pale
// parts, ka and kb its own accents), drawn to one sheet: a skull 34–38 wide about x = 32, the eyes at y 32–36, the
// shoulders the same for all, the light on its upper left and its shadow under the chin.

const avatars: Record<string, Layer[]> = {
  fox: [
    ["k1", shoulders],
    ["k5", chest],
    chin,
    ["k1", both((x) => `M${x(5.5)} 24L${x(16.5)} 7.5Q${x(19.5)} 6 ${x(20.5)} 9.5L${x(21.5)} 29Z`)],
    ["k0", both((x) => `M${x(9.5)} 22.5L${x(16)} 12.5Q${x(17.6)} 11.6 ${x(18)} 13.6L${x(18.6)} 25Z`)],
    [
      "k2",
      "M32 53.5C28 53.5 23 49.5 19 44.5L12 37C11 28 19 19.5 32 19.5C45 19.5 53 28 52 37L45 44.5C41 49.5 36 53.5 32 53.5Z",
    ],
    shine(32, 35, 20, 15.5),
    [
      "k5",
      "M12 37C17 35 23 36.5 27 40C29.5 42.3 31 43.6 32 43.6C33 43.6 34.5 42.3 37 40C41 36.5 47 35 52 37L45 44.5C41 49.5 36 53.5 32 53.5C28 53.5 23 49.5 19 44.5Z",
    ],
    ...eyes(8.4, 32.6, 2.4),
    ["k0", "M28.8 48.6Q32 46.6 35.2 48.6Q34.2 51.6 32 51.8Q29.8 51.6 28.8 48.6Z"],
  ],
  bear: [
    ["k1", shoulders],
    chin,
    ["k2", both((x) => C(x(13.5), 21.5, 6.8))],
    ["k1", both((x) => C(x(13.5), 22, 3.6))],
    ["k2", E(32, 35.5, 17.5, 16)],
    shine(32, 35.5, 17.5, 16),
    ["k4", E(32, 43, 8.8, 7.2)],
    ["k0", "M28.2 39.7Q32 37.8 35.8 39.7Q34.7 43.2 32 43.4Q29.3 43.2 28.2 39.7Z"],
    ["l0", "M32 43.5V46.1M29.2 46.7Q32 49.1 34.8 46.7", 'stroke-width="1.5"'],
    ...eyes(7.8, 32.5),
  ],
  cat: [
    ["k1", shoulders],
    chin,
    ["k2", both((x) => `M${x(5)} 24L${x(15.5)} 8.5Q${x(18.5)} 7 ${x(19)} 10.5L${x(18.5)} 29Z`)],
    ["k4", both((x) => `M${x(8.6)} 22.6L${x(14.8)} 13.4Q${x(16.3)} 12.8 ${x(16.4)} 14.4L${x(16.2)} 25.5Z`)],
    ["k2", E(32, 37, 18.5, 16)],
    shine(32, 37, 18.5, 16),
    ["k1", "M32 22L30.4 28.1L32 29.9L33.6 28.1ZM26.4 22.7L25.8 26.9L27.6 27.5ZM37.6 22.7L38.2 26.9L36.4 27.5Z"],
    ["k5", C(29, 43.6, 4.7) + C(35, 43.6, 4.7)],
    ...catEyes(8, 35),
    ["kb", "M29.6 40Q32 39.1 34.4 40L32 42.8Z"],
    ["l5", both((x) => `M${x(7.5)} 43.4L${x(18)} 42M${x(7.5)} 45.8L${x(17.5)} 47.8`), 'stroke-width="1"'],
  ],
  hare: [
    ["k1", shoulders],
    chin,
    ["k2", both((x) => `M${x(4.5)} 30C${x(2)} 18 ${x(5)} 3 ${x(11)} 2.5C${x(17)} 2 ${x(17.5)} 17 ${x(14.5)} 30Z`)],
    ["k4", both((x) => `M${x(7.6)} 27C${x(6)} 18 ${x(8)} 7.2 ${x(11)} 6.8C${x(14)} 6.6 ${x(14.2)} 17 ${x(12.2)} 27Z`)],
    [
      "k2",
      "M32 23.5C42 23.5 49.5 30 49.5 39.5C49.5 48.5 42 54.5 32 54.5C22 54.5 14.5 48.5 14.5 39.5C14.5 30 22 23.5 32 23.5Z",
    ],
    shine(32, 39, 17.5, 15.5),
    ["kw", "M29.8 48.5H34.2V52Q34.2 53.2 33 53.2H31Q29.8 53.2 29.8 52Z"],
    ["k5", E(27.2, 45.8, 6, 4.8) + E(36.8, 45.8, 6, 4.8)],
    ["ka", "M29.4 41Q32 39.7 34.6 41Q33.4 44 32 44Q30.6 44 29.4 41Z"],
    ...eyes(8.4, 36, 2.5),
  ],
  hedgehog: [
    ["k1", spikes(32, 40, 29, 20, 158, 382, 13)],
    ["k2", spikes(32, 41, 24, 17, 163, 377, 12)],
    ["k1", shoulders],
    [
      "k5",
      "M18.5 41C18.5 32.5 24.5 28.5 32 28.5C39.5 28.5 45.5 32.5 45.5 41C45.5 47 39 52 32 57C25 52 18.5 47 18.5 41Z",
    ],
    ["k4", both((x) => E(x(9.4), 46, 2.8, 1.8))],
    ["k0", C(32, 54.8, 2.8)],
    ...eyes(6.6, 39.5),
  ],
  dog: [
    ["k1", shoulders],
    chin,
    ["k2", "M32 20.5C42.5 20.5 49 27 49 35.5C49 45 42 53 32 53C22 53 15 45 15 35.5C15 27 21.5 20.5 32 20.5Z"],
    shine(32, 36, 17, 15.5),
    ["k1", E(39, 32.5, 6.2, 6)],
    [
      "k1",
      both(
        (x) =>
          `M${x(9.5)} 21.5C${x(16)} 19 ${x(22)} 22 ${x(22.5)} 28.5C${x(23)} 35.5 ${x(21)} 43 ${x(17.5)} 45C${x(14)} 46.5 ${x(12.5)} 41 ${x(12.5)} 35.5C${x(12.5)} 30.5 ${x(10.5)} 26 ${x(9.5)} 21.5Z`,
      ),
    ],
    ["k5", E(32, 43.7, 9.2, 7.6)],
    ["ka", "M30.2 46.6H33.8V50Q33.8 52 32 52Q30.2 52 30.2 50Z"],
    ["k0", "M28.2 39.7Q32 37.6 35.8 39.7Q34.9 43.2 32 43.4Q29.1 43.2 28.2 39.7Z"],
    ["l0", "M32 43.4V45.7M28.4 45.9Q30.4 48.3 32 45.9Q33.6 48.3 35.6 45.9", 'stroke-width="1.4"'],
    ...eyes(7, 32.5),
  ],
  deer: [
    ["k1", shoulders],
    ["k4", C(17, 58, 1.7) + C(22.5, 53.5, 1.4) + C(44.5, 55, 1.7) + C(48, 60.5, 1.4) + C(14, 63, 1.3)],
    chin,
    [
      "la",
      both(
        (x) =>
          `M${x(6)} 22C${x(8)} 16 ${x(10)} 11 ${x(10)} 4M${x(9)} 13.5C${x(13)} 12.5 ${x(16)} 9.5 ${x(17)} 5.5M${x(9.7)} 8.5C${x(7.4)} 7.5 ${x(5.8)} 6 ${x(5.2)} 3.5`,
      ),
      'stroke-width="2.8"',
    ],
    [
      "k2",
      both((x) => `M${x(9)} 26.5C${x(14)} 20 ${x(21)} 19.5 ${x(25.5)} 22.5C${x(22)} 28.5 ${x(15)} 30.5 ${x(9)} 29.5Z`),
    ],
    [
      "k4",
      both(
        (x) =>
          `M${x(11.5)} 27.3C${x(15.2)} 23.4 ${x(19.4)} 22.8 ${x(22.4)} 23.8C${x(19.4)} 27 ${x(15.4)} 28.2 ${x(11.5)} 28.3Z`,
      ),
    ],
    [
      "k2",
      "M32 19.5C41.5 19.5 46.5 25.5 45.5 33.5C44.5 41.5 39 51.5 32 53.5C25 51.5 19.5 41.5 18.5 33.5C17.5 25.5 22.5 19.5 32 19.5Z",
    ],
    shine(32, 32, 13.5, 12.5),
    ["k4", E(32, 46.5, 7.2, 6.6)],
    ["k0", E(32, 47.6, 3.8, 2.8)],
    ...eyes(6.6, 33.5),
  ],
  // In profile, as a beak is: the breast where the others' shoulders are, the black of the wing behind it.
  stork: [
    ["k5", "M4 66C5 55 13 46.5 26 46.5C39 46.5 47 55 48 66V72H4Z"],
    ["k0", "M0 66C1 57 6 50.5 14.5 48.5C13 55 15.5 61.5 21 66V72H0Z"],
    ["k5", "M20.5 26C19.5 34 20.5 40 17 50H37C32.5 43 30 34 30.5 26Z"],
    ["ks", "M30.5 26C30 34 32.5 43 37 50H34C30.4 43 28.4 34 28.6 27Z"],
    ["ka", "M32 14.8L60.6 24.4Q61.8 25.4 60.2 25.8L33.5 24.8Z"],
    ["ks", "M33 20L60.9 24.7Q61.4 25.5 60.2 25.8L33.5 24.8Z"],
    ["k5", C(25, 19.5, 10.2)],
    shade(25, 19.5, 10.2, 10.2),
    ["k0", C(28.6, 18, 2.4)],
    ["kw", C(27.8, 17.1, 0.86)],
  ],
  frog: [
    ["k1", shoulders],
    ["k2", both((x) => C(x(11.5), 27.5, 8.6))],
    ["k2", "M10 46C10 36.5 19 32 32 32C45 32 54 36.5 54 46C54 55 44.5 60 32 60C19.5 60 10 55 10 46Z"],
    shine(32, 46, 22, 14),
    ["k5", both((x) => C(x(11.5), 27.2, 6))],
    ...eyes(11.5, 27.6, 2.8),
    ["k4", both((x) => E(x(17), 48.5, 3.2, 2.1))],
    ["k1", both((x) => C(x(2.6), 41.5, 0.9))],
    ["l1", "M19.5 48Q32 55.5 44.5 48", 'stroke-width="2"'],
  ],

  // Its tail a plume behind its shoulder, as wide as its head is tall.
  squirrel: [
    [
      "k2",
      "M40 66C42 58 50 51 50.5 38C51 27 50.5 15 57.5 13.5C62.5 12.5 66 17 65 23C64.5 26 62 27.5 60.6 29.6C65 32 66.5 38 66 43C65 54 57 63 47 66Z",
    ],
    [
      "k4",
      "M49 62C55 56 60.5 49 61 40C61.3 34 58.5 30 56.5 27C55 24 55.5 19 59 17.5C56 17 54.3 20 54.3 25C54.3 30 55 34 54.8 40C54.5 49 52 56 49 62Z",
    ],
    ["k1", shoulders],
    ["k5", chest],
    chin,
    ["k2", both((x) => `M${x(5.5)} 28L${x(11.6)} 9.4Q${x(13.5)} 6.4 ${x(15.2)} 9.6L${x(18.5)} 30Z`)],
    ["k1", both((x) => `M${x(8.8)} 26L${x(12.6)} 14.5Q${x(13.5)} 13.3 ${x(14.2)} 14.7L${x(16)} 27Z`)],
    ["k2", E(32, 37.5, 17, 15)],
    shine(32, 37.5, 17, 15),
    ["k5", "M32 39.5C38 39.5 45 42.5 45 47C45 51 38.5 52.5 32 52.5C25.5 52.5 19 51 19 47C19 42.5 26 39.5 32 39.5Z"],
    ["k0", "M29.6 42Q32 40.8 34.4 42Q33.4 44.4 32 44.5Q30.6 44.4 29.6 42Z"],
    ["l1", "M32 44.5V46.2M29.6 47Q32 48.8 34.4 47", 'stroke-width="1.3"'],
    ...eyes(8.2, 35, 2.6),
  ],
  lynx: [
    ["k1", shoulders],
    chin,
    ["k2", both((x) => `M${x(5.5)} 27L${x(15.5)} 9L${x(20)} 30Z`)],
    ["k4", both((x) => `M${x(9.4)} 25.5L${x(15)} 15L${x(17.6)} 27Z`)],
    ["k0", both((x) => `M${x(13.2)} 13.2L${x(17.2)} 1.6L${x(17)} 15.6Z`)],
    [
      "k2",
      both((x) => `M${x(12)} 38L${x(22.5)} 43.5Q${x(19)} 45 ${x(18)} 46.8L${x(20.5)} 52.6Q${x(14)} 54.5 ${x(8)} 53Z`),
    ],
    ["k2", E(32, 37.5, 17, 15.5)],
    shine(32, 37.5, 17, 15.5),
    ["k1", C(25, 26, 1.1) + C(29, 24, 1.1) + C(35, 24, 1.1) + C(39, 26, 1.1) + C(32, 23, 1.1)],
    ["k5", "M32 38.5C36.5 38.5 41 41.5 41 46C41 50 37 52.5 32 52.5C27 52.5 23 50 23 46C23 41.5 27.5 38.5 32 38.5Z"],
    ...catEyes(8, 34.5),
    ["kb", "M29.6 41.7Q32 40.7 34.4 41.7L32 44.3Z"],
    ["l1", "M32 44.3V46.1M29.4 47.1Q32 48.9 34.6 47.1", 'stroke-width="1.3"'],
  ],
  // Its mask: two dark bands from the nose through the eyes to the ears, on a white head.
  badger: [
    ["k2", shoulders],
    chin,
    ["k1", both((x) => C(x(14.5), 24, 5.2))],
    ["k5", both((x) => C(x(14.5), 24.4, 2.4))],
    ["k5", "M32 55.5C26 55.5 14.5 46.5 14.5 36C14.5 27 22 21 32 21C42 21 49.5 27 49.5 36C49.5 46.5 38 55.5 32 55.5Z"],
    shade(32, 37, 17.5, 16),
    [
      "k1",
      both(
        (x) =>
          `M${x(3)} 50.5C${x(3.6)} 42 ${x(5)} 32 ${x(7.2)} 22C${x(11)} 22.6 ${x(14.6)} 25 ${x(16.4)} 28.6C${x(15.6)} 37.5 ${x(10.6)} 46.5 ${x(4.6)} 52Z`,
      ),
    ],
    ...eyes(9.6, 35.5),
    ["k0", E(32, 51.8, 3.5, 2.6)],
  ],
  // Its head is its face in its wool; its body, wool where the others' shoulders are.
  sheep: [
    ["k5", C(10, 63, 8) + C(21, 59, 8.5) + C(32, 58, 8.5) + C(43, 59, 8.5) + C(54, 63, 8)],
    ["ks", E(32.6, 53.4, 8, 2.4)],
    [
      "k2",
      both((x) => `M${x(8.5)} 34C${x(14)} 28.5 ${x(21)} 29.5 ${x(24.5)} 33.5C${x(21)} 38 ${x(14)} 38 ${x(8.5)} 36Z`),
    ],
    [
      "k1",
      both(
        (x) =>
          `M${x(10.5)} 34.6C${x(14.5)} 31.6 ${x(19)} 32 ${x(21.5)} 34.2C${x(19)} 36.2 ${x(14.5)} 36.2 ${x(10.5)} 35.4Z`,
      ),
    ],
    ["k5", C(19, 27, 8) + C(32, 20.5, 10) + C(45, 27, 8) + C(24.5, 18.5, 7.5) + C(39.5, 18.5, 7.5)],
    ["k2", "M32 26C39.5 26 43.5 31 43.5 37.5C43.5 46 38 53 32 53C26 53 20.5 46 20.5 37.5C20.5 31 24.5 26 32 26Z"],
    ["k5", C(26, 28, 5.4) + C(32, 26, 6) + C(38, 28, 5.4)],
    ...eyes(5.8, 38),
    ["k1", "M29.4 46.4Q32 45.4 34.6 46.4L32 49Z"],
    ["l1", "M32 49V50.2", 'stroke-width="1.2"'],
  ],
  // Its shell where the others' shoulders are, its head on its neck before it.
  turtle: [
    ["ka", "M1 66C1 50 14 39.5 32 39.5C50 39.5 63 50 63 66V72H1Z"],
    ["kb", both((x) => `M${x(24)} 58L${x(19)} 49L${x(11.5)} 47L${x(8.5)} 55.5L${x(14)} 72H${x(20.5)}Z`)],
    ["kb", "M26.5 59.5H37.5L43.3 72H20.7Z"],
    ["k2", "M25 42H39V55Q32 58.5 25 55Z"],
    ["ks", E(32.8, 50, 7, 3.2)],
    ["k2", "M32 18.5C42 18.5 49.5 25 49.5 33.5C49.5 42 42 48 32 48C22 48 14.5 42 14.5 33.5C14.5 25 22 18.5 32 18.5Z"],
    shine(32, 33, 17.5, 14.7),
    ["k4", both((x) => E(x(11.6), 39.4, 2.8, 1.8))],
    ...eyes(7.8, 33),
    ["k1", both((x) => C(x(1.7), 38, 0.75))],
    ["l1", "M25.5 41Q32 45.5 38.5 41", 'stroke-width="1.5"'],
  ],
  mouse: [
    ["k1", shoulders],
    chin,
    ["k2", both((x) => C(x(15), 22.5, 10.5))],
    ["k4", both((x) => C(x(15), 23, 6.8))],
    [
      "k2",
      "M32 55.5C26.5 55.5 15.5 48 15.5 38.5C15.5 30 23 24.5 32 24.5C41 24.5 48.5 30 48.5 38.5C48.5 48 37.5 55.5 32 55.5Z",
    ],
    shine(32, 38.5, 16.5, 14),
    ["k5", E(32, 47.8, 6.6, 5.2)],
    ["k4", C(32, 52.4, 2.3)],
    ...eyes(7.2, 38.2, 2.5),
    ["l5", both((x) => `M${x(6.8)} 47.4L${x(17.5)} 45.4M${x(6.8)} 49.4L${x(17)} 51.4`), 'stroke-width="0.9"'],
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
    ["kw", "M27.5 12V24L14 47C12 51 14.5 55.5 19 55.5H45C49.5 55.5 52 51 50 47L36.5 24V12Z"],
    ["k3", "M20.4 36H43.6L50 47C52 51 49.5 55.5 45 55.5H19C14.5 55.5 12 51 14 47Z"],
    ["k2", "M38.5 36H43.6L50 47C52 51 49.5 55.5 45 55.5H39C44.5 52.5 46 48 42.6 42.4Z"],
    ["k4", "M20.4 36H43.6L44.8 38H19.2Z"],
    ["k5", C(25.5, 47.5, 2.3) + C(32.5, 43, 1.5) + C(36.5, 49.5, 1.9)],
    ["kh", "M29.4 13.5H31.6V24.6L22 41H19.6L29.4 24.2Z"],
    ["ks", "M34 12H36.5V24L43.6 36H40.4L34 25Z"],
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
    ["ks", "M42.2 16.9A19 19 0 0 1 15.4 43.7A21.5 21.5 0 0 0 42.2 16.9Z"],
    ["kh", E(23, 21.5, 5, 2.6), 'transform="rotate(-35 23 21.5)"'],
    ["k2", C(32, 8, 2) + C(32, 55, 2)],
    ["k1", "M29.5 55H34.5V58.5H29.5ZM21 58.5H43Q45 58.5 45 60.5V62H19V60.5Q19 58.5 21 58.5Z"],
  ],
  movies: (() => {
    const arm = 'transform="rotate(-12 12 26.5)"';
    const board = "M12 29H52V52Q52 55 49 55H15Q12 55 12 52Z";
    return [
      ground,
      lift(board, 2),
      ["k1", board],
      ["k5", "M15.5 29H21.5L18 35.5H12V32ZM27.5 29H33.5L30 35.5H24ZM39.5 29H45.5L42 35.5H36ZM51.5 29H52V35.5H48Z"],
      ["k1", "M12 19H52V25.5H12Z", arm],
      [
        "k5",
        "M14.5 19H20.5L17 25.5H12V22ZM26.5 19H32.5L29 25.5H23ZM38.5 19H44.5L41 25.5H35ZM50.5 19H52V21.5L49.8 25.5H47Z",
        arm,
      ],
      ["k5", C(13.8, 27.3, 1.5)],
      ["l3", "M17.5 42H31M17.5 48H26.5", 'stroke-width="2.4"'],
      ["k3", "M37.5 39.5L46.5 45L37.5 50.5Z"],
      ["kh", "M12 35.5H52V37.3H12Z"],
    ] as Layer[];
  })(),
  music: (() => {
    // A record, and before it two notes on one beam: their heads, then their stems and the beam.
    const heads = E(39.6, 52, 4.4, 3.3) + E(53.2, 48, 4.4, 3.3);
    const stems = "M41.7 31H44V52H41.7ZM55.3 27H57.6V48H55.3ZM41.7 30.5L57.6 26.5V31.5L41.7 35.5Z";
    return [
      ground,
      ["k0", C(27, 30, 20.5)],
      ["l1", C(27, 30, 16.8) + C(27, 30, 13.6) + C(27, 30, 10.4), 'stroke-width="0.9"'],
      ["kh", "M10.5 22A18 18 0 0 1 19.5 13.6L21 16.5A15 15 0 0 0 13.5 23.5Z"],
      ["k3", C(27, 30, 7.2)],
      ["k5", C(27, 30, 1.6)],
      lift(heads + stems, 1.6),
      ["k3", heads],
      ["k3", stems],
      ["kw", E(38.2, 51, 1.6, 0.9) + E(51.8, 47, 1.6, 0.9)],
    ] as Layer[];
  })(),
  // A football as it is: a ball of twelve five-sided patches (and twenty six-sided ones between them), one of the
  // twelve turned a little up and left of the middle, seen from far (so what's near the rim is narrow).
  sports: (() => {
    const cx = 32;
    const cy = 31;
    const R = 23;
    const g = (1 + Math.sqrt(5)) / 2;
    type P = [number, number, number];
    const [ax, ay] = [0.42, -0.2];
    // The twelve corners of the solid the patches sit on, turned to face us.
    const corners: P[] = [];
    for (const a of [-1, 1])
      for (const b of [-g, g])
        for (const [x, y, z] of [
          [0, a, b],
          [a, b, 0],
          [b, 0, a],
        ] as P[]) {
          const [y1, z1] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
          corners.push([x * Math.cos(ay) + z1 * Math.sin(ay), y1, z1 * Math.cos(ay) - x * Math.sin(ay)]);
        }
    const near = (p: P, q: P) => Math.abs(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) - 2) < 0.01;
    /** A third of the way from one corner to its neighbour, on the ball, as a point of the picture: one that's
     * behind the ball is set on its rim. */
    const third = (p: P, q: P) => {
      const v = [0, 1, 2].map((i) => (p[i] ?? 0) + ((q[i] ?? 0) - (p[i] ?? 0)) / 3) as P;
      const k = v[2] > 0 ? Math.hypot(...v) : Math.hypot(v[0], v[1]);
      return `${n(cx + (R * v[0]) / k)} ${n(cy + (R * v[1]) / k)}`;
    };
    let patches = "";
    let seams = "";
    for (const p of corners) {
      if (p[2] < -0.3) continue;
      // Its five neighbours, in order around it: each next to the one before.
      const round = corners.filter((q) => near(p, q)).slice(0, 1);
      while (round.length < 5)
        round.push(corners.find((q) => near(p, q) && !round.includes(q) && near(q, round[round.length - 1] ?? p)) ?? p);
      patches += `M${round.map((q) => third(p, q)).join("L")}Z`;
      for (const q of round)
        if (q[2] > 0.3 && corners.indexOf(q) > corners.indexOf(p)) seams += `M${third(p, q)}L${third(q, p)}`;
    }
    return [
      ground,
      ["ks", E(32, 58.5, 15, 2.6)],
      ["kw", C(cx, cy, R)],
      ["l3", seams, 'stroke-width="1.2"'],
      ["k1", patches],
      ["ks", "M49.6 16A23 23 0 0 1 16.1 47.6A25 25 0 0 0 49.6 16Z"],
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
    ["k3", "M33.6 32.9C27.8 26 37.9 11.8 48 8.5Z"],
    ["k2", "M33.6 32.9C42.4 34.6 49.9 19 48 8.5Z"],
    ["l5", "M43.5 27.1L41.5 23.4M46.7 20.9L45 17.4M35.7 18.5L39.9 18.4", 'stroke-width="1.1"'],
    ["l1", "M30 39L48 8.5", 'stroke-width="1.4"'],
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
    .filter(([, d]) => d !== shoulders && d !== chest && d !== chinShadow)
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

/** Every picture's paths, by its id: an avatar's shape ("fox"), "topic-<id>", "mode-<id>" or the
 * streak's "flame". */
export const pictures: Record<string, string> = {
  ...Object.fromEntries(Object.entries(avatars).map(([id, l]) => [id, draw(l)])),
  ...Object.fromEntries(Object.entries(topics).map(([id, l]) => [`topic-${id}`, draw(l)])),
  // „България“, the questions about Bulgaria from every topic: Рила.
  "topic-bulgaria": draw(rila),
  ...Object.fromEntries(Object.entries(modes).map(([id, l]) => [`mode-${id}`, draw(l)])),
  ...Object.fromEntries(Object.entries(marks).map(([id, l]) => [id, draw(l)])),
};

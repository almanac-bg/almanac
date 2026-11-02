// Makes the game's two fonts: Onest (text) and Unbounded (display), each one woff2 cut to the characters the game
// uses and the weights it uses, from the full variable fonts in Google Fonts' repository at a pinned commit (SIL Open
// Font License: see apps/web/src/fonts/). One file per family instead of the five subsets the browser had to fetch.
//
//   node scripts/subset-fonts.mjs
//
// Run it again only to change the character set or move to a newer upstream commit.
import fs from 'node:fs';
import path from 'node:path';
import { Blob, Face } from 'harfbuzzjs';
import subsetFont from 'subset-font';

const COMMIT = 'e7db6ca603fd4862010383ff17ffd6cc4ffac1c0';
const out = path.resolve(import.meta.dirname, '../apps/web/src/fonts');

// Basic Latin, Latin-1 (digits, «», °, ·, ×, ½…) and Latin Extended-A (Š, ş, ă, ć: names in options and credits), the
// pinyin vowels with a caron (ǎ) and Romanian ș ț, Bulgarian Cyrillic (and the rest of the basic block), the combining
// acute for stressed vowels and the grave (Onest has no ѝ or Ѝ: the browser draws them as и, И and the grave), general punctuation („“ — … ′ ″), super- and subscripts (CO₂, 10⁻⁹), the euro, №, ™,
// arrows and the minus sign — each where the font has it (fonts/coverage.json says which; the bank test checks the
// bank against it). The extras (EXTRA) only in Onest, which draws the bank's text: Unbounded draws the game's own
// headings and numbers, and 17 KB more of it on every first visit would buy nothing.
const EXTRA = [
  [0x100, 0x17f],
  [0x1cd, 0x1dc],
  [0x218, 0x21b],
  [0x2070, 0x209f],
];
const RANGES = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x2c6, 0x2c6],
  [0x2dc, 0x2dc],
  [0x300, 0x301],
  [0x400, 0x45f],
  [0x2000, 0x206f],
  [0x20ac, 0x20ac],
  [0x2116, 0x2116],
  [0x2122, 0x2122],
  [0x2190, 0x2199],
  [0x2212, 0x2212],
];
const charsOf = (ranges) =>
  ranges
    .flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)))
    .join('');

const FONTS = [
  {
    file: 'onest.woff2',
    source: 'ofl/onest/Onest%5Bwght%5D.ttf',
    license: 'ofl/onest/OFL.txt',
    wght: { min: 400, max: 900 },
    text: charsOf([...RANGES, ...EXTRA]),
  },
  {
    file: 'unbounded.woff2',
    source: 'ofl/unbounded/Unbounded%5Bwght%5D.ttf',
    license: 'ofl/unbounded/OFL.txt',
    wght: { min: Number(process.env.UNBOUNDED_MIN ?? 600), max: 900 },
    text: charsOf(RANGES),
  },
];

const raw = (p) => `https://raw.githubusercontent.com/google/fonts/${COMMIT}/${p}`;
async function download(p) {
  const res = await fetch(raw(p));
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The code points of `text` a font has, as ranges ([from, to]): what its subset draws. */
function covered(full, text) {
  const has = new Set(new Face(new Blob(full), 0).collectUnicodes());
  const points = [...new Set([...text].map((c) => c.codePointAt(0)))].filter((u) => has.has(u)).sort((a, b) => a - b);
  const ranges = [];
  for (const u of points) {
    const last = ranges.at(-1);
    if (last && last[1] === u - 1) last[1] = u;
    else ranges.push([u, u]);
  }
  return ranges;
}

fs.mkdirSync(out, { recursive: true });
const coverage = {};
for (const font of FONTS) {
  const full = await download(font.source);
  coverage[font.file.replace('.woff2', '')] = covered(full, font.text);
  // Name IDs 13 and 14 too (the licence and its URL), beside the copyright and names kept by default: the OFL asks for
  // the licence with every copy, and the served woff2 is one.
  const woff2 = await subsetFont(full, font.text, {
    targetFormat: 'woff2',
    variationAxes: { wght: font.wght },
    preserveNameIds: [13, 14],
  });
  fs.writeFileSync(path.join(out, font.file), woff2);
  const family = font.file.replace('.woff2', '');
  fs.writeFileSync(path.join(out, `OFL-${family}.txt`), await download(font.license));
  console.log(`${font.file}: ${(full.length / 1024).toFixed(0)} KB → ${(woff2.length / 1024).toFixed(1)} KB`);
}
fs.writeFileSync(path.join(out, 'coverage.json'), `${JSON.stringify(coverage)}\n`);

// The brand lockup: the rosette (public/favicon.svg) and the name (packages/shared/src/brand.ts) in Unbounded Black,
// the name as outlines — so it looks the same where no font can load: the app's first frame (index.html), the
// offline page (public/offline.html) and Caddy's page while the app restarts (deploy/Caddyfile). Written to
// public/brand-lockup.svg and between the `lockup` markers in those three; test/brand.test.ts (server) checks they
// match. The name takes `currentColor`; the petals have the classes `gold` and `petal`, with the dark theme's colours
// as their default fill, for each page's own CSS. Also drawn from it: the mails' heading (public/mail/lockup.png, at
// twice the size it's shown, on the mails' dark card) and the logo for BIMI (public/bimi.svg, SVG Tiny PS: the
// rosette on its tile, square), which mail apps show beside the sender once DMARC refuses what fails.
//
//   npm run lockup -w @almanac/web      (after a change to the name, the mark or the font)
import fs from 'node:fs';
import path from 'node:path';
import fontverter from 'fontverter';
import { Blob, Face, Font, Buffer as Glyphs, shape, Variation } from 'harfbuzzjs';
import sharp from 'sharp';

const root = path.join(import.meta.dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const name = /name: '([^']+)'/.exec(read('packages/shared/src/brand.ts'))?.[1];
if (!name) throw new Error("brand.ts no longer has the `name: '…'` this script reads");
const petals = [
  ...read('apps/web/public/favicon.svg').matchAll(/<path d="([^"]+)" transform="rotate\((-?\d+) 32 32\)"/g),
];
if (petals.length !== 4) throw new Error('favicon.svg no longer has the four petals this script knows');

// The font as the site serves it (scripts/subset-fonts.mjs): every letter the name can use is in it.
const sfnt = await fontverter.convert(fs.readFileSync(path.join(root, 'apps/web/src/fonts/unbounded.woff2')), 'sfnt');
const face = new Face(new Blob(sfnt));
const font = new Font(face);
font.setVariations([new Variation('wght', 900)]);
const buffer = new Glyphs();
buffer.addText(name);
buffer.guessSegmentProperties();
shape(font, buffer);

// In units of the type size (1000 = 1 em), as the nav bar's Logo sets it: the rosette 0.95 em tall, 0.3 em before the
// name, the name tracked −0.025 em (tracking-tight).
const em = 1000;
const k = em / face.upem;
const tracking = -0.025 * em;
const capHeight = (font.glyphExtents(buffer.getGlyphInfos()[0].codepoint)?.yBearing ?? 0.7 * face.upem) * k;
const markSize = 0.95 * em;
const gap = 0.3 * em;
// Baseline below the top by what centres the capitals on the rosette.
const baseline = markSize / 2 + capHeight / 2;

/** A glyph's outline (font units, y up) moved to x and the baseline, y down, whole units. */
function placed(d, dx) {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  let i = 0;
  return d.replace(/[MLQCZ]|-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g, (token) => {
    if (/^[MLQCZ]$/.test(token)) return token;
    const [x, y] = [numbers[i++], numbers[i++]];
    return `${Math.round(dx + x * k)},${Math.round(baseline - y * k)}`;
  });
}

let x = markSize + gap;
let outline = '';
const infos = buffer.getGlyphInfos();
const positions = buffer.getGlyphPositions();
infos.forEach((glyph, n) => {
  outline += placed(font.glyphToPath(glyph.codepoint), x + positions[n].xOffset * k);
  x += positions[n].xAdvance * k + (n < infos.length - 1 ? tracking : 0);
});
const width = Math.ceil(x);

// The petals at the rosette's place: favicon.svg's viewBox 8.5 8.5 47 47 scaled to markSize.
const s = markSize / 47;
const mark = petals
  .map(([, d, turn], n) => {
    const [cls, fill] = n === 0 ? ['gold', '#fbbf24'] : ['petal', '#c4b5fd'];
    return `<path class="${cls}" fill="${fill}" d="${d}" transform="rotate(${turn} 32 32)"/>`;
  })
  .join('');
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" class="lockup" role="img" aria-label="${name}" viewBox="0 0 ${width} ${markSize}">` +
  `<g transform="scale(${s.toFixed(4)}) translate(-8.5 -8.5)">${mark}</g>` +
  `<path fill="currentColor" d="${outline}"/></svg>`;

fs.writeFileSync(path.join(root, 'apps/web/public/brand-lockup.svg'), `${svg}\n`);
for (const file of ['apps/web/index.html', 'apps/web/public/offline.html', 'deploy/Caddyfile']) {
  const text = read(file);
  const marked = /<!--lockup-->[\s\S]*?<!--\/lockup-->/;
  if (!marked.test(text)) throw new Error(`${file} has no <!--lockup-->…<!--/lockup--> markers`);
  fs.writeFileSync(path.join(root, file), text.replace(marked, `<!--lockup-->${svg}<!--/lockup-->`));
}
console.log(`brand-lockup.svg: ${name}, ${width} × ${markSize}, ${svg.length} bytes`);

// The mails' heading: shown 180 px wide (mailer.ts), drawn at twice that, the name in the mails' text colour on
// their card's.
const mailWidth = 360;
const mailPng = await sharp(Buffer.from(svg.replace('fill="currentColor"', 'fill="#f5f3ff"')), { density: 300 })
  .resize(mailWidth)
  .flatten({ background: '#15122a' })
  .png({ palette: true, compressionLevel: 9 })
  .toBuffer();
fs.mkdirSync(path.join(root, 'apps/web/public/mail'), { recursive: true });
fs.writeFileSync(path.join(root, 'apps/web/public/mail/lockup.png'), mailPng);
console.log(`mail/lockup.png: ${mailWidth} × ${Math.round((mailWidth * markSize) / width)}, ${mailPng.length} bytes`);

// BIMI's logo: SVG Tiny PS — a title, a square solid ground, nothing external, no script.
const tile = /<rect [^>]*fill="(#[0-9a-f]{6})"/.exec(read('apps/web/public/favicon.svg'))?.[1] ?? '#140f26';
const bimi =
  `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 64 64">` +
  `<title>${name}</title><rect width="64" height="64" fill="${tile}"/>` +
  `<g transform="translate(6.4 6.4) scale(0.8)">${mark.replaceAll(/ class="\w+"/g, '')}</g></svg>`;
fs.writeFileSync(path.join(root, 'apps/web/public/bimi.svg'), `${bimi}\n`);
console.log(`bimi.svg: ${bimi.length} bytes`);

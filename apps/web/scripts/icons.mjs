// The app's PNG icons, drawn from public/favicon.svg: `npm run icons -w @quiz/web` after a change to the mark.
// Each is drawn on a canvas in a browser and exported from it — not a screenshot, which a window smaller than asked
// for cuts off and pads with a second copy (what broke icon-192 and icon-512 in October 2026):
// - icon-192.png, icon-512.png: favicon.svg as it is (the rounded tile, its corners transparent);
// - apple-touch-icon.png, icon-maskable-512.png: the rosette on a full square of the tile's colour, as iOS and Android
//   round or cut the corners themselves (the maskable one keeps the rosette inside the middle 80%, which every mask
//   leaves whole);
// - favicon.ico: the 32-pixel icon in an .ico wrapper, for what still asks for /favicon.ico;
// - badge-96.png: the rosette in white on transparent, as Android reads only the alpha channel of a notification's
//   status-bar badge.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const pub = path.join(import.meta.dirname, '..', 'public');
const icon = fs.readFileSync(path.join(pub, 'favicon.svg'), 'utf8');
const rosette = /<g id="rosette">[\s\S]*?<\/g>/.exec(icon)?.[0];
const tile = /<rect [^>]*fill="(#[0-9a-f]{6})"/.exec(icon)?.[1];
if (!rosette || !tile) throw new Error('favicon.svg no longer has the tile and the rosette group this script knows');
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;
// The rosette reaches 23.2 units from the middle: on a full square it stays as large as on the tile (the maskable
// safe zone is a circle of radius 25.6 here).
const fullBleed = svg(`<rect width="64" height="64" fill="${tile}"/>${rosette}`);
const badge = svg(rosette.replace(/fill="#[0-9a-f]{6}"/g, 'fill="#fff"'));

const browser = await chromium.launch(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {});
const page = await browser.newPage();
async function png(markup, size) {
  const url = await page.evaluate(
    async ({ markup, size }) => {
      const img = new Image(size, size);
      img.src = `data:image/svg+xml;base64,${btoa(markup)}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      return canvas.toDataURL('image/png');
    },
    { markup, size },
  );
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}
/** An .ico holding one PNG (every browser since IE 11 reads a PNG inside). */
function ico(image, size) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(1, 4); // one image
  head.writeUInt8(size, 6);
  head.writeUInt8(size, 7);
  head.writeUInt16LE(1, 10); // colour planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(image.length, 14);
  head.writeUInt32LE(22, 18); // where the image starts
  return Buffer.concat([head, image]);
}
for (const [file, data] of [
  ['icon-192.png', await png(icon, 192)],
  ['icon-512.png', await png(icon, 512)],
  ['apple-touch-icon.png', await png(fullBleed, 180)],
  ['icon-maskable-512.png', await png(fullBleed, 512)],
  ['favicon.ico', ico(await png(icon, 32), 32)],
  ['badge-96.png', await png(badge, 96)],
]) {
  fs.writeFileSync(path.join(pub, file), data);
  console.log(`public/${file}`);
}
await browser.close();

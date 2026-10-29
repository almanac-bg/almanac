// The app's PNG icons, drawn from public/favicon.svg: `npm run icons -w @quiz/web` after a change to the mark.
// Each is drawn on a canvas in a browser and exported from it — not a screenshot, which a window smaller than asked
// for cuts off and pads with a second copy (what broke icon-192 and icon-512 in October 2026). Also the badge Android
// shows in the status bar for a notification: the mark in white on transparent, as it reads only the alpha channel.
// (apple-touch-icon.png, icon-maskable-512.png and favicon.ico are drawn with the mark on a full square: unchanged.)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const pub = path.join(import.meta.dirname, '..', 'public');
const icon = fs.readFileSync(path.join(pub, 'favicon.svg'), 'utf8');

// The mark's two shapes, as in favicon.svg: the A, and the bolt across it.
const A = /<path d="(M15 53[^"]+)"/.exec(icon)?.[1];
const BOLT = /<path d="(M12 44[^"]+)"/.exec(icon)?.[1];
if (!A || !BOLT) throw new Error('favicon.svg no longer has the A and the bolt this script knows');
// White, the A cut where the bolt crosses it (as the dark outline does in colour), then the bolt.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><mask id="m"><rect width="64" height="64" fill="#fff"/><path d="${BOLT}" fill="#000" stroke="#000" stroke-width="5.2" stroke-linejoin="round"/></mask></defs>
  <path d="${A}" mask="url(#m)" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${BOLT}" fill="#fff"/>
</svg>`;

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
for (const [file, markup, size] of [
  ['icon-192.png', icon, 192],
  ['icon-512.png', icon, 512],
  ['badge-96.png', badge, 96],
]) {
  fs.writeFileSync(path.join(pub, file), await png(markup, size));
  console.log(`public/${file}`);
}
await browser.close();

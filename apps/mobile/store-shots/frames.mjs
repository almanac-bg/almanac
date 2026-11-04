// The stores' pictures (docs/app-stores.md → Снимките в магазините): each a caption in the app's fonts above a real
// screen of the app, on its ink with its violet and pink — for every size App Store Connect and Play Console take —
// plus Google Play's feature graphic and icon.
//
//   node apps/mobile/store-shots/frames.mjs <captures> <out>
//
// <captures> holds iphone/ and ipad/, each with one simulator screenshot per frame, named as FRAMES below
// (daily-picture.png …), taken with flows/ (README there). iPad captures lose iPadOS's window-resize mark; Google
// Play's lose the iPhone's status bar.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const { chromium } = createRequire(path.join(root, 'package.json'))('playwright');
const sharp = createRequire(path.join(root, 'apps/server/package.json'))('sharp');

/** The seven, in the stores' order: the first three are what a search shows. "*words*" take the gradient. */
const FRAMES = [
  {
    name: 'daily-picture',
    lockup: true,
    title: '*10 въпроса*\nна деня',
    sub: 'Едни и същи за цяла България. Един опит до полунощ.',
  },
  { name: 'daily-fact', title: '*Знаеше ли?*', sub: 'След отговора — факт, който си струва да запомниш.' },
  { name: 'royale', title: '*Роял*', sub: 'Осем влизат. Последният отпада. Оцелява един.' },
  { name: 'duel', title: '*Дуел* на живо', sub: 'Лице в лице. Печели по-бързият ум.' },
  {
    name: 'final',
    title: 'Финал *с число*',
    sub: 'Колкото по-близо, толкова повече точки — а финалът носи двойно.',
  },
  { name: 'rewards', title: 'Нива и *награди*', sub: 'Аватари, рамки и титли — спечелени с игра.' },
  {
    name: 'knowledge',
    title: 'Моите *знания*',
    sub: 'Всичко научено — на едно място. Грешките се връщат за поправителен.',
  },
];

/** The sets: App Store Connect's iPhone slot takes 6.1"/6.3" (1206×2622); 6.9" is kept for when it asks for it. */
const SETS = [
  { dir: 'app-store-iphone', from: 'iphone', size: [1206, 2622], radius: 0.12 },
  { dir: 'app-store-iphone-6.9', from: 'iphone', size: [1320, 2868], radius: 0.12 },
  { dir: 'app-store-ipad-13', from: 'ipad', size: [2064, 2752], radius: 0.035, title: 70, cap: 200, shot: 0.84 },
  // Play: at most 2:1, and no iPhone status bar (62 pt at 3×).
  { dir: 'google-play-phone', from: 'iphone', size: [1440, 2560], radius: 0.07, cropStatusBar: true },
];

const [capturesDir, outDir] = process.argv.slice(2);
if (!capturesDir || !outDir) {
  console.error('Usage: node apps/mobile/store-shots/frames.mjs <captures> <out>');
  process.exit(2);
}

const FONTS = path.join(root, 'apps/mobile/node_modules/@expo-google-fonts');
const font = (f) => `url(data:font/ttf;base64,${fs.readFileSync(f).toString('base64')})`;
const FONT_CSS = `
@font-face { font-family: U; font-weight: 800; src: ${font(`${FONTS}/unbounded/800ExtraBold/Unbounded_800ExtraBold.ttf`)}; }
@font-face { font-family: O; font-weight: 500; src: ${font(`${FONTS}/onest/500Medium/Onest_500Medium.ttf`)}; }`;
const lockup = fs.readFileSync(path.join(root, 'apps/web/public/brand-lockup.svg'), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** iPadOS draws its window-resize mark (◞) in the bottom-right corner: painted over with the colour beside it. */
async function withoutResizeMark(bytes) {
  const { width, height } = await sharp(bytes).metadata();
  const { data } = await sharp(bytes)
    .extract({ left: width - 80, top: height - 30, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const patch = await sharp({
    create: { width: 72, height: 72, channels: 3, background: { r: data[0], g: data[1], b: data[2] } },
  })
    .png()
    .toBuffer();
  return sharp(bytes)
    .composite([{ input: patch, left: width - 72, top: height - 72 }])
    .png()
    .toBuffer();
}

function page(frame, set, shot) {
  const [W, H] = set.size;
  const s = W / 1320;
  const title = esc(frame.title)
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}
  * { margin: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    background:
      radial-gradient(${1300 * s}px ${1000 * s}px at 12% 4%, rgba(124, 58, 237, .42), transparent 62%),
      radial-gradient(${1100 * s}px ${1100 * s}px at 100% 52%, rgba(219, 39, 119, .20), transparent 60%),
      radial-gradient(${1200 * s}px ${900 * s}px at 0% 100%, rgba(147, 51, 234, .22), transparent 62%),
      #07060d;
    color: #f5f3ff; display: flex; flex-direction: column; align-items: center;
    padding: ${(frame.lockup ? 120 : 150) * s}px ${80 * s}px 0;
  }
  .cap { display: flex; flex-direction: column; align-items: center; min-height: ${frame.lockup ? 0 : (set.cap ?? 262) * s}px; }
  .lockup { width: ${430 * s}px; color: #f5f3ff; margin-bottom: ${64 * s}px; }
  .lockup svg { width: 100%; height: auto; display: block; }
  h1 { font: 800 ${(set.title ?? 88) * s}px/1.14 U, sans-serif; text-align: center; letter-spacing: -0.01em; }
  em { font-style: normal; background: linear-gradient(110deg, #d8b4fe, #a78bfa 45%, #f472b6);
       -webkit-background-clip: text; background-clip: text; color: transparent; }
  p { font: 500 ${48 * s}px/1.32 O, sans-serif; color: #c9c4e0; text-align: center; margin-top: ${30 * s}px; max-width: ${1120 * s}px; text-wrap: balance; }
  .frame { margin-top: ${70 * s}px; flex: 1 1 auto; min-height: 0; width: 100%; display: flex; justify-content: center; padding-bottom: ${110 * s}px; }
  .screen { height: 100%; aspect-ratio: ${shot.w} / ${shot.h}; max-width: ${(set.shot ?? 0.8) * W}px; overflow: hidden; align-self: flex-start;
            box-shadow: 0 0 0 ${3 * s}px rgba(196, 181, 253, .16), 0 ${40 * s}px ${140 * s}px rgba(0, 0, 0, .65), 0 0 ${160 * s}px rgba(139, 92, 246, .28);
            background: url(${shot.url}) 0 0 / 100% auto no-repeat; }
  </style></head><body>
  ${frame.lockup ? `<div class="lockup">${lockup}</div>` : ''}
  <div class="cap"><h1>${title}</h1>${frame.sub ? `<p>${esc(frame.sub)}</p>` : ''}</div>
  <div class="frame"><div class="screen" id="screen"></div></div>
  </body></html>`;
}

const browser = await chromium.launch();
try {
  for (const set of SETS) {
    fs.mkdirSync(path.join(outDir, set.dir), { recursive: true });
    for (const [i, frame] of FRAMES.entries()) {
      const file = path.join(capturesDir, set.from, `${frame.name}.png`);
      if (!fs.existsSync(file)) throw new Error(`No capture: ${file}`);
      let bytes = fs.readFileSync(file);
      if (set.from === 'ipad') bytes = await withoutResizeMark(bytes);
      const meta = await sharp(bytes).metadata();
      if (set.cropStatusBar) {
        const top = Math.round((meta.width / 1320) * 186);
        bytes = await sharp(bytes)
          .extract({ left: 0, top, width: meta.width, height: meta.height - top })
          .toBuffer();
      }
      const { width: w, height: h } = await sharp(bytes).metadata();
      const shot = { w, h, url: `data:image/png;base64,${bytes.toString('base64')}` };
      const tab = await browser.newPage({
        viewport: { width: set.size[0], height: set.size[1] },
        deviceScaleFactor: 1,
      });
      await tab.setContent(page(frame, set, shot), { waitUntil: 'load' });
      await tab.evaluate(() => document.fonts.ready);
      // Rounded as a phone's (or an iPad's) screen, from the width it's drawn at.
      await tab.evaluate((radius) => {
        const el = document.getElementById('screen');
        el.style.borderRadius = `${el.getBoundingClientRect().width * radius}px`;
      }, set.radius);
      const out = path.join(outDir, set.dir, `${i + 1}-${frame.name}.png`);
      await tab.screenshot({ path: out, type: 'png' });
      await tab.close();
    }
    console.log(`${set.dir}: ${FRAMES.length} at ${set.size.join('×')}`);
  }

  // Google Play's feature graphic (1024×500) and its icon (512×512, the app's own).
  const tab = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  await tab.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}
    * { margin: 0; box-sizing: border-box; }
    html, body { width: 1024px; height: 500px; overflow: hidden; }
    body { background:
      radial-gradient(620px 460px at 8% 0%, rgba(124, 58, 237, .55), transparent 65%),
      radial-gradient(560px 520px at 100% 100%, rgba(219, 39, 119, .32), transparent 62%), #07060d;
      color: #f5f3ff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; }
    .lockup { width: 560px; color: #f5f3ff; } .lockup svg { width: 100%; height: auto; display: block; }
    p { font: 500 31px/1.3 O, sans-serif; color: #d6d1ec; text-align: center; }
    </style></head><body><div class="lockup">${lockup}</div>
    <p>10 въпроса на деня за цяла България · дуели · Роял</p></body></html>`,
    { waitUntil: 'load' },
  );
  await tab.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.join(outDir, 'google-play-graphics'), { recursive: true });
  await tab.screenshot({
    path: path.join(outDir, 'google-play-graphics', 'feature-graphic-1024x500.png'),
    type: 'png',
  });
  await sharp(path.join(root, 'apps/mobile/assets/icon.png'))
    .resize(512, 512)
    .png()
    .toFile(path.join(outDir, 'google-play-graphics', 'icon-512.png'));
  console.log('google-play-graphics: feature graphic, icon');
} finally {
  await browser.close();
}

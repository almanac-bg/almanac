// The pictures a shared link shows: public/og.jpg (the site's preview on social networks and chats) and
// .github/social-preview.png (the repository's, uploaded by hand: docs/maintainers.md). `npm run share-images -w
// @quiz/web` after a change to the mark or the words. Drawn as a page in a browser; the fonts come from Google Fonts
// here only (the site serves its own subsets).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.join(import.meta.dirname, '..', '..', '..');
const icon = fs.readFileSync(path.join(root, 'apps/web/public/favicon.svg'), 'utf8');
const rosette = /<g id="rosette">[\s\S]*?<\/g>/.exec(icon)?.[0];
if (!rosette) throw new Error('favicon.svg no longer has the rosette group this script knows');
const mark = (size) => `<svg viewBox="8.5 8.5 47 47" width="${size}" height="${size}">${rosette}</svg>`;

const page = ({ width, height, badge, lines, pills, lead }) => `<!doctype html>
<html lang="bg"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@900&family=Onest:wght@500;700&display=block" rel="stylesheet">
<style>
  body { margin: 0; }
  .card {
    width: ${width}px; height: ${height}px; box-sizing: border-box; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 22px; font-family: Onest, sans-serif; color: #f5f3ff;
    background:
      radial-gradient(ellipse 60% 70% at 18% 12%, rgb(124 58 237 / 0.38), transparent 70%),
      radial-gradient(ellipse 50% 60% at 88% 92%, rgb(8 145 178 / 0.22), transparent 70%),
      linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px) 0 0 / 48px 48px,
      linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px) 0 0 / 48px 48px,
      #07060d;
  }
  .badge { display: flex; align-items: center; gap: 10px; padding: 8px 18px; border-radius: 999px; font-size: 21px;
    font-weight: 500; color: #d6d1ee; background: rgb(255 255 255 / 0.06); border: 1px solid rgb(255 255 255 / 0.1); }
  .badge i { width: 9px; height: 9px; border-radius: 50%; background: #34d399; }
  .lockup { display: flex; align-items: center; gap: 30px; }
  .name { font-family: Unbounded, sans-serif; font-weight: 900; font-size: 112px; letter-spacing: -0.02em; line-height: 1; }
  .domain { margin-top: -4px; font-family: Unbounded, sans-serif; font-weight: 900; font-size: 24px;
    letter-spacing: 0.42em; color: #8a84ab; text-transform: uppercase; }
  .lines { text-align: center; font-size: 34px; line-height: 1.35; font-weight: 500; color: #c9c3e6; }
  .lines b { color: #fff; font-weight: 700; }
  .pills { display: flex; gap: 14px; margin-top: 6px; }
  .pills span { padding: 13px 22px; border-radius: 18px; font-size: 23px; font-weight: 700; color: #e9e6f7;
    background: rgb(255 255 255 / 0.05); border: 1px solid rgb(255 255 255 / 0.1); }
  .pills .lead { color: #fde68a; background: rgb(251 191 36 / 0.1); border-color: rgb(251 191 36 / 0.35); }
</style></head>
<body><div class="card">
  <div class="badge"><i></i>${badge}</div>
  <div class="lockup">${mark(104)}<span class="name">АЛМАНАХ</span></div>
  <div class="domain">almanac.bg</div>
  <div class="lines">${lines}</div>
  <div class="pills">${pills.map((p, i) => `<span${lead && i === 0 ? ' class="lead"' : ''}>${p}</span>`).join('')}</div>
</div></body></html>`;

const images = [
  {
    file: 'apps/web/public/og.jpg',
    width: 1200,
    height: 630,
    badge: 'Безплатна онлайн викторина',
    lines: '10 въпроса на деня. Една класация за цяла България.<br><b>Кой знае най-много?</b>',
    // The day's questions first and in gold, as on the site.
    pills: ['Въпросите на деня', 'Предизвикай приятел', 'Дуели и Роял', 'Стаи'],
    lead: true,
  },
  {
    file: '.github/social-preview.png',
    width: 1280,
    height: 640,
    badge: 'Отворен код · AGPL-3.0',
    lines: 'Куиз битки в реално време.<br><b>Целият код на играта — отворен за всеки.</b>',
    pills: ['React', 'Node.js', 'Socket.IO', 'SQLite', 'Автоматични тестове'],
  },
];

const browser = await chromium.launch(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {});
for (const image of images) {
  const tab = await browser.newPage({ viewport: { width: image.width, height: image.height } });
  await tab.setContent(page(image), { waitUntil: 'networkidle' });
  await tab.evaluate(() => document.fonts.ready);
  const jpeg = image.file.endsWith('.jpg');
  await tab.screenshot({
    path: path.join(root, image.file),
    clip: { x: 0, y: 0, width: image.width, height: image.height },
    ...(jpeg ? { type: 'jpeg', quality: 88 } : {}),
  });
  console.log(image.file);
  await tab.close();
}
await browser.close();

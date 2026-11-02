// The install sheet's screenshots (the manifest's `screenshots`, vite.config.ts): the built app in the dark theme — three
// phone screens under their captions (the manifest's labels) and the landing on a wide screen. A guest plays on the
// public sample bank; the landing, which shows only how many questions there are, is taken on the real bank where it
// is checked out (private/), so it says what the site says. Chrome shows them when the app is installed, beside the icon, so they go stale with the
// mark or the screens: run again after `npm run lockup` / `icons`, or a change to the landing, the lobby or a question.
//
//   npm run build && npm run store-shots -w @quiz/web
//
// Its own port (SHOTS_PORT, default 3251) and a throwaway database; BROWSER_PATH for a browser other than Playwright's.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const root = path.join(import.meta.dirname, '..', '..', '..');
const out = path.join(root, 'apps/web/public/screenshots');
const sample = path.join(root, 'apps/server/src/data/questions.sample.json');
const real = path.join(root, 'private/questions.json');
const port = Number(process.env.SHOTS_PORT ?? 3251);
const base = `http://localhost:${port}`;

// The captions are the manifest's labels, so the two can't drift apart.
const manifest = fs.readFileSync(path.join(root, 'apps/web/vite.config.ts'), 'utf8');
const label = (name) => {
  const found = new RegExp(`src: '/screenshots/${name}\\.webp'[\\s\\S]*?label: '([^']+)'`).exec(manifest)?.[1];
  if (!found) throw new Error(`vite.config.ts has no screenshot ${name}.webp with a label`);
  return found;
};

// ─── The server: the built one, on a bank, with a throwaway database and nothing from this shell ────────────────────
async function serve(bank) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-shots-'));
  const server = spawn(process.execPath, [path.join(root, 'apps/server/dist/index.mjs')], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      PORT: String(port),
      APP_URL: base,
      DB_PATH: path.join(data, 'quiz.db'),
      QUESTIONS_PATH: bank,
      BACKUP_DIR: 'off',
      EVENING_AT: 'off',
      OPERATOR_NAME: 'АЛМАНАХ',
      OPERATOR_ADDRESS: 'София',
      INBOX_PROVIDER: '',
      MAILBOX_PROVIDER: 'Поща',
      DRAIN_SECONDS: '0',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const stop = async () => {
    const gone = new Promise((r) => server.once('exit', r));
    server.kill('SIGTERM');
    await gone;
    fs.rmSync(data, { recursive: true, force: true });
  };
  for (let tries = 0; ; tries++) {
    if (tries > 60) {
      await stop();
      throw new Error(`the server didn't answer on ${base} (built? npm run build)`);
    }
    if (
      await fetch(`${base}/api/health`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return stop;
    await new Promise((r) => setTimeout(r, 500));
  }
}

const browser = await chromium.launch(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {});
// A phone: 400 CSS px across, drawn at 2.4× — the card in the picture is 960 px wide.
const phone = { viewport: { width: 400, height: 680 }, deviceScaleFactor: 2.4, isMobile: true, hasTouch: true };
const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
};
const context = (options) =>
  browser.newContext({ ...options, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'bg-BG' });

const shots = {};
let stop = await serve(fs.existsSync(real) ? real : sample);
try {
  // The landing a new visitor sees: the day's questions first.
  {
    const ctx = await context(phone);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.getByRole('button', { name: 'Играй като гост', exact: true }).first().waitFor();
    await settle(page);
    shots['daily-phone'] = await page.screenshot();
    await ctx.close();
  }

  // The landing on a wide screen, as it is (no caption): 1280 × 720 drawn at 1.5×.
  {
    const ctx = await context({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.getByRole('button', { name: 'Играй като гост', exact: true }).first().waitFor();
    await settle(page);
    await sharp(await page.screenshot())
      .webp({ quality: 82 })
      .toFile(path.join(out, 'landing-wide.webp'));
    console.log('landing-wide.webp');
    await ctx.close();
  }
  await stop();
  stop = await serve(sample);

  // A guest: the lobby, then a Geography question (every one in the sample has a fact) answered right, and its fact.
  {
    const ctx = await context(phone);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.getByRole('button', { name: 'Играй като гост', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Избери битка', exact: true }).waitFor();
    await settle(page);
    shots['lobby-phone'] = await page.screenshot();

    await page.getByRole('button', { name: 'Играй Соло', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Избери категория', exact: true });
    await picker.getByRole('button', { name: 'Без часовник', exact: true }).click();
    await picker.getByRole('button', { name: 'География' }).click();
    const options = page.getByRole('button', { name: /^[АБВГ]\) /, disabled: false });
    await options.first().waitFor({ timeout: 20_000 });
    const bank = JSON.parse(fs.readFileSync(sample, 'utf8'));
    // The question as the card shows it (without what it says to a screen reader alone), spaces as typed.
    const plain = (text) => text.replace(/\s+/g, ' ').trim();
    const heading = await page
      .locator('h1')
      .first()
      .evaluate((h) =>
        [...h.childNodes]
          .filter((n) => !n.classList?.contains('sr-only'))
          .map((n) => n.textContent)
          .join(''),
      );
    const question = bank.find((q) => plain(q.q) === plain(heading));
    if (!question?.options) throw new Error(`the first question isn't one with options from the sample: ${heading}`);
    await options.filter({ hasText: question.options[question.answer] }).first().click();
    // Without a clock the match waits on the reveal by itself (no „Спри, за да прочета“ needed).
    await page.getByText('Знаеше ли?', { exact: true }).waitFor();
    await settle(page);
    shots['question-phone'] = await page.screenshot();
    await ctx.close();
  }

  // Each phone screen under its caption, 1080 × 1920: the caption's band, then the screen in a card, cut at the bottom.
  const onest = fs.readFileSync(path.join(root, 'apps/web/src/fonts/onest.woff2')).toString('base64');
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
  const page = await ctx.newPage();
  for (const [name, png] of Object.entries(shots)) {
    await page.setContent(`<!doctype html><html lang="bg"><head><meta charset="utf-8"><style>
      @font-face { font-family: Onest; src: url(data:font/woff2;base64,${onest}) format('woff2'); font-weight: 100 900; }
      body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #07060d; font-family: Onest; }
      .band { height: 300px; display: grid; place-items: center; padding: 0 80px; box-sizing: border-box;
        background: linear-gradient(100deg, #7c3aed, #c026d3 60%, #db2777); color: #fff; text-align: center;
        font-size: 58px; font-weight: 700; line-height: 1.22; text-wrap: balance; }
      img { display: block; width: 960px; margin: 40px auto 0; border-radius: 44px 44px 0 0;
        box-shadow: 0 0 0 2px rgb(255 255 255 / 0.08), 0 30px 80px rgb(124 58 237 / 0.35); }
    </style></head><body><div class="band">${label(name)}</div>
    <img src="data:image/png;base64,${png.toString('base64')}" alt=""></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const picture = await page.screenshot({ clip: { x: 0, y: 0, width: 1080, height: 1920 } });
    await sharp(picture)
      .webp({ quality: 82 })
      .toFile(path.join(out, `${name}.webp`));
    console.log(`${name}.webp`);
  }
  await ctx.close();
} finally {
  await browser.close();
  await stop();
}

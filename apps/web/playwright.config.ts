import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Browser tests (e2e/): the production build (the server bundle, serving the built web app) in a real browser.
 *
 *   npm run test:browser                 from the repo root: builds, then runs them
 *   npm run test:browser -w @quiz/web    runs them against the build there is
 *   npx playwright show-report           (in apps/web) the last run's report
 *
 * The browser: BROWSER_PATH points at any installed Chromium-based browser (Brave, Chromium, Edge…), e.g.
 *   BROWSER_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" npm run test:browser
 * Without it, the system's Google Chrome (as in CI). Playwright's own browser downloads aren't needed for that; for
 * WebKit and Firefox (E2E_ENGINES below) they are.
 */

const CI = !!process.env.CI;
const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${PORT}`;
const root = path.resolve(import.meta.dirname, '../..');
const serverEntry = path.join(root, 'apps/server/dist/index.mjs');
const webIndex = path.join(root, 'apps/web/dist/index.html');
const outputDir = path.join(import.meta.dirname, 'test-results');

// A missing build would surface as a server that can't start or pages that 404. Checked once, in the runner.
if (!process.env.TEST_WORKER_INDEX) {
  const missing = [serverEntry, webIndex]
    .filter((file) => !fs.existsSync(file))
    .map((file) => path.relative(root, file));
  if (missing.length) throw new Error(`No build to test (${missing.join(', ')} missing): run "npm run build" first.`);
}

const browserPath = process.env.BROWSER_PATH;
/** The game's speed in the tests (GAME_TIME_SCALE below): slower engines get more time, and the tests with it. */
const timeScale = process.env.E2E_TIME_SCALE ?? '0.15';

/**
 * Safari's engine and Firefox's too, beside Chromium's: `E2E_ENGINES=webkit,firefox` adds their projects (CI runs each
 * in a job of its own, with `--project`). Playwright's own builds of them: `npx playwright install webkit firefox`. On
 * a Mac newer than Playwright's Firefox build, `E2E_FIREFOX=app` drives the installed Firefox instead.
 */
const engines = (process.env.E2E_ENGINES ?? '').split(',').filter(Boolean);
const PHONE = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
/** The Chromium-based browser for the main projects: BROWSER_PATH's, or the system's Chrome. */
const chromium = browserPath ? { launchOptions: { executablePath: browserPath } } : { channel: 'chrome' };

export default defineConfig({
  testDir: './e2e',
  outputDir,
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // The tests mostly wait on the game's timers, not the CPU: four at once even on a small CI runner (one at a time,
  // the suite would take over a minute and a half).
  workers: CI ? 4 : undefined,
  timeout: Math.round(60_000 * Math.max(1, Number(timeScale) / 0.15)),
  expect: { timeout: 10_000 },
  reporter: CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    locale: 'bg-BG',
    timezoneId: 'Europe/Sofia',
    // The app honors it (MotionConfig, confetti): nothing slides around while the tests click and measure.
    reducedMotion: 'reduce',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Most players are on phones: every test runs on one (touch, a 375 px screen)…
    { name: 'phone', grepInvert: /@desktop/, use: { ...chromium, ...PHONE } },
    // …and the ones tagged @desktop on a laptop.
    { name: 'desktop', grep: /@desktop/, use: { ...chromium, ...DESKTOP } },
    ...(engines.includes('webkit')
      ? [
          // An iPhone's Safari, as far as an engine goes.
          {
            name: 'webkit-phone',
            grepInvert: /@desktop/,
            use: { browserName: 'webkit' as const, ...PHONE },
          },
          {
            name: 'webkit-desktop',
            grep: /@desktop/,
            use: { browserName: 'webkit' as const, ...DESKTOP },
          },
        ]
      : []),
    ...(engines.includes('firefox')
      ? [
          // Firefox has no phone mode: a phone-sized window with touch.
          {
            name: 'firefox-phone',
            grepInvert: /@desktop/,
            use: {
              browserName: 'firefox' as const,
              ...PHONE,
              isMobile: false,
              ...(process.env.E2E_FIREFOX === 'app' && { channel: 'moz-firefox' }),
            },
          },
          {
            name: 'firefox-desktop',
            grep: /@desktop/,
            use: {
              browserName: 'firefox' as const,
              ...DESKTOP,
              ...(process.env.E2E_FIREFOX === 'app' && { channel: 'moz-firefox' }),
            },
          },
        ]
      : []),
  ],

  webServer: {
    command: `node ${JSON.stringify(serverEntry)}`,
    url: `${baseURL}/api/health`,
    // Always a fresh server: a new database, and no rate limits left over from an earlier run. (Within a run they
    // apply: 20 new guests an hour from one address, so --repeat-each above 2 runs into them.)
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    env: {
      // As deployed (e.g. the first account to sign up doesn't become a moderator).
      NODE_ENV: 'production',
      PORT: String(PORT),
      // Inside the output folder, which Playwright empties before each run (and before starting the server).
      DB_PATH: path.join(outputDir, 'server', 'quiz.db'),
      APP_URL: baseURL,
      // Fast timers: a 15-second question lasts 2.25 s, a whole match takes about 12 s. E2E_TIME_SCALE gives slower
      // engines more (CI runs WebKit and Firefox at 0.5, as their clicks take longer than Chrome's).
      GAME_TIME_SCALE: timeScale,
      BOT_FILL_SECONDS: '1',
      BOT_FILL_BUSY_SECONDS: '1',
      BACKUP_DIR: 'off',
      OPERATOR_NAME: 'Тест Тестов',
      OPERATOR_ADDRESS: 'ул. Примерна 1, София',
      DRAIN_SECONDS: '0',
      // The public sample bank, as in CI, even where the private one is checked out: the same questions everywhere
      // (every Geography question there has a "Знаеше ли?" fact, which facts.spec relies on).
      QUESTIONS_PATH: path.join(root, 'apps/server/src/data/questions.sample.json'),
      // Nothing from the developer's shell: the queues as shipped (all of them), no real email or error reports.
      PUBLIC_QUEUES: '',
      SMTP_URL: '',
      SENTRY_DSN: '',
      // Every statement it runs, beside the server tests' (`npm run plans -w @quiz/server` checks them all).
      SQL_LOG: path.join(root, 'apps/server/.sql-log'),
    },
  },
});

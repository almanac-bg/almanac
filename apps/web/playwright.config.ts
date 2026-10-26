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
 * Without it, the system's Google Chrome (as in CI). Playwright's own browser downloads aren't needed.
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

export default defineConfig({
  testDir: './e2e',
  outputDir,
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // The tests mostly wait on the game's timers, not the CPU: four at once even on a small CI runner (one at a time,
  // the suite would take over a minute and a half).
  workers: CI ? 4 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    ...(browserPath ? { launchOptions: { executablePath: browserPath } } : { channel: 'chrome' }),
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
    {
      name: 'phone',
      grepInvert: /@desktop/,
      use: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    // …and the ones tagged @desktop on a laptop.
    {
      name: 'desktop',
      grep: /@desktop/,
      use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    },
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
      // Fast timers: a 15-second question lasts 2.25 s, a whole match takes about 12 s.
      GAME_TIME_SCALE: '0.15',
      BOT_FILL_SECONDS: '1',
      BOT_FILL_BUSY_SECONDS: '1',
      BACKUP_DIR: 'off',
      OPERATOR_NAME: 'Тест Тестов',
      OPERATOR_ADDRESS: 'ул. Примерна 1, София',
      DRAIN_SECONDS: '0',
      // The public sample bank, as in CI, even where the private one is checked out: the same questions everywhere
      // (every Geography question there has a "Знаеше ли?" fact, which facts.spec relies on).
      QUESTIONS_PATH: path.join(root, 'apps/server/src/data/questions.sample.json'),
      // Nothing from the developer's shell: only Дуел and Роял open, no real email or error reports.
      PUBLIC_QUEUES: '',
      SMTP_URL: '',
      SENTRY_DSN: '',
    },
  },
});

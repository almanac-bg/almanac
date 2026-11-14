// The browser tests: the game played as players play it, in Chromium, WebKit (Safari's engine) and Firefox, at a
// phone's size. They start the program on the public sample bank with a fresh database.
//
//   npx playwright test -c e2e                     all three engines
//   npx playwright test -c e2e --project webkit    one
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Each checkout (a worktree per session) gets a port of its own, so that several can run their tests at once;
// E2E_PORT and E2E_DB choose others.
const own =
  createHash("sha256")
    .update(import.meta.dirname)
    .digest()
    .readUInt16BE(0) % 800;
const port = Number(process.env.E2E_PORT) || 8100 + own;
const db = process.env.E2E_DB || "test-results/e2e.db";
// A fresh database each run. Playwright reads this file again in every worker: only the main process clears it, or a
// worker starting late would delete the database under the running server.
if (!process.env.TEST_WORKER_INDEX) {
  for (const f of [db, `${db}-wal`, `${db}-shm`, "test-results/mail"]) rmSync(f, { recursive: true, force: true });
  mkdirSync("test-results", { recursive: true });
}

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure", locale: "bg-BG" },
  projects: [
    // BROWSER_PATH runs Chromium's tests in a local Chromium-based browser instead of Playwright's own.
    {
      name: "chromium",
      use: { ...devices["Pixel 7"], launchOptions: { executablePath: process.env.BROWSER_PATH || undefined } },
    },
    { name: "webkit", use: { ...devices["iPhone 15"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "go run ./cmd/build && go run ./cmd/almanac serve",
    cwd: "..",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DEV: "1",
      ADDR: `127.0.0.1:${port}`,
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      BANK_DIR: "bank/sample",
      DB_PATH: db,
      MAIL_DIR: "test-results/mail",
      // A Роял every half minute, its lobby open the 25 seconds before, instead of every evening at 21:00.
      ROYAL_EVERY: "30s",
      ROYAL_LOBBY: "25s",
    },
  },
});

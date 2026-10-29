// The settings read from the environment: a number that isn't one stops the start (naming it) instead of becoming NaN.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/** Loads the configuration in a fresh process with these settings; its exit status and what it printed. */
function load(env: Record<string, string>) {
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      "const { config } = await import('./src/config.ts'); console.log(JSON.stringify({ port: config.port, botFillMs: config.botFillMs, gameTimeScale: config.gameTimeScale }))",
    ],
    { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, ...env }, encoding: 'utf8' },
  );
  return { status: child.status, out: child.stdout.trim(), err: child.stderr };
}

test('a number setting that is not a number stops the start, naming it', () => {
  for (const [name, value] of [
    ['GAME_TIME_SCALE', '0,15'],
    ['PORT', 'abc'],
    ['BACKUP_KEEP_DAYS', '-3'],
    ['BOT_FILL_SECONDS', 'never'],
  ]) {
    const { status, err } = load({ [name]: value });
    assert.notEqual(status, 0, `${name}=${value}`);
    assert.match(err, new RegExp(`Invalid setting: ${name} `), `${name}=${value}`);
  }
});

test('blank settings count as unset; "off" and decimals are understood', () => {
  const { status, out } = load({ PORT: '', BOT_FILL_SECONDS: 'off', GAME_TIME_SCALE: '0.15' });
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(out), { port: 3001, botFillMs: null, gameTimeScale: 0.15 });
});

// Compose names each setting it hands the app: one added to the code but not to docker-compose.yml never reaches
// production (MAILBOX_PROVIDER nearly didn't).
test('every setting the server reads is passed to it by docker-compose.yml, or is meant not to be', () => {
  const src = path.resolve(import.meta.dirname, '../src');
  const read = new Set<string>();
  for (const file of fs.readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))) {
    const code = fs.readFileSync(path.join(src, file), 'utf8');
    for (const m of code.matchAll(/\b(?:process\.env|env)\.([A-Z][A-Z0-9_]+)/g)) read.add(m[1]);
  }
  const compose = fs.readFileSync(path.resolve(import.meta.dirname, '../../../docker-compose.yml'), 'utf8');
  const passed = new Set([...compose.matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]));
  // Set by the image or the container (NODE_ENV, PORT, DB_PATH…), or for tests and development only.
  const notPassed = new Set([
    'BACKUP_DIR',
    'BACKUP_KEEP_DAYS',
    'DB_PATH',
    'DRAIN_SECONDS',
    'EVENING_AT',
    'GAME_TIME_SCALE',
    'MAIL_OUTBOX',
    'NODE_ENV',
    'PORT',
    'UV_THREADPOOL_SIZE',
  ]);
  assert.deepEqual([...read].filter((name) => !passed.has(name) && !notPassed.has(name)).sort(), []);
});

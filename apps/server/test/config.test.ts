// The settings read from the environment: a number that isn't one stops the start (naming it) instead of becoming NaN.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

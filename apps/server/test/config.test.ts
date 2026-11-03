// The settings read from the environment: a number that isn't one stops the start (naming it) instead of becoming NaN.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROTOCOL } from '@almanac/shared';

/** Loads the configuration in a fresh process with these settings; its exit status and what it printed. */
function load(env: Record<string, string>) {
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      "const { config } = await import('./src/config.ts'); console.log(JSON.stringify({ port: config.port, botFillMs: config.botFillMs, gameTimeScale: config.gameTimeScale, minProtocol: config.minProtocol }))",
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
  assert.deepEqual(JSON.parse(out), {
    port: 3001,
    botFillMs: null,
    gameTimeScale: 0.15,
    minProtocol: { web: PROTOCOL, ios: 1, android: 1 },
  });
});

// MIN_PROTOCOL turns the apps' oldest protocol up once a newer app is out: a typo would refuse every player of an app,
// or none, so it stops the start instead.
test('MIN_PROTOCOL: ios:N,android:N up to the current protocol; anything else stops the start', () => {
  const ok = load({ MIN_PROTOCOL: ` ios:${PROTOCOL} , android:1 ` });
  assert.equal(ok.status, 0, ok.err);
  assert.deepEqual(JSON.parse(ok.out).minProtocol, { web: PROTOCOL, ios: PROTOCOL, android: 1 });
  for (const value of [`ios:${PROTOCOL + 1}`, 'ios:0', 'web:1', 'ios', 'ios:1.5', 'ios:one', 'iphone:1', 'ios=1']) {
    const { status, err } = load({ MIN_PROTOCOL: value });
    assert.notEqual(status, 0, value);
    assert.match(err, /Invalid setting: MIN_PROTOCOL /, value);
  }
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
    'DB_PATH',
    // Tied to stop_grace_period in docker-compose.yml: a longer drain would be cut short by Docker anyway.
    'DRAIN_SECONDS',
    'REQUEST_LOG',
    'ERROR_OUTBOX',
    'GAME_TIME_SCALE',
    'MAIL_OUTBOX',
    'PUSH_OUTBOX',
    'PUSH_QUIET',
    'SQL_LOG',
    'MIGRATE_TO',
    'APNS_URL',
    'FCM_URL',
    'NODE_ENV',
    'PORT',
    'UV_THREADPOOL_SIZE',
  ]);
  assert.deepEqual([...read].filter((name) => !passed.has(name) && !notPassed.has(name)).sort(), []);
});

// docs/configuration.md is where an operator looks: every setting the server, the deploy (.env.example) and the
// development tools read is there.
test('every setting the code and .env.example name is described in docs/configuration.md', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const names = new Set<string>();
  const collect = (code: string) => {
    for (const m of code.matchAll(/\b(?:process\.env|env)\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]);
  };
  const src = path.join(root, 'apps/server/src');
  for (const file of fs.readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts')))
    collect(fs.readFileSync(path.join(src, file), 'utf8'));
  for (const file of ['apps/web/vite.config.ts', 'apps/web/playwright.config.ts', 'apps/server/test/helpers.ts'])
    collect(fs.readFileSync(path.join(root, file), 'utf8'));
  for (const m of fs.readFileSync(path.join(root, '.env.example'), 'utf8').matchAll(/^([A-Z][A-Z0-9_]+)=/gm))
    names.add(m[1]);
  // Set by CI and the test runner themselves.
  for (const name of ['CI', 'TEST_WORKER_INDEX']) names.delete(name);
  const doc = fs.readFileSync(path.join(root, 'docs/configuration.md'), 'utf8');
  assert.deepEqual([...names].filter((name) => !doc.includes(`\`${name}\``)).sort(), []);
});

// The apps' pushes: half the APNs settings, or a key that isn't one, stops the start — not the first push hours later.
test('APNs takes all four settings or none, and a real key; FCM a real service account key', () => {
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  const all = {
    APNS_KEY_ID: 'K',
    APNS_TEAM_ID: 'T',
    APNS_KEY: String(ec).replace(/\n/g, '\\n'),
    APNS_TOPIC: 'bg.almanac.app',
  };
  assert.equal(load(all).status, 0, 'all four, the key on one line');
  const body = String(ec).split('\n').slice(1, -2).join('');
  assert.equal(load({ ...all, APNS_KEY: body }).status, 0, 'the key as its base64 alone');
  const half = load({ APNS_KEY_ID: 'K', APNS_KEY: all.APNS_KEY });
  assert.notEqual(half.status, 0);
  assert.match(half.err, /Invalid setting: APNs needs all of .*missing APNS_TEAM_ID, APNS_TOPIC/);
  const broken = load({ ...all, APNS_KEY: 'not-a-key' });
  assert.notEqual(broken.status, 0);
  assert.match(broken.err, /Invalid setting: APNS_KEY is not a PRIVATE KEY/);
  for (const value of ['{"project_id":"p"}', 'not json', '{"project_id":"p","client_email":"e","private_key":"x"}']) {
    const { status, err } = load({ FCM_SERVICE_ACCOUNT: value });
    assert.notEqual(status, 0, value);
    assert.match(err, /Invalid setting: FCM_SERVICE_ACCOUNT/, value);
  }
});

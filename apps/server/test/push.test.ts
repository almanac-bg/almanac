// Web push's limits (push.ts): nothing at night, at most two a day, one of each kind; the daily reminder at the
// player's time, the streak warning in the evening, the evening Роял just before it starts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import webpush from 'web-push';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-push-unit-'));
const keys = webpush.generateVAPIDKeys();
process.env.DB_PATH = path.join(tmp, 'push.db');
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.PUSH_OUTBOX = path.join(tmp, 'pushes');
process.env.ERROR_OUTBOX = path.join(tmp, 'errors.jsonl');
const { config } = await import('../src/config');
const { one, run, tx } = await import('../src/db');
const { dailyReminderPushes, push, pushEndpoint, subscribe, timedPushes } = await import('../src/push');
const { defaultPushPrefs } = await import('@almanac/shared');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sent = () =>
  fs.existsSync(process.env.PUSH_OUTBOX!)
    ? fs
        .readdirSync(process.env.PUSH_OUTBOX!)
        .map((f) => JSON.parse(fs.readFileSync(path.join(process.env.PUSH_OUTBOX!, f), 'utf8')))
    : [];
const clear = () => fs.rmSync(process.env.PUSH_OUTBOX!, { recursive: true, force: true });
/** A moment on 2 Nov 2026 (a Monday, winter: Sofia = UTC+2) at this Sofia hour and minute. */
const at = (hour: number, minute = 0) => Date.UTC(2026, 10, 2, hour - 2, minute);

let nextId = 1;
function player(prefs = defaultPushPrefs(), streak = 0) {
  const id = nextId++;
  run(
    `INSERT INTO users (id, username, username_key, password_hash, created_at, daily_streak, last_daily_day)
     VALUES (?, ?, ?, 'x', 0, ?, ?)`,
    id,
    `p${id}`,
    `p${id}`,
    streak,
    streak ? '2026-11-01' : null,
  );
  subscribe(
    id,
    { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: 'k'.repeat(40), auth: 'a'.repeat(16) } },
    null,
  );
  run('UPDATE users SET push_prefs = ? WHERE id = ?', JSON.stringify(prefs), id);
  return id;
}
const message = { title: 't', body: 'b', url: '/' };

test('nothing at night, one of each kind, two a day at most', () => {
  clear();
  const id = player();
  assert.equal(push(id, 'duels', message, at(23)), false, 'night');
  assert.equal(push(id, 'duels', message, at(8, 59)), false, 'still night');
  assert.equal(push(id, 'duels', message, at(10)), true);
  assert.equal(push(id, 'duels', message, at(11)), false, 'one duel push a day');
  assert.equal(push(id, 'records', message, at(12)), true);
  assert.equal(push(id, 'groups', message, at(13)), false, 'two a day');
  assert.equal(push(id, 'hello', message, at(14)), true, 'a new device always hears it works');
  assert.equal(sent().length, 3);
});

test('a kind switched off is never pushed', () => {
  clear();
  const prefs = defaultPushPrefs();
  prefs.kinds.duels = false;
  const id = player(prefs);
  assert.equal(push(id, 'duels', message, at(10)), false);
});

test('the daily reminder at the chosen time, only while the day is unplayed; the streak warning from 20:00', () => {
  clear();
  const remind = player({ ...defaultPushPrefs(), daily: 18 * 60 });
  const played = player({ ...defaultPushPrefs(), daily: 18 * 60 });
  run("INSERT INTO daily_results (user_id, day, started_at) VALUES (?, '2026-11-02', 0)", played);
  assert.equal(dailyReminderPushes(at(17, 45)), 0, 'not yet');
  assert.equal(dailyReminderPushes(at(18, 0)), 1);
  assert.deepEqual(
    sent().map((p) => [p.userId, p.kind]),
    [[remind, 'daily']],
  );
  assert.equal(dailyReminderPushes(at(18, 15)), 0, 'once');

  clear();
  const atRisk = player(defaultPushPrefs(), 5);
  const streakOf = (u: { id: number }) => (u.id === atRisk ? 5 : 0);
  assert.equal(timedPushes(streakOf, null, at(19, 45)), 0, 'not before 20:00');
  assert.equal(timedPushes(streakOf, null, at(20, 0)), 1);
  assert.match(sent()[0].title, /Серията ти от 5 дни прекъсва в полунощ/);
});

test('the evening Роял: in the quarter hour before it starts, to whoever asked for it', () => {
  clear();
  const prefs = defaultPushPrefs();
  prefs.kinds.evening = true;
  const fan = player(prefs);
  player();
  const start = at(21);
  assert.equal(
    timedPushes(() => 0, start, at(20, 30)),
    0,
    'too early',
  );
  assert.equal(
    timedPushes(() => 0, start, at(20, 45)),
    1,
  );
  assert.deepEqual(
    sent().map((p) => [p.userId, p.kind]),
    [[fan, 'evening']],
  );
});

test('a push within a write goes out once it commits, and not at all if it rolls back', () => {
  clear();
  const id = player();
  assert.throws(() =>
    tx(() => {
      assert.equal(push(id, 'duels', message, at(10)), true);
      assert.equal(sent().length, 0, 'not before the commit');
      throw new Error('the result failed');
    }),
  );
  assert.equal(sent().length, 0, 'a result rolled back buzzes nobody');
  assert.equal(one('SELECT 1 AS x FROM push_sent WHERE user_id = ?', id), undefined, 'nor counts for the day');
  tx(() => push(id, 'duels', message, at(10)));
  assert.equal(sent().length, 1);
});

test('a device stops getting pushes when the session it subscribed with ends, however it ends (SEC-7)', () => {
  const id = player();
  const device = (n: number) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/session-${id}-${n}`,
    keys: { p256dh: 'k'.repeat(40), auth: 'a'.repeat(16) },
  });
  for (const n of [1, 2]) {
    run(
      'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, 0, ?)',
      `hash-${id}-${n}`,
      id,
      Date.now() + 60_000,
    );
    subscribe(id, device(n), `hash-${id}-${n}`);
  }
  const devices = () =>
    one<{ n: number }>(
      'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ? AND session_token IS NOT NULL',
      id,
    )!.n;
  assert.equal(devices(), 2);
  run('DELETE FROM sessions WHERE token = ?', `hash-${id}-1`);
  assert.equal(devices(), 1, 'signed out there: that device hears no more');
  run('DELETE FROM sessions WHERE user_id = ?', id);
  assert.equal(devices(), 0, 'every session gone (a reset password, a ban): every device');
});

test('a push that fails never takes the server down: a gone device is forgotten, or reported if the database is held (SERVER-7)', async (t) => {
  // Out to a push service this time, and it answers as one does for a device that's gone, or with an error.
  let answer = 410;
  t.mock.method(webpush, 'sendNotification', () =>
    Promise.reject(Object.assign(new Error('push'), { statusCode: answer })),
  );
  t.mock.property(config, 'pushOutbox', null);
  const unheard: unknown[] = [];
  const listen = (err: unknown) => unheard.push(err);
  process.on('unhandledRejection', listen);
  t.after(() => {
    process.off('unhandledRejection', listen);
    run('PRAGMA query_only = OFF');
  });
  const errors = () =>
    fs.existsSync(process.env.ERROR_OUTBOX!)
      ? fs
          .readFileSync(process.env.ERROR_OUTBOX!, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l).where as string)
      : [];
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20));
  const devices = (id: number) =>
    one<{ n: number }>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', id)!.n;

  // Gone, while nothing can be written (as a full disk or a held database leaves it): reported, and play goes on.
  const id = player();
  run('PRAGMA query_only = ON');
  assert.equal(push(id, 'hello', message), true);
  await settled();
  assert.deepEqual(unheard, [], 'nothing left for the last resort');
  assert.deepEqual(errors(), ['push failed']);
  run('PRAGMA query_only = OFF');
  assert.equal(devices(id), 1, 'kept for now: forgotten the next time it is pushed');

  // Gone, with the database writable: forgotten. Another error: reported, the device kept.
  push(id, 'hello', message);
  await settled();
  assert.equal(devices(id), 0);
  answer = 500;
  const other = player();
  push(other, 'hello', message);
  await settled();
  assert.equal(devices(other), 1);
  assert.deepEqual(errors(), ['push failed', 'push']);
  assert.deepEqual(unheard, []);
});

test('a push goes only to a push service, read as plainly as the request that goes out reads it', () => {
  // What browsers hand out, kept as it came.
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH-x_y',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABl-x_y',
    'https://web.push.apple.com/QGuQyavXutnMUVHgIr2c',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD%2bx%2fy',
  ])
    assert.equal(pushEndpoint(endpoint), endpoint);
  // Anything else is no subscription: another host, another scheme or port, a name and password, a percent-escape or
  // a character web-push's url.parse ends the host at (it would read „%2e“ as the end, and post to what came before).
  for (const endpoint of [
    'https://evil.example/x',
    'http://fcm.googleapis.com/fcm/send/x',
    'https://fcm.googleapis.com:8443/fcm/send/x',
    'https://user:pass@fcm.googleapis.com/fcm/send/x',
    'https://127.0.0.1%2epush.apple.com/x',
    'https://evil.example%2Ewns2.notify.windows.com/x',
    'https://evil.example;.push.apple.com/x',
    'https://evil.example,.push.apple.com/x',
    'https://evil.example\t.push.apple.com/x',
    'https://evil.example%00.push.apple.com/x',
    'https://evil.example\u3002push.apple.com/x',
    'https://FCM.GOOGLEAPIS.COM/fcm/send/x',
    'https://fcm.googleapis.com',
    'not a url',
    `https://fcm.googleapis.com/${'x'.repeat(1000)}`,
  ])
    assert.equal(pushEndpoint(endpoint), null, endpoint);
});

test('a device kept before that check was strict is never pushed to, and forgotten', () => {
  const id = player();
  const bad = 'https://127.0.0.1%2epush.apple.com/x';
  run(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, 'k', 'a', 0)`,
    bad,
    id,
  );
  clear();
  assert.equal(push(id, 'hello', message), true, 'its good device still gets it');
  assert.deepEqual(
    sent().map((p) => p.devices),
    [1],
  );
  assert.equal(one('SELECT 1 AS x FROM push_subscriptions WHERE endpoint = ?', bad), undefined);
});

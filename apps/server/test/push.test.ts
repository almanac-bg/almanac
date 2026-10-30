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
const { one, run, tx } = await import('../src/db');
const { dailyReminderPushes, push, subscribe, timedPushes } = await import('../src/push');
const { defaultPushPrefs } = await import('@quiz/shared');

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
  subscribe(id, {
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    keys: { p256dh: 'k'.repeat(40), auth: 'a'.repeat(16) },
  });
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

// Coming back every day: daily quests, streak shields, the evening streak reminder, and cleaning up guest accounts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { CATEGORY_IDS, dayKey, shiftDay, sofiaMidnight } from '@quiz/shared';

// Server modules open the database on import — point them at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-progress-'));
process.env.DB_PATH = path.join(tmp, 'progress.db');
process.env.MAIL_OUTBOX = path.join(tmp, 'outbox');
process.env.APP_URL = 'https://almanac.test';
const { one, run } = await import('../src/db');
const { advanceQuests, QUEST_BONUS_XP, questsInfo } = await import('../src/quests');
const { liveDailyStreak, recordDailyResult } = await import('../src/daily');
const { sendStreakReminders } = await import('../src/maintenance');
const { purgeGuests, purgeRoomGuests, ROOM_GUEST_MS } = await import('../src/guests');
const { setRealtime } = await import('../src/notify');
const { getUser } = await import('../src/users');
const { count, countActive, launchStats } = await import('../src/stats');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DAY = 24 * 60 * 60_000;
let nextId = 1;
function user(fields: Record<string, string | number | null> = {}) {
  const id = nextId++;
  run(
    "INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, 'x', ?)",
    id,
    `p${id}`,
    `p${id}`,
    Date.now(),
  );
  for (const [column, value] of Object.entries(fields)) run(`UPDATE users SET ${column} = ? WHERE id = ?`, value, id);
  return id;
}

test('daily quests: three a day that stay put, paid once each, plus a bonus for all three', () => {
  const id = user();
  const day = '2026-10-25';
  const first = questsInfo(id, day);
  assert.equal(first.quests.length, 3);
  assert.deepEqual(
    questsInfo(id, day).quests.map((q) => q.id),
    first.quests.map((q) => q.id),
    'the same quests all day',
  );

  // A match that does a lot of everything, in three different modes, finishes any combination of quests.
  const big = { multiplayer: true, won: true, correct: 40, hardCorrect: 10, bestStreak: 10, jokers: 5 };
  const correctByCategory = new Map(CATEGORY_IDS.map((c) => [c, 10]));
  const lines = (['daily', 'royale', 'challenge'] as const).flatMap((mode) =>
    advanceQuests(id, { ...big, mode, correctByCategory }, day),
  );
  const after = questsInfo(id, day);
  assert.ok(
    after.quests.every((q) => q.done && q.progress === q.goal),
    JSON.stringify(after.quests),
  );
  assert.ok(after.bonusDone);
  assert.equal(lines.filter((l) => l.label.startsWith('Задача:')).length, 3, 'each quest pays once');
  assert.equal(lines.filter((l) => l.amount === QUEST_BONUS_XP && l.label === 'Всички задачи за деня').length, 1);
  assert.deepEqual(
    advanceQuests(id, { ...big, mode: 'daily', correctByCategory }, day),
    [],
    'nothing more to earn today',
  );
  assert.notDeepEqual(
    questsInfo(id, '2026-10-26').quests.map((q) => q.progress),
    after.quests.map((q) => q.progress),
    'a new day starts fresh',
  );
});

test('streak shields: earned every 7 days, spent on a missed day instead of the streak', () => {
  const d = (n: number) => shiftDay('2026-11-01', n);
  const id = user({ daily_streak: 6, last_daily_day: d(-1) });
  const week = recordDailyResult(id, d(0), 5000, 8, 60_000, true);
  assert.equal(week.streak, 7);
  assert.ok(week.shieldEarned);
  assert.equal(getUser(id)!.streak_shields, 1);

  assert.equal(liveDailyStreak(getUser(id)!, d(2)), 7, 'one missed day: still alive, thanks to the shield');
  const saved = recordDailyResult(id, d(2), 5000, 8, 60_000, true);
  assert.deepEqual([saved.streak, saved.shieldsUsed, getUser(id)!.streak_shields], [8, 1, 0]);

  assert.equal(liveDailyStreak(getUser(id)!, d(5)), 0, 'two missed days with no shields left: gone');
  assert.equal(recordDailyResult(id, d(5), 5000, 8, 60_000, true).streak, 1);
});

test('a daily left in its first questions uses the day’s attempt, but is no day played for the streak', () => {
  const d = (n: number) => shiftDay('2026-11-20', n);
  const id = user({ daily_streak: 6, last_daily_day: d(-1) });
  const left = recordDailyResult(id, d(0), 0, 0, 150_000, false);
  assert.equal(left.streak, 6, 'the streak as it was');
  assert.equal(left.shieldEarned, false);
  assert.deepEqual([getUser(id)!.daily_streak, getUser(id)!.last_daily_day], [6, d(-1)]);
});

test('the streak reminder goes out in the evening, once a day, with a working unsubscribe', () => {
  const evening = sofiaMidnight(2026, 11, 10) + 19.5 * 60 * 60_000;
  const today = dayKey(evening);
  const outbox = () => (fs.existsSync(process.env.MAIL_OUTBOX!) ? fs.readdirSync(process.env.MAIL_OUTBOX!) : []);
  const opted = user({
    email: 'streak@example.com',
    streak_reminders: 1,
    reminder_key: 'secret',
    daily_streak: 5,
    last_daily_day: shiftDay(today, -1),
  });
  user({ email: 'quiet@example.com', streak_reminders: 0, daily_streak: 5, last_daily_day: shiftDay(today, -1) });
  user({ email: 'done@example.com', streak_reminders: 1, reminder_key: 'k', daily_streak: 5, last_daily_day: today });
  // Started today's daily and walked out of it at once: the day is gone, and an email can't save it.
  const quitter = user({
    email: 'quit@example.com',
    streak_reminders: 1,
    reminder_key: 'q',
    daily_streak: 5,
    last_daily_day: shiftDay(today, -1),
  });
  run(
    'INSERT INTO daily_results (user_id, day, started_at, finished_at, score) VALUES (?, ?, 0, 1, 0)',
    quitter,
    today,
  );

  assert.equal(sendStreakReminders(evening - 6 * 60 * 60_000), 0, 'not in the afternoon');
  assert.equal(sendStreakReminders(evening), 1, 'only the opted-in player whose streak is at stake');
  assert.equal(sendStreakReminders(evening + 60 * 60_000), 0, 'once a day');
  const mail = JSON.parse(fs.readFileSync(path.join(process.env.MAIL_OUTBOX!, outbox()[0]), 'utf8'));
  assert.equal(mail.to, 'streak@example.com');
  assert.match(mail.headers['List-Unsubscribe'], new RegExp(`/api/reminders/off\\?u=${opted}&k=secret`));
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(mail.text.includes(`https://almanac.test/unsubscribe?u=${opted}&k=secret`));
});

test('guests nobody will play as again are cleared after a day; a guest who is online waits', async () => {
  const now = Date.now();
  const session = (id: number) =>
    run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, 0, ?)', `t${id}`, id, now + DAY);
  const stale = user({ is_guest: 1, created_at: now - 2 * DAY, questions_answered: 10 });
  const active = user({ is_guest: 1, created_at: now - 2 * DAY, questions_answered: 10 });
  session(active);
  // Made a guest (a visit, or a script making them by the thousand) and never played a question.
  const visitor = user({ is_guest: 1, created_at: now - 2 * DAY });
  session(visitor);
  const online = user({ is_guest: 1, created_at: now - 2 * DAY });
  session(online);
  const fresh = user({ is_guest: 1, created_at: now - 60_000 });
  session(fresh);
  const member = user({ created_at: now - 2 * DAY });

  setRealtime(
    null as never,
    (id) => (id === online ? 'online' : 'offline'),
    () => [],
    () => 0,
    () => {},
  );
  try {
    assert.equal(await purgeGuests(now), 2);
  } finally {
    setRealtime(
      null as never,
      () => 'offline',
      () => [],
      () => 0,
      () => {},
    );
  }
  const exists = (id: number) => !!one('SELECT 1 AS x FROM users WHERE id = ?', id);
  assert.deepEqual([stale, active, visitor, online, fresh, member].map(exists), [false, true, false, true, true, true]);
  assert.equal(await purgeGuests(now), 1, 'once offline, a later run takes it');
});

test('a guest who came for a room goes within an hour of leaving, with what it played; one still here stays', async () => {
  const now = Date.now();
  const session = (id: number) =>
    run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, 0, ?)', `r${id}`, id, now + DAY);
  const pupil = (seenAgo: number) => {
    const id = user({ is_guest: 1, created_at: now - 2 * 60 * 60_000, room_guest_seen_at: now - seenAgo });
    session(id);
    return id;
  };
  const left = pupil(ROOM_GUEST_MS + 60_000);
  const justLeft = pupil(5 * 60_000);
  // Still in the class an hour and more after joining: marked as seen, never taken.
  const here = pupil(2 * ROOM_GUEST_MS);
  const signedOut = user({ is_guest: 1, created_at: now, room_guest_seen_at: now });
  const ordinary = user({ is_guest: 1, created_at: now - 2 * 60 * 60_000 });
  session(ordinary);
  run(
    `INSERT INTO answers (user_id, match_id, question_id, difficulty, correct, time_ms, answered_at)
     VALUES (?, 'class', 'q1', 'easy', 1, 1000, ?)`,
    left,
    now - ROOM_GUEST_MS,
  );
  setRealtime(
    null as never,
    (id) => (id === here ? 'room' : 'offline'),
    () => [],
    () => 0,
    () => {},
  );
  try {
    assert.equal(await purgeRoomGuests(now), 2);
  } finally {
    setRealtime(
      null as never,
      () => 'offline',
      () => [],
      () => 0,
      () => {},
    );
  }
  const exists = (id: number) => !!one('SELECT 1 AS x FROM users WHERE id = ?', id);
  assert.deepEqual([left, justLeft, here, signedOut, ordinary].map(exists), [false, true, true, false, true]);
  assert.equal(one<{ n: number }>("SELECT COUNT(*) AS n FROM answers WHERE match_id = 'class'")!.n, 0);
  assert.equal(getUser(here)!.room_guest_seen_at, now, 'the one still here is marked as seen');
  assert.equal(await purgeRoomGuests(now + ROOM_GUEST_MS + 1), 2, 'once gone long enough, the rest');
});

test('a wave of guests is cleared a batch at a time, up to a share per run', async () => {
  const now = Date.now();
  const before = one<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
  for (let i = 0; i < 130; i++) user({ is_guest: 1, created_at: now - 2 * DAY });
  assert.equal(await purgeGuests(now, 100), 100, 'a run stops at its share');
  assert.equal(await purgeGuests(now), 30, 'the next takes the rest');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n, before);
});

test('launch statistics: daily counters, and returns counted against the day a player joined', () => {
  const today = '2026-11-20';
  const joined = (daysAgo: number) => sofiaMidnight(2026, 11, 20 - daysAgo) + 12 * 60 * 60_000;
  count('guests', 1, shiftDay(today, -1));
  count('signups', 2, shiftDay(today, -1));
  countActive(joined(1), today); // joined yesterday, back today: D1
  countActive(joined(7), today); // a week ago: D7
  countActive(joined(3), today); // neither
  const { days } = launchStats(10, today);
  const at = (day: string) => days.find((d) => d.day === day)!.values;
  assert.equal(days[0].day, today, 'newest first');
  assert.equal(at(today).active, 3);
  assert.deepEqual(
    [at(shiftDay(today, -1)).guests, at(shiftDay(today, -1)).signups, at(shiftDay(today, -1)).returned_d1],
    [1, 2, 1],
  );
  assert.equal(at(shiftDay(today, -7)).returned_d7, 1);
});

test('/me settles the account only when the season or the list of achievements changed since it last did', async () => {
  const { getMe } = await import('../src/account');
  const id = user();
  const has = (achievement: string) =>
    !!one('SELECT 1 AS x FROM user_achievements WHERE user_id = ? AND achievement_id = ?', id, achievement);
  getMe(id);
  assert.ok(getUser(id)!.settled, 'the first /me settles, and notes for what');
  // XP from somewhere that didn't settle (as nothing does now): /me doesn't look again…
  run('UPDATE users SET xp = 100000 WHERE id = ?', id);
  getMe(id);
  assert.equal(has('level_10'), false, 'no write transaction on every /me');
  // …until a season ends or an achievement is added: then it does, once.
  run("UPDATE users SET settled = '2026-09 old-list' WHERE id = ?", id);
  getMe(id);
  assert.equal(has('level_10'), true);
});

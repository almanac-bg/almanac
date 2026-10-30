// End-to-end, the day and newcomers: guests, challenge links, rematches, streak reminders, profiles and rewards,
// the daily questions and their links. A real server, real sockets, two players (A is the first account, so admin);
// the tests run in order and share state.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { type MeUser, RATED_AFTER, seasonKey } from '@quiz/shared';
import {
  type Account,
  autoPlay,
  type Client,
  connect,
  connected,
  emitAck,
  eventually,
  guest,
  http,
  newLog,
  next,
  register,
  rightNumber,
  startServer,
  type TestServer,
  tokenFrom,
  withSecondFactor,
} from './helpers';

const T = { timeout: 90_000 };

let srv: TestServer;
let api: ReturnType<typeof http>;
let A: Account;
let B: Account;
let sa: Client;
let sb: Client;
/** Today's shared daily questions, as the first player of the day saw them. */
let sharedDaily: string[] = [];

before(async () => {
  srv = await startServer({ EMAIL_EVENTS_SECRET: 'events-secret-for-tests' });
  api = http(srv.url);
  A = await register(srv.url, 'Иван_тест');
  B = await register(srv.url, 'maria_test');
  // A is the first account, so the owner: /admin wants their second factor.
  await withSecondFactor(srv.url, A.cookie);
  // Accounts from yesterday: they play the shared daily (a brand-new account gets its own: the guest's daily below).
  srv.db
    .prepare('UPDATE users SET created_at = ? WHERE id IN (?, ?)')
    .run(Date.now() - RATED_AFTER.ms, A.user.id, B.user.id);
  sa = connect(srv.url, A.cookie);
  sb = connect(srv.url, B.cookie);
  await connected(sa, sb);
});

after(async () => {
  sa?.close();
  sb?.close();
  await srv?.stop();
});

test('guests play right away, stay off the boards, and keep everything when they sign up', T, async () => {
  const G = await guest(srv.url);
  assert.ok(G.user.isGuest);
  assert.match(G.user.username, /^Гост_\d{7}$/);
  const sg = connect(srv.url, G.cookie);
  await connected(sg);
  const play = autoPlay(sg, 'right');
  assert.ok((await emitAck(sg, 'solo:start', { category: 'mixed' })).ok);
  const { start, end } = await play;
  assert.ok(end.rewards!.xpGained > 0, 'guests earn XP like anyone');
  assert.equal(start?.players[0].isGuest, true, 'the match knows a guest (the results offer no "add friend")');

  assert.equal(
    (await api.send('POST', '/api/friends', G.cookie, { username: A.user.username })).status,
    403,
    'friends need an account',
  );
  assert.equal((await emitAck(sg, 'room:create', {})).ok, false, 'so do rooms of their own');
  assert.equal((await emitAck(sg, 'challenge:start', {})).ok, false, 'and new challenge links');
  assert.equal(
    (await api.send('POST', '/api/friends', A.cookie, { username: G.user.username })).status,
    400,
    'nobody can add a guest',
  );
  const board = (await api.get('/api/leaderboard/level', G.cookie)).body;
  assert.ok(!board.entries.some((e: { user: { id: number } }) => e.user.id === G.user.id), 'guests are not listed');
  assert.ok(board.me.rank >= 1, 'but see where they would stand');
  assert.equal(
    (await api.send('POST', '/api/auth/register', '', { username: 'Гост_123456', password: 'secret123' })).status,
    400,
  );

  const xp = (await api.get('/api/me', G.cookie)).body.user.xp;
  assert.equal(
    (await api.send('POST', '/api/account/claim', G.cookie, { username: 'm\u0430ria_test', password: 'secret123' }))
      .status,
    409,
    'nor one that looks the same as a taken name',
  );
  const claimed = await api.send('POST', '/api/account/claim', G.cookie, {
    username: 'bivsh_gost',
    password: 'secret123',
  });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assert.equal(claimed.body.user.isGuest, false);
  assert.equal(claimed.body.user.username, 'bivsh_gost');
  assert.equal(claimed.body.user.xp, xp, 'progress kept');
  assert.ok(claimed.cookie && claimed.cookie !== G.cookie, 'a session of its own for the account');
  assert.equal((await api.get('/api/me', G.cookie)).body.user, null, "the guest's cookie opens nothing any more");
  assert.equal(
    (await api.send('POST', '/api/auth/login', '', { username: 'bivsh_gost', password: 'secret123' })).status,
    200,
  );
  assert.equal(
    (await api.send('POST', '/api/account/claim', claimed.cookie, { username: 'drugo_ime', password: 'secret123' }))
      .status,
    400,
  );
  sg.close();
});

test(
  'challenge links: one attempt each, own option order, a shared board, and the creator hears about it',
  T,
  async () => {
    const log = newLog();
    const play = autoPlay(sa, 'right', log);
    const created = await emitAck(sa, 'challenge:start', {});
    assert.ok(created.ok, JSON.stringify(created));
    const { id } = created;
    const { start, end } = await play;
    assert.equal(start!.powerups.length, 0, 'no козове');
    assert.deepEqual(end.rewards!.challenge, { id, rank: 1, total: 1, duel: null });

    const preview = await api.get(`/api/challenges/${id}/preview`);
    assert.equal(preview.status, 200, 'the landing page works signed out');
    assert.equal(preview.body.creator.username, A.user.username);
    assert.equal(preview.body.topScore, end.standings[0].score);

    const logB = newLog();
    const unreadBefore = (await api.get('/api/me', A.cookie)).body.user.unreadNotifications;
    const told = next(sa, 'notification');
    const playB = autoPlay(sb, 'wrong', logB);
    assert.ok((await emitAck(sb, 'challenge:start', { id })).ok);
    const { end: endB } = await playB;
    assert.deepEqual(endB.rewards!.challenge, { id, rank: 2, total: 2, duel: null });
    assert.deepEqual(
      logB.questions.map((q) => q.q),
      log.questions.map((q) => q.q),
      'the same questions',
    );
    assert.notDeepEqual(
      logB.questions.map((q) => q.options),
      log.questions.map((q) => q.options),
      'each in their own option order',
    );
    // Told at once, and kept for later: the creator is rarely on the page when a friend plays the link.
    const { item, unread } = await told;
    assert.match(item.text, /изигра предизвикателството ти/);
    assert.equal(item.link, `/c/${id}`);
    assert.equal(unread, unreadBefore + 1);
    const kept = (await api.get('/api/notifications', A.cookie)).body.notifications;
    assert.equal(kept[0].id, item.id);
    assert.equal(kept[0].read, false);
    assert.equal((await api.send('POST', '/api/notifications/read', A.cookie)).status, 200);
    assert.equal((await api.get('/api/me', A.cookie)).body.user.unreadNotifications, 0);
    assert.equal((await api.get('/api/notifications', A.cookie)).body.notifications[0].read, true);
    assert.equal((await emitAck(sb, 'challenge:start', { id })).ok, false, 'one attempt each');
    assert.equal((await emitAck(sb, 'challenge:start', { id: 'nope' })).ok, false);

    const info = (await api.get(`/api/challenges/${id}`, B.cookie)).body;
    assert.deepEqual(
      info.entries.map((e: { user: { username: string } }) => e.user.username),
      [A.user.username, B.user.username],
    );
    assert.ok(info.entries[1].you && info.attempted);
    assert.equal((await api.get('/api/challenges', A.cookie)).body.challenges[0].players, 2);
  },
);

test('rematch: the same people play again once everyone asks; one "no" ends the offer', T, async () => {
  const duel = async () => {
    const pa = autoPlay(sa, 'right');
    const pb = autoPlay(sb, 'wrong');
    assert.ok((await emitAck(sa, 'queue:join', 'duel')).ok);
    assert.ok((await emitAck(sb, 'queue:join', 'duel')).ok);
    return (await Promise.all([pa, pb]))[0].end;
  };

  let end = await duel();
  const seen = [next(sa, 'rematch:state'), next(sb, 'rematch:state')];
  sa.emit('rematch:request', { gameId: end.gameId });
  const [, offered] = await Promise.all(seen);
  assert.deepEqual(offered.ready, [`u${A.user.id}`], 'the other side sees who asked');
  const off = next(sa, 'rematch:state');
  sb.emit('rematch:decline', { gameId: end.gameId });
  assert.equal((await off).cancelled, true, 'the one who asked hears it is off');

  end = await duel();
  const started = Promise.all([next(sa, 'game:start'), next(sb, 'game:start')]);
  sa.emit('rematch:request', { gameId: end.gameId });
  sb.emit('rematch:request', { gameId: end.gameId });
  const [ga, gb] = await started;
  assert.equal(ga.gameId, gb.gameId);
  assert.notEqual(ga.gameId, end.gameId);
  assert.deepEqual(ga.players.map((p) => p.userId).sort(), [A.user.id, B.user.id].sort(), 'the same two people');

  const over = next(sb, 'game:end');
  sa.emit('game:leave');
  await over; // walking out hands the other the win at once
});

test('streak reminders: opt in with a verified email, opt out from the email link', T, async () => {
  const C = await register(srv.url, 'napomnyane', 'remind@example.com');
  assert.equal(
    (await api.send('POST', '/api/account/reminders', C.cookie, { on: true })).status,
    400,
    'needs a verified email',
  );
  const token = tokenFrom(
    srv
      .mails()
      .filter((m) => m.to === 'remind@example.com')
      .at(-1)!,
  );
  assert.equal((await api.send('POST', '/api/auth/verify-email', '', { token })).status, 200);
  const on = await api.send('POST', '/api/account/reminders', C.cookie, { on: true });
  assert.equal(on.body.user.streakReminders, true);
  const { reminder_key: key } = srv.db.prepare('SELECT reminder_key FROM users WHERE id = ?').get(C.user.id) as {
    reminder_key: string;
  };
  assert.equal((await api.send('POST', `/api/reminders/off?u=${C.user.id}&k=wrong`, '')).status, 400);
  assert.equal(
    (await api.send('POST', `/api/reminders/off?u=${C.user.id}&k=${key}`, '')).status,
    200,
    'one click, no sign-in',
  );
  assert.equal((await api.get('/api/me', C.cookie)).body.user.streakReminders, false);
});

test('profiles, achievements, leaderboards, loadout', T, async () => {
  const prof = await api.get(`/api/profile/${encodeURIComponent(A.user.username)}`, B.cookie);
  assert.equal(prof.status, 200);
  // In this file: the challenge link and the two duels of the rematch test; the rematch A walked out of is listed but
  // doesn't count as played.
  assert.equal(prof.body.overview.gamesPlayed, 3);
  assert.equal(prof.body.recent.length, 4);
  // The home card's totals are the profile's.
  const { stats } = (await api.get('/api/me', A.cookie)).body.user;
  assert.equal(stats.games, prof.body.overview.gamesPlayed);
  assert.ok(stats.answered > 0 && stats.correct <= stats.answered);
  const ach = await api.get('/api/achievements', A.cookie);
  assert.ok(ach.body.achievements.length >= 39);
  // A ranked season so far (the duels here are unrated: A has played fewer than RATED_AFTER.games): on the duel board.
  srv.db
    .prepare(
      "INSERT OR REPLACE INTO season_ratings (user_id, season, mode, rating, peak, games, wins) VALUES (?, ?, 'duel', 1100, 1100, 10, 6)",
    )
    .run(A.user.id, seasonKey());
  const duel = await api.get('/api/leaderboard/duel', A.cookie);
  assert.equal(duel.body.entries[0].user.id, A.user.id);
  assert.ok(duel.body.season?.name, 'ranked boards are seasonal');
  assert.ok((await api.get('/api/leaderboard/level', B.cookie)).body.me.rank >= 1);
  // A banned player is on no board while the ban lasts.
  srv.db.prepare('UPDATE users SET banned_until = ? WHERE id = ?').run(Date.now() + 60_000, A.user.id);
  for (const board of ['level', 'duel']) {
    const { entries } = (await api.get(`/api/leaderboard/${board}`, B.cookie)).body;
    assert.ok(!entries.some((e: { user: { id: number } }) => e.user.id === A.user.id), `not on the ${board} board`);
  }
  srv.db.prepare('UPDATE users SET banned_until = NULL WHERE id = ?').run(A.user.id);
  assert.equal((await api.get('/api/leaderboard/duel', B.cookie)).body.entries[0].user.id, A.user.id, 'back after it');
  // A Роял won (in a session's earlier matches): its avatar can be worn, and one still locked can't.
  srv.db
    .prepare(
      "INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, 'royale_win', ?)",
    )
    .run(A.user.id, Date.now());
  assert.equal(
    (await api.send('PATCH', '/api/me/loadout', A.cookie, { avatar: 'crown' })).status,
    200,
    'royale_win avatar',
  );
  assert.equal(
    (await api.send('PATCH', '/api/me/loadout', A.cookie, { avatar: 'star' })).status,
    400,
    'level-50 avatar is locked',
  );
});

test('every fifth level a reward to pick: one of two, the other still to pick at a later milestone', T, async () => {
  const P = await register(srv.url, 'izbor_test');
  const me = async () => (await api.get('/api/me', P.cookie)).body.user as MeUser;
  const choose = (level: number, kind: string, id: string) =>
    api.send('POST', '/api/me/choice', P.cookie, { level, kind, id });
  assert.deepEqual((await me()).choices, [], 'none before level 5');
  // Level 12: two milestones reached.
  srv.db.prepare('UPDATE users SET xp = ? WHERE id = ?').run(50 * 12 * 11, P.user.id);
  assert.deepEqual(
    (await me()).choices.map((c) => [c.level, c.options.map((o) => o.id), c.earlier.length]),
    [
      [5, ['hedgehog', 'otter'], 0],
      [10, ['lavender', 'coral'], 0],
    ],
  );
  assert.equal((await choose(15, 'title', 'seeker')).status, 400, 'not reached yet');
  assert.equal((await choose(5, 'frame', 'lavender')).status, 400, 'not on offer at 5');
  assert.equal((await api.send('PATCH', '/api/me/loadout', P.cookie, { avatar: 'otter' })).status, 400, 'not yet');
  const picked = await choose(5, 'avatar', 'otter');
  assert.equal(picked.status, 200);
  assert.deepEqual(picked.body.user.chosen, ['avatar:otter']);
  assert.equal((await choose(5, 'avatar', 'hedgehog')).status, 400, 'one a milestone');
  // At 10, the hedgehog left at 5 can be picked instead of a frame.
  assert.deepEqual((await me()).choices[0].earlier, [{ kind: 'avatar', id: 'hedgehog' }]);
  assert.equal((await choose(10, 'avatar', 'hedgehog')).status, 200);
  assert.deepEqual((await me()).choices, []);
  assert.equal((await api.send('PATCH', '/api/me/loadout', P.cookie, { avatar: 'otter' })).status, 200, 'it is theirs');
  assert.equal((await api.send('PATCH', '/api/me/loadout', P.cookie, { frame: 'coral' })).status, 400, 'not picked');
});

test('daily challenge', T, async () => {
  const log = newLog();
  const play = autoPlay(sa, 'right', log);
  assert.ok((await emitAck(sa, 'daily:start')).ok);
  const { start, end } = await play;
  sharedDaily = log.questions.map((q) => q.id);
  assert.equal(start!.mode, 'daily');
  assert.equal(start!.powerups.length, 0, 'no козове in the daily');
  assert.equal(end.rewards!.daily!.rank, 1);
  assert.ok(end.rewards!.achievements.includes('daily_first') && end.rewards!.achievements.includes('daily_perfect'));
  assert.equal((await emitAck(sa, 'daily:start')).ok, false, 'one attempt per day');
  // The run is kept answer by answer, the option as the bank orders it (the fixture's right one is i % 4), whatever
  // order the options were shown in.
  const kept = srv.db.prepare("SELECT answers FROM runs WHERE user_id = ? AND mode = 'daily'").get(A.user.id) as {
    answers: string;
  };
  const answers = JSON.parse(kept.answers) as { q: string; i: number; c: number | null; g?: number; ok: number }[];
  assert.deepEqual(
    answers.map((a) => a.i),
    [...Array(10).keys()],
  );
  const final = answers.pop()!;
  assert.deepEqual([final.c, final.g, final.ok], [null, rightNumber(log.questions[9]), 1], 'the final: a number');
  for (const a of answers)
    assert.equal(a.c, Number(a.q.split('-').pop()) % 4, `${a.q}: the right one, as the bank has it`);
  assert.ok(
    (
      srv.db.prepare('SELECT answers FROM player_skill WHERE user_id = ? AND category = ?').get(A.user.id, 'all') as {
        answers: number;
      }
    ).answers >= 10,
    'and the skill measured from it',
  );

  const logB = newLog();
  const pb = autoPlay(sb, 'wrong', logB);
  assert.ok((await emitAck(sb, 'daily:start')).ok);
  const { end: eb } = await pb;
  assert.deepEqual(
    logB.questions.map((q) => q.q),
    log.questions.map((q) => q.q),
    'same questions for everyone',
  );
  const sorted = (l: typeof log) => l.questions.map((q) => [...q.options].sort());
  assert.deepEqual(sorted(logB), sorted(log), 'same options');
  assert.notDeepEqual(
    logB.questions.map((q) => q.options),
    log.questions.map((q) => q.options),
    'but in each player’s own order',
  );
  assert.deepEqual(eb.rewards!.daily, {
    rank: 2,
    total: 2,
    offBoard: false,
    streak: 1,
    shieldsUsed: 0,
    shieldEarned: false,
    sharer: null,
    // Two played: too few to say how the day went for everyone.
    field: null,
  });
  const info = await api.get('/api/daily', A.cookie);
  assert.equal(info.body.played.rank, 1);
  assert.equal(info.body.entries.length, 2);
  assert.equal(info.body.streak, 1);
  const board = await api.get('/api/leaderboard/daily', B.cookie);
  assert.equal(board.body.entries[0].user.id, A.user.id);
  assert.equal(board.body.me.rank, 2);
});

test(
  'a guest, or an account made today, plays the same questions off the board, and sees where it would stand',
  T,
  async () => {
    const G = await guest(srv.url);
    const sg = connect(srv.url, G.cookie);
    await connected(sg);
    const log = newLog();
    const play = autoPlay(sg, 'right', log);
    assert.ok((await emitAck(sg, 'daily:start', {})).ok);
    const { end } = await play;
    // One set for everyone: what lets friends compare their day.
    assert.deepEqual(
      log.questions.map((q) => q.id),
      sharedDaily,
      'the day’s questions',
    );
    const daily = end.rewards!.daily!;
    assert.equal(daily.offBoard, true, 'kept off the board');
    assert.equal(daily.total, 2, 'the board has the two accounts from before today');
    assert.ok(daily.rank >= 1 && daily.rank <= 3, 'where it would stand on it');
    const info = (await api.get('/api/daily', G.cookie)).body;
    assert.equal(info.offBoard, true);
    assert.equal(info.played.rank, daily.rank);
    assert.ok(!info.entries.some((e: { user: { id: number } }) => e.user.id === G.user.id), 'not listed');
    assert.equal((await emitAck(sg, 'daily:start', {})).ok, false, 'still one run a day');

    // Saved the same day it was made: an account made today could still be a throwaway, so it stays off the board.
    const claim = (cookie: string) =>
      api.send('POST', '/api/account/claim', cookie, {
        username: `saver${Math.floor(Math.random() * 1e6)}`,
        password: 'secret123',
      });
    const saved = await claim(G.cookie);
    assert.equal(saved.status, 200);
    sg.close();
    assert.equal((await api.get('/api/daily', saved.cookie)).body.offBoard, true, 'saved today: off until tomorrow');

    // A guest from yesterday that saves its profile today is on the board at once, with the run it played.
    const H = await guest(srv.url);
    srv.db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(Date.now() - RATED_AFTER.ms, H.user.id);
    const sh = connect(srv.url, H.cookie);
    await connected(sh);
    const own = autoPlay(sh, 'wrong', newLog());
    assert.ok((await emitAck(sh, 'daily:start', {})).ok);
    assert.equal((await own).end.rewards!.daily!.offBoard, true, 'as a guest, off the board');
    const savedH = await claim(H.cookie);
    assert.equal(savedH.status, 200);
    sh.close();
    const after = (await api.get('/api/daily', savedH.cookie)).body;
    assert.equal(after.offBoard, false);
    assert.equal(after.total, 3, 'and on it');
    const sh2 = connect(srv.url, savedH.cookie!);
    await connected(sh2);
    assert.equal((await emitAck(sh2, 'daily:start', {})).ok, false, 'no second go at questions it has seen');
    sh2.close();
  },
);

test(
  "a daily link: a friend plays the same questions, compares with the sharer's day, and the sharer hears",
  T,
  async () => {
    // Only once the day is played: by then the sharer knows the answers anyway.
    const newcomer = await register(srv.url, 'oshte_ne_igral');
    assert.equal((await api.send('POST', '/api/daily/link', newcomer.cookie)).status, 409);
    const link = await api.send('POST', '/api/daily/link', A.cookie);
    assert.equal(link.status, 200);
    const { code } = link.body;
    assert.equal((await api.send('POST', '/api/daily/link', A.cookie)).body.code, code, 'one link a day');

    const preview = (await fetch(`${srv.url}/api/daily/preview?code=${code}`)).json() as Promise<{
      sharer: { user: { username: string }; correct: number } | null;
      number: number;
    }>;
    const shown = await preview;
    assert.equal(shown.sharer?.user.username, A.user.username, 'anyone can see whose link it is');
    assert.equal(shown.sharer?.correct, 10);
    assert.ok(shown.number >= 1);
    const bogus = (await (await fetch(`${srv.url}/api/daily/preview?code=nope`)).json()) as { sharer: unknown };
    assert.equal(bogus.sharer, null);

    const F = await guest(srv.url);
    const sf = connect(srv.url, F.cookie);
    await connected(sf);
    const log = newLog();
    const play = autoPlay(sf, 'wrong', log);
    assert.ok((await emitAck(sf, 'daily:start', { via: code })).ok);
    const { end } = await play;
    assert.deepEqual(
      log.questions.map((q) => q.id),
      sharedDaily,
      'the same questions',
    );
    assert.equal(end.rewards!.daily!.sharer?.user.username, A.user.username, "the sharer's day to compare with");
    assert.equal(end.rewards!.daily!.sharer?.correct, 10);
    sf.close();

    await eventually(async () => {
      const notes = (await api.get('/api/notifications', A.cookie)).body.notifications as {
        text: string;
        link: string;
      }[];
      assert.ok(
        notes.some((n) => n.link === '/daily' && /по твоя линк/.test(n.text)),
        'the sharer hears how it went',
      );
    });
    const mine = (await api.get('/api/daily', A.cookie)).body;
    assert.ok(
      mine.fromMyLink.some((p: { user: { id: number } }) => p.user.id === F.user.id),
      'and sees it on /daily',
    );
  },
);

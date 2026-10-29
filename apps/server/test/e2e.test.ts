// End-to-end: a real server, real sockets, two players (A is the first account, so admin) and bots.
// Sections run in order and share state, like a play session.
import assert from 'node:assert/strict';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  dayKey,
  type GameStartPayload,
  type PowerupEvent,
  PUBLIC_PAGES,
  type QuestionPayload,
  RATED_AFTER,
  type RevealPayload,
  type RoomState,
  SEASON_REWARD_XP,
  seasonKey,
} from '@quiz/shared';
import {
  type Account,
  answer,
  autoPlay,
  type Client,
  cli,
  connect,
  connected,
  cookieFrom,
  emitAck,
  eventually,
  guest,
  http,
  newLog,
  next,
  nextWhere,
  register,
  rightNumber,
  rightOption,
  sleep,
  startServer,
  type TestServer,
  tokenFrom,
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

test('auth', T, async () => {
  const dup = await api.send('POST', '/api/auth/register', '', {
    username: A.user.username.toUpperCase(),
    password: 'secret123',
  });
  assert.equal(dup.status, 409, 'duplicate username (case-insensitive, Cyrillic) is rejected');
  // One Cyrillic "а" for the Latin "a": a different name to the database, the same one on screen.
  const twin = await api.send('POST', '/api/auth/register', '', { username: 'm\u0430ria_test', password: 'secret123' });
  assert.equal(twin.status, 409, 'a name that looks the same as a taken one is rejected');
  assert.match(twin.body.error, /изглежда точно като/);
  const bad = await api.send('POST', '/api/auth/login', '', { username: A.user.username, password: 'wrongpass' });
  assert.equal(bad.status, 401, 'wrong password is rejected');
  assert.equal(
    (await api.get('/api/me', A.cookie)).body.user?.username,
    A.user.username,
    '/me works with the session cookie',
  );

  // Sessions are stored hashed (a leaked backup holds no usable logins)…
  const token = decodeURIComponent(A.cookie.split('=')[1]);
  const hash = createHash('sha256').update(token).digest('base64url');
  assert.equal(
    srv.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(token)!.n,
    0,
    'no raw token stored',
  );
  // …and slide: one used in the second half of its life is renewed to a full 30 days, cookie included.
  srv.db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() + 3 * 24 * 60 * 60_000, hash);
  const renewed = await fetch(`${srv.url}/api/me`, { headers: { cookie: A.cookie } });
  assert.match(renewed.headers.get('set-cookie') ?? '', /Max-Age=2592000/, 'the browser cookie is renewed too');
  const { expires_at } = srv.db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(hash) as {
    expires_at: number;
  };
  assert.ok(expires_at > Date.now() + 29 * 24 * 60 * 60_000, 'an active session is renewed');
  const anon = await api.get('/api/me');
  assert.equal(anon.status, 200);
  assert.equal(anon.body.user, null, 'signed-out /me is { user: null }');
  assert.equal((await api.get('/api/profile/whoever')).status, 401, 'protected routes need a session');
  assert.equal(A.user.isAdmin, true, 'the first account is an admin');
  assert.equal(B.user.isAdmin, false);

  const foreign = connect(srv.url, A.cookie, { origin: 'https://evil.example' });
  const rejected = await new Promise((r) => {
    foreign.on('connect', () => r(false));
    foreign.on('connect_error', () => r(true));
  });
  foreign.close();
  assert.ok(rejected, 'sockets from a foreign origin are rejected');
});

test(
  'passwords: 8 characters or more, not the name, not a common one; older hashes are redone at sign-in',
  T,
  async () => {
    const signUp = (username: string, password: string, email?: string) =>
      api.send('POST', '/api/auth/register', '', { username, password, email });
    const short = await signUp('kratka_p', 'sedem77');
    assert.equal(short.status, 400);
    assert.match(short.body.error, /поне 8 символа/);
    assert.match((await signUp('obshta_p', 'password1')).body.error, /най-често използваните/);
    assert.match((await signUp('ednakvi1', 'ednakvi1')).body.error, /същата като името/);

    // An account from before the cost went up: N = 2^14, written as scrypt$salt$hash.
    const old = await register(srv.url, 'star_hash');
    const salt = randomBytes(16);
    const legacy = `scrypt$${salt.toString('base64')}$${scryptSync('secret123', salt, 64).toString('base64')}`;
    srv.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(legacy, old.user.id);
    const login = await api.send('POST', '/api/auth/login', '', { username: 'star_hash', password: 'secret123' });
    assert.equal(login.status, 200, 'the old hash still verifies');
    const stored = srv.db.prepare('SELECT password_hash AS h FROM users WHERE id = ?').get(old.user.id) as {
      h: string;
    };
    assert.match(stored.h, /^scrypt\$N=65536,r=8,p=1\$/, 'and is redone at the current cost');
    assert.equal(
      (await api.send('POST', '/api/auth/login', '', { username: 'star_hash', password: 'secret123' })).status,
      200,
    );
  },
);

test("wrong passwords from everywhere can't lock a player out from a device they signed in on", T, async () => {
  const signUp = await fetch(`${srv.url}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'zaklyuchen', password: 'secret123' }),
  });
  assert.equal(signUp.status, 201);
  const device = signUp.headers
    .getSetCookie()
    .find((c) => c.startsWith('quiz_device='))!
    .split(';')[0];
  const login = (password: string, from: string, cookie = '') =>
    fetch(`${srv.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': from, cookie },
      body: JSON.stringify({ username: 'zaklyuchen', password }),
    });
  // Ten wrong guesses from each of four networks (the most one network gets at an account).
  const statuses: number[] = [];
  for (let net = 1; net <= 4; net++) {
    const tries = await Promise.all(Array.from({ length: 10 }, () => login('wrong-password', `198.51.100.${net}`)));
    statuses.push(...tries.map((r) => r.status));
  }
  assert.ok(statuses.includes(429), "the account's sign-in attempts ran out");
  assert.equal((await login('secret123', '203.0.113.9')).status, 429, 'a device it has never signed in on waits');
  assert.equal(
    (await login('secret123', '203.0.113.9', device)).status,
    200,
    'the one its owner signed in on before does not',
  );
});

test('an address gets a few verification mails a day, whoever types it in', T, async () => {
  const before = srv.mails().filter((m) => m.to === 'someone@example.test').length;
  for (let i = 0; i < 5; i++) await register(srv.url, `pismo_${i}`, 'someone@example.test');
  const sent = srv.mails().filter((m) => m.to === 'someone@example.test').length - before;
  assert.equal(sent, 3, 'three, then nothing until tomorrow (the sign-ups themselves still work)');
});

test('the mail provider reports a bounce: no more reminders, and Settings says why', T, async () => {
  const P = await register(srv.url, 'vrashtane');
  srv.db
    .prepare(
      "UPDATE users SET email = 'gone@example.test', email_key = 'gone@example.test', streak_reminders = 1 WHERE id = ?",
    )
    .run(P.user.id);
  // SNS-style, as Scaleway Topics and Events posts it: the event is a JSON string in `Message`, sent as text/plain.
  const report = (secret: string) =>
    fetch(`${srv.url}/api/email-events/${secret}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=UTF-8' },
      body: JSON.stringify({
        Type: 'Notification',
        Message: JSON.stringify({ type: 'email_dropped', email_to: 'gone@example.test' }),
      }),
    });
  assert.equal((await report('wrong-secret')).status, 404, 'only with the secret');
  assert.equal((await api.get('/api/me', P.cookie)).body.user.emailBounced, false);
  assert.equal((await report('events-secret-for-tests')).status, 204);
  const me = (await api.get('/api/me', P.cookie)).body.user;
  assert.deepEqual([me.emailBounced, me.streakReminders], [true, false]);
});

test('an unknown /api address answers JSON, like the rest of the API', T, async () => {
  const res = await fetch(`${srv.url}/api/no-such-route`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /json/);
});

test('solo', T, async () => {
  const log = newLog();
  const play = autoPlay(sa, 'right', log);
  assert.deepEqual(await emitAck(sa, 'solo:start', { category: 'history' }), { ok: true });
  const { start, end } = await play;
  assert.equal(log.questions.length, 10);
  assert.ok(
    log.questions.every((q) => q.category === 'history'),
    'all from the chosen category',
  );
  // The ramp is the questions with options; the final, a number, is of any difficulty.
  const final = log.questions.pop()!;
  assert.deepEqual([final.kind, final.final], ['number', true], 'it ends on a number');
  const ramp = log.questions.map((q) => q.difficulty[0]).join('');
  assert.doesNotMatch(ramp, /h.*e/, `harder towards the end, never an easy one after a hard one (${ramp})`);
  assert.equal(end.standings[0].correct, 10);
  assert.deepEqual([...start!.powerups].sort(), ['double', 'fifty', 'retry'], 'every коз from the first match');
  const ids = end.rewards!.achievements;
  assert.ok(ids.includes('first_game') && ids.includes('perfect'), `first_game + perfect (${ids})`);
  assert.ok(
    end.rewards!.breakdown.some((l) => l.label === 'Първи мач за деня'),
    'daily bonus',
  );
});

test(
  '„Поправителен“: missed questions come back as a run of their own, and what it gets right is the player’s',
  T,
  async () => {
    const P = await register(srv.url, 'povtorach');
    const s = connect(srv.url, P.cookie);
    await connected(s);
    try {
      const early = await emitAck(s, 'review:start');
      assert.equal(early.ok, false, 'nothing missed yet');

      // A solo run with every answer wrong: each question comes back in three days.
      const missed = newLog();
      const solo = autoPlay(s, 'wrong', missed);
      await emitAck(s, 'solo:start', { category: 'music' });
      assert.deepEqual((await solo).end.rewards!.almanac, { added: 0, total: 0 });
      srv.db.prepare('UPDATE review_queue SET due_at = 0 WHERE user_id = ?').run(P.user.id);
      assert.deepEqual((await api.get('/api/me', P.cookie)).body.user.almanac, { facts: 0, due: 10 });

      const log = newLog();
      const review = autoPlay(s, 'right', log);
      assert.deepEqual(await emitAck(s, 'review:start'), { ok: true });
      const { start, end } = await review;
      assert.equal(start!.mode, 'review');
      assert.deepEqual(start!.powerups, [], 'recall, unaided');
      assert.deepEqual(log.questions.map((q) => q.id).sort(), missed.questions.map((q) => q.id).sort());
      assert.ok(
        log.questions.every((q) => !q.final),
        'no final',
      );
      // In the fixture bank every other question with options has a fact.
      const facts = log.questions.filter((q) => q.kind === 'choice' && Number(q.id.split('-')[1]) % 2 === 0).length;
      assert.deepEqual(end.rewards!.almanac, { added: facts, total: facts });
      assert.ok(!end.rewards!.achievements.includes('perfect'), 'no feats on known answers');
      assert.ok(!end.rewards!.breakdown.some((l) => l.label === 'Перфектен мач'));
      assert.ok(end.rewards!.breakdown.some((l) => l.label.startsWith('Верни отговори')));
      // Its answers count for nobody's accuracy, and the queue moved each question on a step.
      const profile = (await api.get('/api/profile/povtorach', P.cookie)).body;
      assert.equal(profile.overview.correctAnswers, 0);
      assert.equal(profile.almanac.facts, facts);
      assert.equal(
        (
          srv.db.prepare('SELECT COUNT(*) AS n FROM review_queue WHERE user_id = ? AND step = 1').get(P.user.id) as {
            n: number;
          }
        ).n,
        10,
      );
      const almanac = (await api.get('/api/almanac', P.cookie)).body;
      assert.equal(almanac.categories.find((c: { category: string }) => c.category === 'music').facts, facts);
      assert.deepEqual(almanac.review, { due: 0, waiting: 10, nextDueAt: almanac.review.nextDueAt, ready: false });
    } finally {
      s.close();
    }
  },
);

test('stopping to read a fact in a run alone makes it the player’s, right answer or not', T, async () => {
  const R = await register(srv.url, 'chitatel');
  const s = connect(srv.url, R.cookie);
  await connected(s);
  try {
    const log = newLog();
    let held: string | null = null;
    s.on('game:reveal', async (r) => {
      if (held || !r.fact) return;
      held = log.questions.find((q) => q.index === r.index)!.id;
      assert.deepEqual(await emitAck(s, 'game:hold', { index: r.index }), { ok: true });
      s.emit('game:resume');
    });
    const play = autoPlay(s, 'wrong', log);
    await emitAck(s, 'solo:start', { category: 'nature' });
    const { end } = await play;
    assert.ok(held);
    assert.deepEqual(end.rewards!.almanac, { added: 1, total: 1 });
    const page = (await api.get('/api/almanac/nature', R.cookie)).body;
    assert.deepEqual(
      page.facts.map((f: { id: string }) => f.id),
      [held],
    );
  } finally {
    s.close();
  }
});

test('groups: made by an account, joined from the invite link (a guest too), a board for members only', T, async () => {
  const G = await guest(srv.url);
  assert.equal(
    (await api.send('POST', '/api/groups', G.cookie, { name: 'Гости' })).status,
    403,
    'an account makes one',
  );
  const made = await api.send('POST', '/api/groups', A.cookie, { name: '  Офис   3 ' });
  assert.equal(made.status, 200);
  const group = (await api.get(`/api/groups/${made.body.id}`, A.cookie)).body;
  assert.deepEqual([group.name, group.isOwner, group.members], ['Офис 3', true, 1]);

  // Anyone with the link sees what it's for, signed in or not.
  const preview = await api.get(`/api/groups/join/${group.code}`);
  assert.deepEqual(preview.body, { name: 'Офис 3', members: 1, owner: 'Иван_тест', memberOf: null, full: false });
  assert.equal((await api.get(`/api/groups/${made.body.id}`, G.cookie)).status, 404, 'members only');
  assert.deepEqual((await api.send('POST', `/api/groups/join/${group.code}`, G.cookie)).body, { id: made.body.id });
  assert.equal((await api.get(`/api/groups/${made.body.id}`, G.cookie)).body.members, 2);
  assert.equal((await api.get('/api/me', G.cookie)).body.user.groups, 1);
  const [summary] = (await api.get('/api/groups', G.cookie)).body.groups;
  assert.deepEqual([summary.name, summary.members], ['Офис 3', 2]);

  // Only the one who made it renames it or removes people; anyone may leave.
  assert.equal((await api.send('PATCH', `/api/groups/${made.body.id}`, G.cookie, { name: 'Мое' })).status, 400);
  const renamed = await api.send('PATCH', `/api/groups/${made.body.id}`, A.cookie, { name: 'Офис 3 ☕' });
  assert.equal(renamed.body.name, 'Офис 3 ☕');
  assert.equal((await api.send('POST', `/api/groups/${made.body.id}/leave`, G.cookie)).status, 200);
  assert.equal((await api.get('/api/groups', G.cookie)).body.groups.length, 0);
  assert.equal((await api.send('DELETE', `/api/groups/${made.body.id}`, A.cookie)).status, 200);
  assert.equal((await api.get(`/api/groups/join/${group.code}`)).status, 404);
});

test('ranked duel with a mid-game reconnect', T, async () => {
  // People rate each other once each has RATED_AFTER.games matches behind them: lent for this match, then given back,
  // so the counts the later tests check are the real ones.
  const lend = (games: number) =>
    srv.db
      .prepare('UPDATE users SET games_played = games_played + ? WHERE id IN (?, ?)')
      .run(games, A.user.id, B.user.id);
  lend(RATED_AFTER.games);
  const pa = autoPlay(sa, 'right');
  const bFirstQuestion = next(sb, 'game:question');
  assert.ok((await emitAck(sa, 'queue:join', 'duel')).ok);
  assert.ok((await emitAck(sb, 'queue:join', 'duel')).ok);
  await bFirstQuestion;
  const bGone = nextWhere(sa, 'game:presence', (p) => p.playerId === `u${B.user.id}` && !p.connected);
  sb.disconnect();
  await bGone;
  sb = connect(srv.url, B.cookie);
  const synced = next(sb, 'game:start');
  const pb = autoPlay(sb, 'wrong');
  const sync = await synced;
  assert.equal(sync.startsInMs, 0, 'reconnect re-syncs the running game');
  assert.equal(sync.players.length, 2);
  const [{ end: ea }, { end: eb }] = await Promise.all([pa, pb]);
  assert.equal(ea.standings[0].id, `u${A.user.id}`, 'A won');
  assert.ok(ea.rewards!.rating!.after > ea.rewards!.rating!.before, 'winner gains rating');
  assert.ok(eb.rewards!.rating!.after < eb.rewards!.rating!.before, 'loser drops rating');
  assert.ok(ea.rewards!.achievements.includes('first_win') && ea.rewards!.achievements.includes('flawless_duel'));
  lend(-RATED_AFTER.games);
});

test('royale with bots and eliminations', T, async () => {
  const log = newLog();
  const statuses: { needed: number }[] = [];
  const onStatus = (s: { needed: number } | null) => s && statuses.push(s);
  sa.on('queue:status', onStatus);
  const play = autoPlay(sa, 'right', log);
  assert.ok((await emitAck(sa, 'queue:join', 'royale')).ok);
  const { start, end } = await play;
  sa.off('queue:status', onStatus);
  assert.equal(statuses[0]?.needed, 8, 'queue status is sent');
  assert.equal(start!.players.filter((p) => p.isBot).length, 7, '7 bots fill the lobby');
  const eliminated = log.reveals.flatMap((r) => r.eliminated);
  assert.equal(eliminated.length, 6, `6 eliminations at ${start!.eliminationSchedule}`);
  assert.ok(!eliminated.includes(`u${A.user.id}`), 'a perfect player is never eliminated');
  assert.equal(end.standings[0].id, `u${A.user.id}`);
  assert.ok(end.rewards!.achievements.includes('royale_win'));
});

test('private room', T, async () => {
  const states: RoomState[] = [];
  const onState = (s: RoomState | null) => s && states.push(s);
  sb.on('room:state', onState);
  const created = await emitAck(sa, 'room:create', { questions: 5, timeMs: 10000, category: 'music' });
  assert.ok(created.ok);
  assert.match(created.code, /^\d{6}$/);
  assert.ok((await emitAck(sb, 'room:join', created.code)).ok);
  sb.emit('room:bot', 'add'); // not the host → ignored
  // Handled after the bot request (a socket's events go in order), so that one has been turned down by now.
  assert.equal((await emitAck(sb, 'room:join', '00000')).ok, false, 'unknown codes are rejected');
  sa.emit('room:bot', 'add');
  await eventually(() => assert.equal(states.at(-1)!.players.length, 3, '2 humans + 1 bot'));
  assert.equal((await emitAck(sb, 'room:start')).ok, false, "non-hosts can't start");
  const pa = autoPlay(sa, 'wrong');
  const pb = autoPlay(sb, 'right');
  assert.ok((await emitAck(sa, 'room:start')).ok);
  const [{ end: ea }, { end: eb, start: sbStart }] = await Promise.all([pa, pb]);
  assert.equal(sbStart!.totalQuestions, 5);
  assert.equal(sbStart!.category, 'music');
  assert.equal(eb.rewards!.rating, null, 'private rooms are unranked');
  assert.ok(ea.rewards!.achievements.includes('host'));
  await eventually(() => assert.equal(states.at(-1)!.inGame, false, 'room returns to the lobby'));
  sa.emit('room:leave');
  await eventually(() => assert.equal(states.at(-1)!.hostId, `u${B.user.id}`, 'host passes on when the host leaves'));
  sb.emit('room:leave');
  sb.off('room:state', onState);
});

test('a class: guests join under a name of their own, the host runs it on a big screen, in rounds', T, async () => {
  const pupils = await Promise.all([guest(srv.url), guest(srv.url)]);
  const [s1, s2] = pupils.map((g) => connect(srv.url, g.cookie));
  await connected(s1, s2);
  let onState = (_: RoomState | null) => {};
  try {
    const states: RoomState[] = [];
    onState = (st: RoomState | null) => st && states.push(st);
    sa.on('room:state', onState);
    const created = await emitAck(sa, 'room:create', { maxPlayers: 40, hostPlays: false, rounds: true, questions: 5 });
    assert.ok(created.ok);
    await eventually(() => assert.ok(states.length));
    assert.deepEqual(
      [states.at(-1)!.settings.maxPlayers, states.at(-1)!.settings.rounds, states.at(-1)!.settings.questions],
      [40, true, 10],
      'up to 40; rounds are ten questions',
    );
    // Knockouts are for a handful: on, the room takes at most 8.
    sa.emit('room:settings', { elimination: true });
    await eventually(() => assert.equal(states.at(-1)!.settings.maxPlayers, 8));
    sa.emit('room:settings', { elimination: false, maxPlayers: 40 });
    await eventually(() => assert.equal(states.at(-1)!.settings.maxPlayers, 40));

    const nameless = await emitAck(s1, 'room:join', created.code);
    assert.equal(nameless.ok, false, 'a guest picks a name first');
    assert.ok((await emitAck(s1, 'room:join', { code: created.code, nickname: '  Ученик   1 ' })).ok);
    const twin = await emitAck(s2, 'room:join', { code: created.code, nickname: 'ученик 1' });
    assert.match((twin as { error: string }).error, /вече е с това име/);
    assert.ok((await emitAck(s2, 'room:join', { code: created.code, nickname: 'Ученик 2' })).ok);
    await eventually(() =>
      assert.deepEqual(
        states
          .at(-1)!
          .players.map((p) => p.name)
          .slice(1),
        ['Ученик 1', 'Ученик 2'],
      ),
    );

    // The host's screen hears the whole match and plays none of it.
    const screen = next(sa, 'game:start');
    const reveal = next(sa, 'game:reveal');
    const hostEnd = next(sa, 'game:end', 60_000);
    const p1 = autoPlay(s1, 'right');
    const p2 = autoPlay(s2, 'wrong');
    assert.ok((await emitAck(sa, 'room:start')).ok);
    const start = await screen;
    assert.equal(start.presenter, true);
    assert.equal(start.youId, '');
    assert.deepEqual(
      start.players.map((p) => p.name),
      ['Ученик 1', 'Ученик 2'],
      'the host is no player',
    );
    assert.equal(start.rounds.length, 3);
    assert.equal(Object.keys((await reveal).results).length, 2);
    const [{ end: e1 }] = await Promise.all([p1, p2]);
    assert.equal(e1.standings[0].id, start.players.find((p) => p.name === 'Ученик 1')!.id);
    assert.equal((await hostEnd).rewards, null);
  } finally {
    sa.off('room:state', onState);
    sa.emit('room:leave');
    s1.close();
    s2.close();
  }
});

test('„Моите въпроси“: a host plays their own set in a room; shared by link, copied, reported, hidden', T, async () => {
  const set = {
    name: '  Урок   по история ',
    questions: [
      {
        kind: 'choice',
        q: 'Коя е столицата на България?',
        options: ['София ✓', 'Пловдив', 'Варна', 'Бургас'],
        answer: 0,
      },
      { kind: 'truefalse', q: 'Дунав се влива в Черно море?', answer: true },
      {
        kind: 'number',
        q: 'През коя година е Освобождението? (= 1878)',
        number: { answer: 1878, unit: 'г.', tolerance: 10 },
      },
    ],
  };
  const bad = await api.send('POST', '/api/sets', A.cookie, {
    ...set,
    questions: [{ kind: 'choice', q: 'Двойно?', options: ['а', 'а', 'б', 'в'], answer: 0 }],
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /^Въпрос 1: .*еднакви/);
  const made = await api.send('POST', '/api/sets', A.cookie, set);
  assert.equal(made.status, 200);
  const mine = (await api.get(`/api/sets/${made.body.id}`, A.cookie)).body;
  assert.equal(mine.name, 'Урок по история');
  assert.equal((await api.get(`/api/sets/${made.body.id}`, B.cookie)).status, 404, 'theirs alone');

  // Into a room: all of the set's questions, in its order, with no XP for answers and nothing measured.
  const states: RoomState[] = [];
  const onState = (st: RoomState | null) => st && states.push(st);
  sa.on('room:state', onState);
  try {
    const room = (await emitAck(sa, 'room:create', {})) as { code: string };
    assert.ok((await emitAck(sb, 'room:join', room.code)).ok);
    sa.emit('room:settings', { set: made.body.id });
    await eventually(() =>
      assert.deepEqual(states.at(-1)!.settings.set, { id: made.body.id, name: 'Урок по история', questions: 3 }),
    );
    sb.emit('room:settings', { set: null }); // not the host
    const log = newLog();
    const pa = autoPlay(sa, 'right', log);
    const pb = autoPlay(sb, 'right');
    const before = (await api.get(`/api/profile/${encodeURIComponent(A.user.username)}`, A.cookie)).body.overview;
    assert.ok((await emitAck(sa, 'room:start')).ok);
    const [{ start, end }] = await Promise.all([pa, pb]);
    assert.equal(start!.questionSet, 'Урок по история');
    assert.deepEqual(
      log.questions.map((q) => [q.kind, q.options.length]),
      [
        ['choice', 4],
        ['choice', 2],
        ['number', 0],
      ],
    );
    assert.deepEqual(log.questions[1].options, ['Вярно', 'Невярно']);
    assert.ok(!end.rewards!.breakdown.some((l) => l.label.startsWith('Верни отговори')), 'no XP for answers');
    const after = (await api.get(`/api/profile/${encodeURIComponent(A.user.username)}`, A.cookie)).body.overview;
    assert.equal(after.questionsAnswered, before.questionsAnswered, 'nothing measured');
    sa.emit('room:leave');
    sb.emit('room:leave');
  } finally {
    sa.off('room:state', onState);
  }

  // Shared: another host sees what it is, takes a copy; a report about it, and a moderator hides it.
  const preview = (await api.get(`/api/sets/shared/${mine.code}`, B.cookie)).body;
  assert.deepEqual(preview, {
    name: 'Урок по история',
    author: A.user.username,
    questions: 3,
    kinds: { choice: 1, truefalse: 1, number: 1, order: 0 },
    mine: null,
    hidden: false,
  });
  const copy = await api.send('POST', `/api/sets/shared/${mine.code}/copy`, B.cookie);
  assert.equal((await api.get(`/api/sets/${copy.body.id}`, B.cookie)).body.questions.length, 3);
  assert.equal(
    (await api.send('POST', `/api/sets/shared/${mine.code}/report`, B.cookie, { details: 'обидно' })).status,
    200,
  );
  const filed = srv.db.prepare('SELECT details FROM reports WHERE target_id = ?').get(A.user.id) as {
    details: string;
  };
  assert.match(filed.details, /^Набор „Урок по история“ \(\/sets\/shared\/.+\): обидно$/);
  srv.db.prepare('DELETE FROM reports WHERE target_id = ?').run(A.user.id); // the moderation test counts its own
  assert.equal((await api.send('POST', `/api/sets/shared/${mine.code}/hide`, B.cookie, { hidden: true })).status, 403);
  srv.db.prepare('UPDATE question_sets SET hidden = 1 WHERE code = ?').run(mine.code);
  assert.equal((await api.get(`/api/sets/shared/${mine.code}`, B.cookie)).status, 404, 'hidden');
  assert.equal(
    (await api.get(`/api/sets/shared/${mine.code}`, A.cookie)).body.mine,
    made.body.id,
    'its owner still sees it',
  );
});

test('forfeit frees the player', T, async () => {
  const q = next(sb, 'game:question');
  await emitAck(sb, 'solo:start', { category: 'mixed' });
  await q;
  sb.emit('game:leave');
  await eventually(async () =>
    assert.ok((await emitAck(sb, 'queue:join', 'duel')).ok, 'can queue again after leaving'),
  );
  sb.emit('queue:leave');
});

test('a run played alone waits for its player, and picks up where it was when they are back', T, async () => {
  const matches = () => (srv.db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n;
  const before = matches();
  const question = next(sb, 'game:question');
  assert.ok((await emitAck(sb, 'solo:start', { category: 'mixed' })).ok);
  const first = await question;
  sb.disconnect();
  await sleep(2_000); // longer than a whole match would wait for someone who dropped
  assert.equal(matches(), before, 'not played out without them');

  sb = connect(srv.url, B.cookie);
  const start = next(sb, 'game:start');
  const resumed = next(sb, 'game:question');
  await connected(sb);
  assert.equal((await start).startsInMs, 0, 'the same run, brought up to speed');
  assert.ok((await resumed).index <= first.index + 1, 'no questions lost while away');
  const left = next(sb, 'game:end', 3000).catch(() => null);
  sb.emit('game:leave');
  await left;
});

test('a match that ends while the player is offline shows its result on return', T, async () => {
  const matches = () => (srv.db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n;
  const before = matches();
  const question = next(sb, 'game:question');
  assert.ok((await emitAck(sb, 'queue:join', 'duel')).ok); // a bot takes the other seat
  await question;
  sb.disconnect();
  for (let i = 0; i < 200 && matches() === before; i++) await sleep(100); // the match runs out without them

  sb = connect(srv.url, B.cookie);
  const start = next(sb, 'game:start');
  const end = next(sb, 'game:end');
  await connected(sb);
  assert.equal((await end).gameId, (await start).gameId, 'the finished match comes back with its result');
  const again = connect(srv.url, B.cookie);
  await assert.rejects(next(again, 'game:end', 1000), 'and only once');
  again.close();
});

test('malformed socket messages are refused and never crash the server', T, async () => {
  const H = await register(srv.url, 'hostile_test');
  const sh = connect(srv.url, H.cookie);
  await connected(sh);
  // `String()` / `Number()` on this throw: it once took the whole server down.
  const evil = { toString: 1, valueOf: 1 };
  const fields = { userId: evil, inviteId: evil, index: evil, choice: evil, powerup: evil, category: evil, mode: evil };
  for (const event of ['queue:join', 'solo:start', 'room:join', 'invite:send'] as const) {
    for (const payload of [evil, fields, [evil], null]) {
      const ack = await emitAck(sh, event, payload);
      assert.equal(ack.ok, false, `${event} refuses ${JSON.stringify(payload)}`);
    }
  }
  for (const payload of [
    { rival: evil },
    { rival: A.user.id, categories: [evil, evil, evil] },
    { id: evil, rival: evil },
  ])
    assert.equal((await emitAck(sh, 'challenge:start', payload)).ok, false, 'a duel with no friend in it');
  assert.ok((await emitAck(sh, 'room:create', fields)).ok, 'unknown room settings are ignored');
  for (const event of ['room:settings', 'room:bot', 'room:kick', 'room:team', 'invite:decline'] as const)
    sh.emit(event, evil as never);
  sh.emit('room:leave');
  await sleep(1500); // the burst above used up the socket's event budget

  const question = next(sh, 'game:question');
  assert.deepEqual(await emitAck(sh, 'solo:start', { category: 'mixed' }), { ok: true });
  await question;
  for (const event of ['game:answer', 'game:powerup', 'game:react'] as const) {
    sh.emit(event, evil as never);
    sh.emit(event, fields as never);
  }
  sh.emit('game:leave');

  assert.ok((await emitAck(sh, 'queue:join', 'duel')).ok, 'the same socket still works');
  sh.emit('queue:leave');
  assert.equal((await api.get('/api/health')).status, 200, 'the server is still up');
  sh.close();
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
  // Solo, the ranked duel, Royale, the private room, the room on A's own set, the challenge link and two more duels;
  // the rematch A walked out of is listed but doesn't count as played. (Running a class on a big screen is no match.)
  assert.equal(prof.body.overview.gamesPlayed, 8);
  assert.equal(prof.body.recent.length, 9);
  // The home card's totals are the profile's.
  const { stats } = (await api.get('/api/me', A.cookie)).body.user;
  assert.equal(stats.games, prof.body.overview.gamesPlayed);
  assert.ok(stats.answered > 0 && stats.correct <= stats.answered);
  const ach = await api.get('/api/achievements', A.cookie);
  assert.ok(ach.body.achievements.length >= 39);
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

/** A and B (friends by now) see each other out of any room: the next test starts clean. */
const bothOutOfRooms = () =>
  eventually(async () => {
    const presence = async (cookie: string) => (await api.get('/api/friends', cookie)).body.friends[0].presence;
    assert.deepEqual([await presence(A.cookie), await presence(B.cookie)], ['online', 'online']);
  });

test('friends, invites and challenges', T, async () => {
  const update = next(sb, 'friends:update');
  const req = await api.send('POST', '/api/friends', A.cookie, { username: B.user.username.toUpperCase() });
  assert.equal(req.status, 200);
  assert.equal(req.body.outgoing.length, 1);
  assert.equal((await update).requests, 1, 'the update carries the badge count');
  assert.equal((await api.get('/api/me', B.cookie)).body.user.friendRequests, 1);
  assert.equal(
    (await api.send('POST', '/api/friends', A.cookie, { username: B.user.username })).status,
    400,
    'no duplicate requests',
  );
  const accepted = await api.send('POST', `/api/friends/${A.user.id}/accept`, B.cookie);
  assert.equal(accepted.body.friends.length, 1);
  // The day among friends: both played today's daily (A right, B wrong), so A leads the two of them.
  const today = (await api.get('/api/daily', B.cookie)).body.friends as { user: { id: number } }[];
  assert.deepEqual(
    today.map((e) => e.user.id),
    [A.user.id, B.user.id],
  );
  assert.equal((await api.get('/api/friends', A.cookie)).body.friends[0].presence, 'online');
  assert.equal(
    (await api.get(`/api/profile/${encodeURIComponent(B.user.username)}`, A.cookie)).body.friendship,
    'friends',
  );

  const room = await emitAck(sa, 'room:create', {});
  assert.ok(room.ok);
  const invited = next(sb, 'invite');
  assert.ok((await emitAck(sa, 'invite:send', { userId: B.user.id })).ok);
  const invite = await invited;
  assert.equal(invite.roomCode, room.code);
  assert.equal(invite.kind, 'room');
  // Only a real invite can be declined (no toast spam at arbitrary players).
  sb.emit('invite:decline', { inviteId: 'made-up' });
  await assert.rejects(next(sa, 'notice', 300), 'a made-up invite id is ignored');
  const declined = next(sa, 'notice');
  sb.emit('invite:decline', { inviteId: invite.id });
  assert.match((await declined).message, /отказа/);
  sa.emit('room:leave');

  await bothOutOfRooms();

  // A friend duel: A plays now, B within a day. B hears it's their turn (with the score to beat), A how it ended.
  const aPlays = autoPlay(sa, 'right');
  const duel = await emitAck(sa, 'challenge:start', { rival: B.user.id });
  assert.ok(duel.ok);
  const { start: aStart, end: aEnd } = await aPlays;
  assert.deepEqual(aStart!.duelWith, { username: B.user.username, score: null }, 'B has not played it yet');
  assert.equal(aEnd.rewards!.challenge!.duel!.outcome, null);
  const aScore = aEnd.standings[0].score;
  await eventually(async () => {
    const [note] = (await api.get('/api/notifications', B.cookie)).body.notifications;
    assert.equal(
      note.text,
      `${A.user.username} те предизвика на дуел: ${aScore} точки за биене. Имаш 24 часа да го изиграеш.`,
    );
    assert.equal(note.link, `/c/${duel.id}`);
  });
  assert.equal((await api.get('/api/duels', B.cookie)).body.duels[0].state, 'yours');
  assert.equal((await api.get('/api/duels', A.cookie)).body.duels[0].state, 'theirs');
  assert.equal((await api.get(`/api/challenges/${duel.id}`, B.cookie)).body.duel.theirs.score, aScore);

  const xpBefore = (await api.get('/api/me', A.cookie)).body.user.xp;
  const log = newLog();
  const bPlays = autoPlay(sb, 'wrong', log);
  assert.ok((await emitAck(sb, 'challenge:start', { id: duel.id })).ok);
  const { start: bStart, end: bEnd } = await bPlays;
  assert.deepEqual(bStart!.duelWith, { username: A.user.username, score: aScore });
  assert.deepEqual(bStart!.powerups, [], 'no козове: the two play it at different times');
  const lost = bEnd.rewards!.challenge!.duel!;
  assert.equal(lost.outcome, 'lost');
  assert.deepEqual(lost.record, { wins: 0, losses: 1, draws: 0 });
  assert.equal(lost.canPick, true, 'the loser picks the next one');
  // In rounds: three of a category, three, three, then the final.
  const cats = log.questions.map((q) => q.category);
  for (const from of [0, 3, 6]) assert.equal(new Set(cats.slice(from, from + 3)).size, 1);
  assert.equal(log.questions[9].kind, 'number');
  await eventually(async () => {
    const [note] = (await api.get('/api/notifications', A.cookie)).body.notifications;
    assert.equal(
      note.text,
      `${B.user.username} изигра дуела ви: ${aScore} на ${bEnd.standings[0].score} — печелиш (+65 XP).`,
    );
  });
  assert.equal((await api.get('/api/me', A.cookie)).body.user.xp, xpBefore + 65, 'the win, for whoever played first');
  const aDuels = (await api.get('/api/duels', A.cookie)).body.duels;
  assert.deepEqual([aDuels[0].state, aDuels[0].outcome], ['done', 'won']);
  assert.deepEqual((await api.get(`/api/profile/${encodeURIComponent(B.user.username)}`, A.cookie)).body.duels, {
    wins: 1,
    losses: 0,
    draws: 0,
  });

  // The rematch: its categories are picked by whoever lost the last one, not by the winner.
  const picked = ['history', 'music', 'sports'];
  assert.equal((await emitAck(sa, 'challenge:start', { rival: B.user.id, categories: picked })).ok, false);
  const rematchLog = newLog();
  const bRematch = autoPlay(sb, 'right', rematchLog);
  assert.ok((await emitAck(sb, 'challenge:start', { rival: A.user.id, categories: picked })).ok);
  await bRematch;
  assert.deepEqual(
    [0, 3, 6].map((i) => rematchLog.questions[i].category),
    picked,
  );
});

test('a rematch asked for after the other had gone is waiting for them when they are back', T, async () => {
  const pa = autoPlay(sa, 'right');
  const pb = autoPlay(sb, 'wrong');
  assert.ok((await emitAck(sa, 'queue:join', 'duel')).ok);
  assert.ok((await emitAck(sb, 'queue:join', 'duel')).ok);
  const [{ end }] = await Promise.all([pa, pb]);
  sa.close();
  // Friends by now: B sees when the server has noticed A is gone.
  await eventually(async () =>
    assert.equal((await api.get('/api/friends', B.cookie)).body.friends[0].presence, 'offline'),
  );
  const asked = next(sb, 'rematch:state');
  sb.emit('rematch:request', { gameId: end.gameId });
  await asked;
  sb.emit('rematch:decline', { gameId: end.gameId });
  await eventually(async () => {
    const [note] = (await api.get('/api/notifications', A.cookie)).body.notifications;
    assert.match(note.text, new RegExp(`^${B.user.username} поиска реванш`));
    assert.equal(note.link, `/profile/${encodeURIComponent(B.user.username)}`);
  });
  sa = connect(srv.url, A.cookie);
  await connected(sa);
});

test('team room', T, async () => {
  const states: RoomState[] = [];
  const onState = (s: RoomState | null) => s && states.push(s);
  sa.on('room:state', onState);
  const room = await emitAck(sa, 'room:create', { questions: 5 });
  assert.ok(room.ok);
  await emitAck(sb, 'room:join', room.code);
  sa.emit('room:settings', { teams: true, elimination: true });
  sa.emit('room:bot', 'add');
  sa.emit('room:bot', 'add');
  await eventually(() => assert.equal(states.at(-1)!.players.length, 4));
  let st = states.at(-1)!;
  assert.ok(st.settings.teams && !st.settings.elimination, 'teams switch eliminations off');
  const teamOf = (id: string) => st.players.find((p) => p.id === id)!.team;
  assert.notEqual(teamOf(`u${A.user.id}`), teamOf(`u${B.user.id}`), 'A and B start on different teams');
  sa.emit('room:team', `u${B.user.id}`);
  await eventually(() => {
    st = states.at(-1)!;
    assert.equal(teamOf(`u${A.user.id}`), teamOf(`u${B.user.id}`), 'the host moved B');
  });
  const pa = autoPlay(sa, 'right');
  const pb = autoPlay(sb, 'right');
  assert.ok((await emitAck(sa, 'room:start')).ok);
  const [{ start, end }] = await Promise.all([pa, pb]);
  assert.ok(start!.teams && start!.players.every((p) => p.team === 0 || p.team === 1));
  assert.equal(end.teamScores!.length, 2);
  assert.ok(end.teamScores![0].score >= end.teamScores![1].score);
  assert.equal(end.standings.find((s) => s.id === `u${A.user.id}`)!.placement, 1);
  assert.ok(!end.rewards!.achievements.includes('team_win'), 'two friends against bots in a room is practice');
  sa.off('room:state', onState);
  sa.emit('room:leave');
  sb.emit('room:leave');
  await bothOutOfRooms();
});

test('Арена (3–5): alone, two bots make it three; the match is in rounds with a number final', T, async () => {
  const log = newLog();
  const play = autoPlay(sa, 'right', log);
  assert.ok((await emitAck(sa, 'queue:join', 'squad')).ok);
  const { start, end } = await play;
  assert.equal(start!.players.length, 3, 'up to its minimum, no more bots');
  assert.equal(start!.totalQuestions, 10);
  assert.equal(start!.rounds.length, 3);
  assert.equal(log.questions.at(-1)!.kind, 'number');
  assert.ok(end.rewards!.rating, 'rated');
});

test('Отбори: two friends go into the queue as a pair and play on one team (here against two bots)', T, async () => {
  const alone = await emitAck(sa, 'queue:join', 'teams');
  assert.equal(alone.ok, false, 'never one alone');
  // Accounts with some history (a new one plays people unrated), whatever ran before this.
  srv.db
    .prepare('UPDATE users SET games_played = MAX(games_played, ?) WHERE id IN (?, ?)')
    .run(RATED_AFTER.games, A.user.id, B.user.id);
  const invited = next(sb, 'invite');
  assert.deepEqual(await emitAck(sa, 'duo:invite', { userId: B.user.id }), { ok: true });
  const invite = await invited;
  assert.deepEqual([invite.kind, invite.from.id, invite.roomCode], ['duo', A.user.id, null]);
  const playA = autoPlay(sa, 'right');
  const playB = autoPlay(sb, 'wrong');
  assert.deepEqual(await emitAck(sb, 'duo:accept', { inviteId: invite.id }), { ok: true });
  const [{ start, end }, b] = await Promise.all([playA, playB]);
  assert.equal(start!.players.length, 4);
  const teamOf = (userId: number) => start!.players.find((p) => p.userId === userId)!.team;
  assert.equal(teamOf(A.user.id), teamOf(B.user.id), 'the pair plays together');
  assert.ok(
    start!.players.filter((p) => p.team !== teamOf(A.user.id)).every((p) => p.isBot),
    'against two bots',
  );
  assert.ok(end.rewards!.rating && b.end.rewards!.rating, 'team rating moves');
  // A ranked match against bots is a real one: its win counts.
  const won = end.standings.find((s) => s.id === `u${A.user.id}`)!.placement === 1;
  assert.equal(end.rewards!.achievements.includes('team_win'), won);
  // An invite is good once.
  assert.equal((await emitAck(sb, 'duo:accept', { inviteId: invite.id })).ok, false);
});

test('козове', T, async () => {
  const reveals: RevealPayload[] = [];
  let start: GameStartPayload | null = null;
  let retry: { wrong: number } | null = null;
  let removed: number[] | undefined;
  let firstRight = -1;
  let finalPowerup = false;
  sa.on('game:start', (s) => (start = s));
  sa.on('game:retry', (r) => (retry = r));
  sa.on('game:powerup', (e: PowerupEvent) => {
    if (e.powerup === 'fifty' && e.playerId === `u${A.user.id}`) removed = e.removed;
    if (e.playerId === `u${A.user.id}` && reveals.length === 9) finalPowerup = true;
  });
  sa.on('game:reveal', (r) => reveals.push(r));
  sa.on('game:question', (q: QuestionPayload) => {
    const right = rightOption(q);
    const pick = (choice: number, ms: number) =>
      setTimeout(() => sa.emit('game:answer', { index: q.index, choice }), ms);
    if (q.index === 0) {
      firstRight = right;
      sa.emit('game:powerup', { index: 0, powerup: 'fifty' });
      pick(right, 40);
    } else if (q.index === 2) {
      // A Дуел's first round is easy, easy, medium: "Двойно или нищо" is for the medium one.
      sa.emit('game:powerup', { index: 2, powerup: 'retry' });
      sa.emit('game:powerup', { index: 2, powerup: 'double' }); // a second one on the same question → ignored
      pick((right + 1) % 4, 40);
      pick(right, 120);
    } else if (q.kind === 'number') {
      sa.emit('game:powerup', { index: q.index, powerup: 'double' }); // none on a number
      answer(sa, q, true);
    } else {
      answer(sa, q, true);
    }
  });
  sb.on('game:question', (q) => answer(sb, q, true, 20));
  const aEnd = next(sa, 'game:end', 60_000);
  const bEnd = next(sb, 'game:end', 60_000);
  await emitAck(sa, 'queue:join', 'duel');
  await emitAck(sb, 'queue:join', 'duel');
  await Promise.all([aEnd, bEnd]);
  for (const ev of ['game:start', 'game:retry', 'game:powerup', 'game:question', 'game:reveal'] as const) sa.off(ev);
  sb.off('game:question');

  const me = `u${A.user.id}`;
  assert.deepEqual([...start!.powerups].sort(), ['double', 'fifty', 'retry'], 'all козове');
  assert.equal(removed?.length, 2, '50/50 takes two answers away');
  assert.ok(!removed!.includes(firstRight), 'never the right one');
  assert.ok(reveals[0].results[me].correct, 'and the right one is still there to pick');
  assert.equal(reveals[2].results[me].doubled, false, 'one коз per question');
  assert.ok(retry, 'Втори шанс reports the first miss');
  assert.ok(reveals[2].results[me].correct && reveals[2].results[me].retried, 'the second pick counts (half points)');
  assert.equal(reveals[9].answerNumber !== undefined, true, 'the Дуел ends on a number');
  assert.equal(finalPowerup, false, 'and no коз is played on it');
});

test("alone in a Дуел, the opponent is a recording of a real player's match when one fits", T, async () => {
  const C = await register(srv.url, 'recorded_test');
  // Past a newcomer's first matches (gentle bots), and about as strong as A was.
  srv.db.prepare('UPDATE users SET mp_games = 10 WHERE id = ?').run(C.user.id);
  const { rating } = srv.db
    .prepare("SELECT rating FROM player_skill WHERE user_id = ? AND category = 'all'")
    .get(A.user.id) as { rating: number };
  srv.db
    .prepare("INSERT INTO player_skill (user_id, category, rating, answers) VALUES (?, 'all', ?, 100)")
    .run(C.user.id, rating);
  const sc = connect(srv.url, C.cookie);
  await connected(sc);
  const play = autoPlay(sc, 'right');
  assert.ok((await emitAck(sc, 'queue:join', 'duel')).ok);
  const { start, end } = await play;
  const recording = start!.players.find((p) => p.record);
  assert.equal(recording?.name, A.user.username, "A's match, played back");
  assert.equal(recording?.userId, null);
  assert.ok(!start!.players.some((p) => p.isBot), 'no bot');
  assert.ok(end.rewards!.rating, 'rated, as against a bot');
  assert.ok(
    srv.db.prepare('SELECT 1 FROM record_plays WHERE owner_id = ? AND player_id = ?').get(A.user.id, C.user.id),
    'A hears about it tomorrow',
  );
  sc.close();
});

test('community questions', T, async () => {
  const draft = {
    category: 'geography',
    difficulty: 'easy',
    q: 'Тестов общностен въпрос за реките?',
    options: ['Верен ✓ общ', 'Грешен a', 'Грешен b', 'Грешен c'],
    answer: 0,
    answerSource: 'https://bg.wikipedia.org/wiki/Река',
  };
  const { answerSource: _, ...unsourced } = draft;
  assert.equal(
    (await api.send('POST', '/api/submissions', B.cookie, unsourced)).status,
    400,
    'a question comes with where its answer is checked',
  );
  assert.equal(
    (await api.send('POST', '/api/submissions', B.cookie, { ...draft, fact: 'Тази река тече на север към морето.' }))
      .status,
    400,
    'and a fact with its own source',
  );
  const sub = await api.send('POST', '/api/submissions', B.cookie, draft);
  assert.equal(sub.status, 201, sub.body.error);
  assert.equal((await api.send('POST', '/api/submissions', B.cookie, draft)).status, 400, 'duplicates are rejected');
  const invalid = await api.send('POST', '/api/submissions', B.cookie, {
    ...draft,
    q: 'кратко',
    options: ['a', 'a', 'b', 'c'],
  });
  assert.equal(invalid.status, 400);
  assert.equal((await api.get('/api/admin/submissions', B.cookie)).status, 403, 'non-admins cannot moderate');
  assert.equal((await api.get('/api/admin/submissions?status=pending', A.cookie)).body.submissions.length, 1);

  const notice = next(sb, 'notification');
  const edited = { ...draft, q: 'Тестов общностен въпрос за реките (редактиран)?' };
  const approve = await api.send('POST', `/api/admin/submissions/${sub.body.submission.id}/approve`, A.cookie, {
    edits: edited,
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.pending, 0);
  assert.match((await notice).item.text, /одобрен/);
  const mine = (await api.get('/api/submissions/mine', B.cookie)).body.submissions[0];
  assert.equal(mine.status, 'approved');
  assert.match(mine.q, /редактиран/);
  const achievements = (await api.get('/api/achievements', B.cookie)).body.achievements;
  assert.ok(achievements.find((a: { id: string }) => a.id === 'author_1').unlockedAt, 'author_1 unlocked');

  // The author edits or takes back one still waiting; the moderator says why one is rejected.
  const second = await api.send('POST', '/api/submissions', B.cookie, {
    ...draft,
    q: 'Втори тестов въпрос за планините?',
  });
  assert.equal(second.status, 201, second.body.error);
  const secondId = second.body.submission.id;
  const changed = await api.send('PUT', `/api/submissions/${secondId}`, B.cookie, {
    ...draft,
    q: 'Втори тестов въпрос за високите планини?',
    fact: 'Планините растат с няколко милиметра всяка година.',
    factSource: 'https://bg.wikipedia.org/wiki/Планина',
  });
  assert.equal(changed.status, 200, changed.body.error);
  assert.equal(changed.body.submission.fact, 'Планините растат с няколко милиметра всяка година.');
  assert.equal(
    (await api.send('PUT', `/api/submissions/${secondId}`, A.cookie, draft)).status,
    400,
    "not someone else's",
  );
  const similar = (await api.get(`/api/admin/submissions/${secondId}/similar`, A.cookie)).body.similar;
  assert.ok(Array.isArray(similar));
  const reject = (reason: string) =>
    api.send('POST', `/api/admin/submissions/${secondId}/reject`, A.cookie, { reason });
  assert.equal((await reject('')).status, 400, 'a rejection says why');
  const rejectNote = next(sb, 'notification');
  assert.equal((await reject('Отговорът не е еднозначен.')).status, 200);
  assert.match((await rejectNote).item.text, /Отговорът не е еднозначен/);
  assert.equal(
    (await api.send('PUT', `/api/submissions/${secondId}`, B.cookie, draft)).status,
    400,
    'a reviewed one stays as it was',
  );
  const third = await api.send('POST', '/api/submissions', B.cookie, {
    ...draft,
    q: 'Трети тестов въпрос за езерата?',
  });
  assert.equal((await api.send('DELETE', `/api/submissions/${third.body.submission.id}`, B.cookie)).status, 200);
  assert.equal((await api.get('/api/submissions/mine', B.cookie)).body.submissions.length, 2, 'withdrawn: gone');

  let found = false;
  for (let i = 0; i < 4 && !found; i++) {
    const log = newLog();
    const play = autoPlay(sb, 'right', log);
    await emitAck(sb, 'solo:start', { category: 'geography' });
    await play;
    found = log.questions.some((q) => q.author === B.user.username);
  }
  assert.ok(found, 'approved questions are played, with author credit');

  // Taken out of play and back: the author hears both, and why.
  const questionId = mine.questionId;
  assert.match(questionId, /^usr-\d+$/);
  await api.send('POST', `/api/questions/${questionId}/report`, A.cookie, { reason: 'wrong' });
  const hiddenNote = next(sb, 'notification');
  await api.send('POST', `/api/admin/question-reports/${questionId}/resolve`, A.cookie, { action: 'hide' });
  assert.match(
    (await hiddenNote).item.text,
    /Модератор скри въпроса ти .*Сигнали: Отговорът, отбелязан като верен, е грешен/,
  );
  const backNote = next(sb, 'notification');
  await api.send('POST', `/api/admin/hidden-questions/${questionId}/unhide`, A.cookie);
  assert.match((await backNote).item.text, /отново е в играта/);
});

test('season settlement', T, async () => {
  srv.db
    .prepare(
      "INSERT INTO season_ratings (user_id, season, mode, rating, peak, games, wins) VALUES (?, '2000-01', 'duel', 1300, 1310, 12, 8)",
    )
    .run(A.user.id);
  // A higher peak from only a handful of games in another mode doesn't count.
  srv.db
    .prepare(
      "INSERT INTO season_ratings (user_id, season, mode, rating, peak, games, wins) VALUES (?, '2000-01', 'royale', 1750, 1800, 4, 4)",
    )
    .run(A.user.id);
  srv.db
    .prepare(
      "INSERT INTO season_ratings (user_id, season, mode, rating, peak, games, wins) VALUES (?, '2000-01', 'duel', 900, 950, 1, 0)",
    )
    .run(B.user.id);
  const me = (await api.get('/api/me', A.cookie)).body.user;
  assert.equal(me.seasonRewards.length, 1);
  assert.equal(me.seasonRewards[0].tier, 'gold');
  assert.equal(me.seasonRewards[0].xp, SEASON_REWARD_XP.gold);
  assert.equal(me.bestSeasonTier, 2);
  assert.ok(me.achievements.includes('season_gold'));
  assert.ok(me.seasonRewards[0].unlocks.some((u: { id: string }) => u.id === 'season_gold'));
  assert.ok(
    me.seasonRewards[0].unlocks.some((u: { id: string }) => u.id === 'season_bronze'),
    'every season played leaves a title',
  );
  assert.equal((await api.send('PATCH', '/api/me/loadout', A.cookie, { frame: 'season_gold' })).status, 200);
  assert.equal((await api.get('/api/me', B.cookie)).body.user.seasonRewards[0].tier, null, 'too few games → no tier');
  await api.send('POST', '/api/season/seen', A.cookie);
  assert.equal((await api.get('/api/me', A.cookie)).body.user.seasonRewards.length, 0);
  const season = (await api.get('/api/season', A.cookie)).body;
  assert.equal(season.history[0].tier, 'gold');
  assert.equal(season.modes.length, 4, 'every ranked queue');
});

test('email verification, password reset and change', T, async () => {
  const C = await register(srv.url, 'pesho_mail', 'Pesho@Example.com');
  assert.equal(C.user.email, null, 'email stays unverified until the link is clicked');
  assert.equal(C.user.pendingEmail, 'Pesho@Example.com');
  const verify = srv.mails().at(-1)!;
  assert.equal(verify.to, 'Pesho@Example.com');
  assert.match(verify.subject, /Потвърди/);
  assert.ok(verify.text.includes('https://almanac.test/verify-email?token='), 'links use APP_URL');

  // No verified email yet → a reset request sends nothing (and says nothing).
  const before = srv.mails().length;
  assert.equal((await api.send('POST', '/api/auth/forgot', '', { login: 'pesho_mail' })).status, 200);
  assert.equal(srv.mails().length, before, 'no reset mail for an unverified address');

  const token = tokenFrom(verify);
  assert.equal((await api.send('POST', '/api/auth/verify-email', '', { token })).status, 200);
  assert.equal((await api.send('POST', '/api/auth/verify-email', '', { token })).status, 400, 'links are single-use');
  const me = (await api.get('/api/me', C.cookie)).body.user;
  assert.equal(me.email, 'Pesho@Example.com');
  assert.equal(me.pendingEmail, null);

  // Changing the email needs the password (whoever controls the email can reset the password).
  assert.equal((await api.send('POST', '/api/account/email', B.cookie, { email: 'pesho@example.com' })).status, 400);
  assert.equal(
    (await api.send('POST', '/api/account/email', B.cookie, { email: 'pesho@example.com', password: 'wrong-pass' }))
      .status,
    400,
  );
  // Someone else can't claim a verified address, but isn't told why until verification.
  assert.equal(
    (await api.send('POST', '/api/account/email', B.cookie, { email: 'pesho@example.com', password: 'secret123' }))
      .status,
    200,
  );
  const stolen = (await api.send('POST', '/api/auth/verify-email', '', { token: tokenFrom(srv.mails().at(-1)!) })).body;
  assert.match(stolen.error, /друг профил/);
  assert.equal(
    (await api.send('POST', '/api/account/email', B.cookie, { email: 'not-an-email', password: 'secret123' })).status,
    400,
  );

  // Unknown logins get the same answer and no email.
  const count = srv.mails().length;
  assert.equal((await api.send('POST', '/api/auth/forgot', '', { login: 'nobody_here' })).status, 200);
  assert.equal(srv.mails().length, count);

  // Reset by email (case-insensitive) → new password, every session logged out.
  assert.equal((await api.send('POST', '/api/auth/forgot', '', { login: 'PESHO@example.com' })).status, 200);
  const reset = srv.mails().at(-1)!;
  assert.equal(reset.to, 'Pesho@Example.com');
  assert.match(reset.subject, /Нова парола/);
  const resetToken = tokenFrom(reset);
  assert.equal(
    (await api.send('POST', '/api/auth/reset', '', { token: resetToken, password: '123' })).status,
    400,
    'short passwords are refused',
  );
  const done = await fetch(`${srv.url}/api/auth/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: resetToken, password: 'brand-new-pass' }),
  });
  assert.equal(done.status, 200);
  const newCookie = cookieFrom(done);
  assert.equal((await api.get('/api/me', C.cookie)).body.user, null, 'old sessions are logged out');
  assert.equal((await api.get('/api/me', newCookie)).body.user.username, 'pesho_mail', 'the reset logs you in');
  assert.equal(
    (await api.send('POST', '/api/auth/reset', '', { token: resetToken, password: 'another-pass' })).status,
    400,
    'reset links are single-use',
  );
  assert.equal(
    (await api.send('POST', '/api/auth/login', '', { username: 'pesho_mail', password: 'secret123' })).status,
    401,
  );
  assert.equal(
    (await api.send('POST', '/api/auth/login', '', { username: 'pesho@example.com', password: 'brand-new-pass' }))
      .status,
    200,
    'login by email',
  );

  // Expired links don't work.
  await api.send('POST', '/api/auth/forgot', '', { login: 'pesho_mail' });
  srv.db.prepare('UPDATE email_tokens SET expires_at = 0 WHERE used_at IS NULL').run();
  assert.equal(
    (
      await api.send('POST', '/api/auth/reset', '', {
        token: tokenFrom(srv.mails().at(-1)!),
        password: 'whatever-pass',
      })
    ).status,
    400,
  );

  // A reset link mailed before a password change can't undo it.
  await api.send('POST', '/api/auth/forgot', '', { login: 'pesho_mail' });
  const beforeChange = tokenFrom(srv.mails().at(-1)!);

  // Changing the password needs the current one and keeps only this session.
  const second = await fetch(`${srv.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'pesho_mail', password: 'brand-new-pass' }),
  });
  const secondCookie = cookieFrom(second);
  assert.equal(
    (await api.send('POST', '/api/account/password', newCookie, { current: 'wrong', next: 'third-pass' })).status,
    400,
  );
  assert.equal(
    (await api.send('POST', '/api/account/password', newCookie, { current: 'brand-new-pass', next: 'third-pass' }))
      .status,
    200,
  );
  assert.ok((await api.get('/api/me', newCookie)).body.user, 'the current session stays');
  assert.equal((await api.get('/api/me', secondCookie)).body.user, null, 'other sessions are logged out');
  assert.equal(
    (await api.send('POST', '/api/auth/reset', '', { token: beforeChange, password: 'taken-over-1' })).status,
    400,
    'a reset link from before the change is dead',
  );
  await api.send('POST', '/api/auth/forgot', '', { login: 'pesho_mail' });
  const beforeRemoval = tokenFrom(srv.mails().at(-1)!);

  assert.equal(
    (await api.send('DELETE', '/api/account/email', newCookie, {})).status,
    400,
    'removing it needs the password too',
  );
  const sentBefore = srv.mails().length;
  assert.equal(
    (await api.send('DELETE', '/api/account/email', newCookie, { password: 'third-pass' })).body.user.email,
    null,
    'email can be removed',
  );
  const notice = srv
    .mails()
    .slice(sentBefore)
    .find((m) => m.to === 'Pesho@Example.com');
  assert.match(notice?.subject ?? '', /премахнат/, 'the old address is told');
  assert.equal(
    (await api.send('POST', '/api/auth/reset', '', { token: beforeRemoval, password: 'taken-over-2' })).status,
    400,
    'nor does one mailed to an address the account no longer has',
  );
});

test('moderation: name filter, reports, rename, ban', T, async () => {
  assert.equal(
    (await api.send('POST', '/api/auth/register', '', { username: 'pu7ka', password: 'secret123' })).status,
    400,
    'offensive names are refused',
  );
  assert.equal(
    (await api.send('POST', '/api/auth/register', '', { username: 'Admin_1', password: 'secret123' })).status,
    400,
    'reserved names are refused',
  );

  const D = await register(srv.url, 'troll_test');
  assert.equal(
    (await api.send('POST', '/api/reports', B.cookie, { username: 'troll_test', reason: 'nope' })).status,
    400,
    'reason is required',
  );
  assert.equal(
    (await api.send('POST', '/api/reports', D.cookie, { username: 'troll_test', reason: 'name' })).status,
    400,
    'no self-reports',
  );
  assert.equal(
    (
      await api.send('POST', '/api/reports', B.cookie, {
        username: 'troll_test',
        reason: 'behavior',
        details: 'спами емоции',
      })
    ).status,
    200,
  );
  assert.equal(
    (await api.send('POST', '/api/reports', B.cookie, { username: 'troll_test', reason: 'name' })).status,
    200,
    'a repeat report updates the open one',
  );
  assert.equal((await api.get('/api/admin/reports', B.cookie)).status, 403, 'only admins see reports');
  const queue = (await api.get('/api/admin/reports', A.cookie)).body.groups;
  assert.equal(queue.length, 1);
  assert.equal(queue[0].target.username, 'troll_test');
  assert.equal(queue[0].reports.length, 1);
  assert.equal(queue[0].reports[0].reason, 'name');
  assert.deepEqual((await api.get('/api/admin/summary', A.cookie)).body.openReports, 1);

  const resolve = (body: object) => api.send('POST', `/api/admin/reports/${D.user.id}/resolve`, A.cookie, body);
  assert.equal(
    (await resolve({ action: 'rename', username: 'kurva_1', basis: 'name', reason: 'Името обижда другите играчи.' }))
      .status,
    400,
    "moderators can't pick offensive names either",
  );
  assert.equal(
    (
      await resolve({
        action: 'rename',
        username: 'm\u0430ria_test',
        basis: 'name',
        reason: 'Името обижда другите играчи.',
      })
    ).status,
    400,
    'or a name that passes for another player',
  );
  const grounds = { basis: 'name', reason: 'Името обижда другите играчи.' };
  assert.equal(
    (await resolve({ action: 'rename', username: 'Мирен_играч' })).status,
    400,
    'a decision names its basis and a reason the player reads',
  );
  assert.equal(
    (await resolve({ action: 'rename', username: 'Мирен_играч', basis: 'name', reason: 'лошо' })).status,
    400,
  );
  assert.equal((await resolve({ action: 'rename', username: 'Мирен_играч', ...grounds })).status, 200);
  const renamed = (await api.get('/api/notifications', D.cookie)).body.notifications[0];
  assert.match(
    renamed.text,
    /Мирен_играч.*Неподходящо име.*Името обижда/,
    'the player is told why, and where to appeal',
  );
  assert.equal((await api.get('/api/me', D.cookie)).body.user.username, 'Мирен_играч');
  assert.equal((await api.get('/api/admin/reports', A.cookie)).body.groups.length, 0, 'reports close when resolved');

  await api.send('POST', '/api/reports', B.cookie, { username: 'Мирен_играч', reason: 'cheating' });
  assert.equal(
    (await resolve({ action: 'ban', days: 7, basis: 'cheating', reason: 'Отговаря с програма.' })).status,
    200,
  );
  assert.equal((await api.get('/api/me', D.cookie)).body.user, null, 'a ban logs the player out');
  const login = await api.send('POST', '/api/auth/login', '', { username: 'Мирен_играч', password: 'secret123' });
  assert.equal(login.status, 403);
  assert.match(login.body.error, /спрян до .*Нечестна игра.*Отговаря с програма.*Ако смяташ, че е грешка/);
  assert.equal(
    (await resolve({ action: 'ban', days: null, basis: 'cheating', reason: 'Пак отговаря с програма.' })).status,
    200,
    'permanent bans',
  );
  assert.match(
    (await api.send('POST', '/api/auth/login', '', { username: 'Мирен_играч', password: 'secret123' })).body.error,
    /за постоянно/,
  );
});

test('a moderator gives the password again for changes, at most an hour after giving it', T, async () => {
  // A saved guest made a moderator. Saving set the password, so it counts as given then; an hour and more ago here.
  const guestM = await guest(srv.url);
  const claimed = await api.send('POST', '/api/account/claim', guestM.cookie, {
    username: 'nov_moderator',
    password: 'secret123',
  });
  assert.equal(claimed.status, 200);
  const M = { cookie: claimed.cookie! };
  const sessionHash = createHash('sha256')
    .update(decodeURIComponent(M.cookie.split('=')[1]))
    .digest('base64url');
  srv.db.prepare('UPDATE sessions SET confirmed_at = ? WHERE token = ?').run(Date.now() - 61 * 60_000, sessionHash);
  assert.equal(cli(srv.dbPath, 'admin', 'add', 'nov_moderator').status, 0);
  const reject = () => api.send('POST', '/api/admin/submissions/999999/reject', M.cookie, { reason: '' });

  assert.equal((await api.get('/api/admin/summary', M.cookie)).status, 200, 'looking needs no password');
  const asked = await reject();
  assert.equal(asked.status, 403);
  assert.equal(asked.body.confirm, true, 'a change asks for it');
  assert.equal((await api.send('POST', '/api/auth/confirm', M.cookie, { password: 'wrong-password' })).status, 400);
  assert.equal((await api.send('POST', '/api/auth/confirm', M.cookie, { password: 'secret123' })).status, 200);
  assert.equal((await reject()).status, 400, 'then the change goes through (to "no such question")');

  srv.db.prepare('UPDATE sessions SET confirmed_at = ? WHERE token = ?').run(Date.now() - 61 * 60_000, sessionHash);
  assert.equal((await reject()).status, 403, 'an hour later it asks again');
});

test('every moderation decision is logged with its grounds, and can be undone', T, async () => {
  const E = await register(srv.url, 'izmamnik_test');
  const act = (what: string, body: object = {}) =>
    api.send('POST', `/api/admin/players/${E.user.id}/${what}`, A.cookie, body);
  const card = async () => (await api.get(`/api/admin/players/${E.user.id}`, A.cookie)).body.card;
  const log = async () => (await api.get('/api/admin/log', A.cookie)).body.entries;
  const undo = (id: number) => api.send('POST', `/api/admin/log/${id}/undo`, A.cookie);

  assert.equal((await api.get('/api/admin/players?q=izmam', B.cookie)).status, 403, 'moderators only');
  const found = (await api.get('/api/admin/players?q=izmam', A.cookie)).body.players;
  assert.deepEqual(
    found.map((p: { user: { username: string } }) => p.user.username),
    ['izmamnik_test'],
    'found by part of the name',
  );
  assert.deepEqual((await api.get('/api/admin/players?q=%25', A.cookie)).body.players, [], "LIKE's wildcards are text");

  // This season's results: a rating, a daily on the board, a place in the evening Роял.
  const season = seasonKey();
  const day = dayKey();
  srv.db
    .prepare(
      "INSERT INTO season_ratings (user_id, season, mode, rating, peak, games, wins) VALUES (?, ?, 'duel', 1500, 1520, 12, 10)",
    )
    .run(E.user.id, season);
  srv.db
    .prepare(
      'INSERT INTO daily_results (user_id, day, started_at, finished_at, score, correct, time_ms, own_set) VALUES (?, ?, ?, ?, 9000, 10, 30000, 0)',
    )
    .run(E.user.id, day, Date.now(), Date.now());
  srv.db
    .prepare('INSERT INTO evening_results (day, user_id, placement, score, players) VALUES (?, ?, 1, 9000, 30)')
    .run(day, E.user.id);
  const value = (sql: string) => Object.values(srv.db.prepare(sql).get(E.user.id) as object)[0];
  const results = () => ({
    rating: value('SELECT COUNT(*) AS n FROM season_ratings WHERE user_id = ?'),
    daily: value('SELECT own_set FROM daily_results WHERE user_id = ?'),
    evening: value('SELECT COUNT(*) AS n FROM evening_results WHERE user_id = ?'),
  });
  const before = results();

  assert.equal((await act('ban', { days: 30, basis: 'cheating' })).status, 400, 'a ban names a reason');
  assert.equal((await act('ban', { days: 30, reason: 'Отговаря с програма.' })).status, 400, 'and a basis');
  const banned = await act('ban', { days: 30, basis: 'cheating', reason: 'Отговаря с програма.', annul: true });
  assert.equal(banned.status, 200, banned.body.error);
  assert.equal(banned.body.card.ban.basis, 'cheating');
  assert.deepEqual(results(), { rating: 0, daily: 1, evening: 0 }, 'results annulled');
  const [annulled, ban] = await log();
  assert.equal(annulled.action, 'annul');
  assert.equal(ban.action, 'ban');
  assert.equal(ban.admin, A.user.username);
  assert.equal(ban.user.username, 'izmamnik_test');
  assert.equal(ban.basis, 'cheating');
  assert.match(ban.reason, /30 дни\. Отговаря с програма\./);
  assert.ok(ban.canUndo && annulled.canUndo);
  assert.deepEqual(
    (await card()).log.map((e: { action: string }) => e.action),
    ['annul', 'ban'],
    "the player's card has their history",
  );

  assert.equal((await act('ban-change', { days: 3, reason: 'кратко' })).status, 400);
  assert.ok(
    (await act('ban-change', { days: 3, reason: 'Първо нарушение, по-кратко.' })).body.card.ban.until <
      Date.now() + 4 * 86_400_000,
  );
  assert.equal((await act('ban-change', { days: null, reason: 'Беше грешка в играта.' })).body.card.ban, null);
  // The ban logged them out: the note waits for their next sign-in.
  const unbanned = srv.db
    .prepare('SELECT text FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(E.user.id) as { text: string };
  assert.match(unbanned.text, /можеш да играеш отново/);

  // Undone in any order: each puts back what it changed.
  const [unban] = await log();
  assert.equal((await undo(unban.id)).status, 200);
  assert.ok((await card()).ban, 'the unban undone: banned again');
  assert.equal((await undo(unban.id)).status, 400, 'once');
  assert.equal((await undo(ban.id)).status, 200);
  assert.equal((await card()).ban, null, 'the ban undone: as before it');
  assert.equal((await undo(annulled.id)).status, 200);
  assert.deepEqual(results(), before, 'the results back');
  const entries = await log();
  assert.ok(entries.find((e: { id: number }) => e.id === ban.id).undoneBy === A.user.username);

  // A rename, undone while the old name is free.
  assert.equal(
    (await act('rename', { username: 'chesten_test', basis: 'name', reason: 'Името подвежда играчите.' })).status,
    200,
  );
  const [rename] = await log();
  assert.equal((await undo(rename.id)).status, 200);
  assert.equal((await card()).user.username, 'izmamnik_test');

  // A group's name: reported by a member, renamed by a moderator, undone.
  const signedIn = await api.send('POST', '/api/auth/login', '', { username: 'izmamnik_test', password: 'secret123' });
  assert.equal(signedIn.status, 200, 'with the ban undone, they sign in again');
  const group = await api.send('POST', '/api/groups', signedIn.cookie!, { name: 'Измамници' });
  assert.equal(group.status, 200, group.body.error);
  const groupId = group.body.id;
  assert.equal(
    (await api.send('POST', `/api/groups/${groupId}/report`, B.cookie, {})).status,
    404,
    'only its members report a group',
  );
  const code = (srv.db.prepare('SELECT code FROM player_groups WHERE id = ?').get(groupId) as { code: string }).code;
  await api.send('POST', `/api/groups/join/${code}`, B.cookie);
  assert.equal((await api.send('POST', `/api/groups/${groupId}/report`, B.cookie, { details: 'обидно' })).status, 200);
  const report = (await api.get('/api/admin/reports', A.cookie)).body.groups.find(
    (g: { target: { username: string } }) => g.target.username === 'izmamnik_test',
  );
  assert.match(report.reports[0].details, new RegExp(`Група „Измамници“ \\(№${groupId}\\): обидно`));
  assert.equal(
    (
      await api.send('POST', `/api/admin/groups/${groupId}/rename`, A.cookie, {
        basis: 'name',
        reason: 'Името обижда другите.',
      })
    ).status,
    200,
  );
  assert.equal((await card()).groups[0].name, `Група ${groupId}`);
  const [renameGroup] = await log();
  assert.equal(renameGroup.action, 'rename_group');
  assert.equal((await undo(renameGroup.id)).status, 200);
  assert.equal((await card()).groups[0].name, 'Измамници');
  assert.equal((await act('dismiss')).status, 200);
  await api.send('POST', `/api/groups/${groupId}/leave`, B.cookie);
});

test('data export and account deletion', T, async () => {
  const exp = await fetch(`${srv.url}/api/account/export`, { headers: { cookie: B.cookie } });
  assert.match(exp.headers.get('content-disposition') ?? '', /attachment/);
  const data = (await exp.json()) as {
    account: { username: string };
    matches: unknown[];
    achievements: unknown[];
    friends: unknown[];
  };
  assert.equal(data.account.username, B.user.username);
  assert.ok(data.matches.length > 0 && data.achievements.length > 0 && data.friends.length > 0);

  const E = await register(srv.url, 'to_be_deleted');
  const se = connect(srv.url, E.cookie);
  await connected(se);
  const play = autoPlay(se, 'right');
  await emitAck(se, 'solo:start', { category: 'mixed' });
  await play;
  assert.equal((await api.send('POST', '/api/account/delete', E.cookie, { password: 'wrong' })).status, 400);
  assert.equal((await api.send('POST', '/api/account/delete', E.cookie, { password: 'secret123' })).status, 200);
  se.close();
  assert.equal((await api.get('/api/me', E.cookie)).body.user, null);
  assert.equal(
    (await api.send('POST', '/api/auth/login', '', { username: 'to_be_deleted', password: 'secret123' })).status,
    401,
  );
  const rows = srv.db.prepare("SELECT COUNT(*) AS n FROM match_players WHERE name = 'to_be_deleted'").get() as {
    n: number;
  };
  assert.equal(rows.n, 0, 'match history no longer names the player');
  const anon = srv.db.prepare("SELECT COUNT(*) AS n FROM match_players WHERE name = 'Изтрит играч'").get() as {
    n: number;
  };
  assert.ok(anon.n >= 1);
  assert.equal(
    (srv.db.prepare('SELECT COUNT(*) AS n FROM category_stats WHERE user_id = ?').get(E.user.id) as { n: number }).n,
    0,
    'stats are erased',
  );
});

test('players flag wrong questions; moderators hide them from new matches', T, async () => {
  const log = newLog();
  const play = autoPlay(sb, 'wrong', log);
  await emitAck(sb, 'solo:start', { category: 'science' });
  await play;
  const id = log.questions[0].id;
  assert.match(id, /^science-\d+$/, 'questions carry their id');

  const report = (questionId: string, body: object) =>
    api.send('POST', `/api/questions/${questionId}/report`, B.cookie, body);
  assert.equal((await report(id, { reason: 'nonsense' })).status, 400, 'a reason from the list');
  assert.equal((await report('no-such-question', { reason: 'wrong' })).status, 400);
  assert.equal((await report(id, { reason: 'wrong', details: 'Верният е Б' })).status, 200);
  assert.equal((await report(id, { reason: 'ambiguous' })).status, 200, 'reporting again updates the open report');

  assert.equal((await api.get('/api/admin/question-reports', B.cookie)).status, 403, 'moderators only');
  const open = await api.get('/api/admin/question-reports', A.cookie);
  assert.equal(open.body.groups.length, 1);
  assert.equal(open.body.groups[0].question.id, id);
  assert.deepEqual(
    open.body.groups[0].reports.map((r: { reason: string; reporter: string }) => [r.reason, r.reporter]),
    [['ambiguous', B.user.username]],
  );
  assert.equal((await api.get('/api/admin/summary', A.cookie)).body.questionReports, 1);

  const hidden = await api.send('POST', `/api/admin/question-reports/${id}/resolve`, A.cookie, { action: 'hide' });
  assert.equal(hidden.body.groups.length, 0, 'reports closed');
  assert.deepEqual(
    hidden.body.hidden.map((q: { id: string }) => q.id),
    [id],
  );

  // The other 29 science questions keep coming; the hidden one never does.
  const seen = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const l = newLog();
    const p = autoPlay(sb, 'right', l);
    await emitAck(sb, 'solo:start', { category: 'science' });
    await p;
    for (const q of l.questions) seen.add(q.id);
  }
  assert.ok(seen.size >= 15 && !seen.has(id), 'hidden questions stay out of new matches');

  const restored = await api.send('POST', `/api/admin/hidden-questions/${id}/unhide`, A.cookie);
  assert.equal(restored.body.hidden.length, 0, 'a hide can be undone');
  const exported = (await api.get('/api/account/export', B.cookie)).body as { questionReportsFiled: unknown[] };
  assert.equal(exported.questionReportsFiled.length, 1, 'reports are part of the data export');
});

test('flags from three settled players hide a question until checked; „Поправен“ starts it over', T, async () => {
  const id = 'history-7';
  const F = await register(srv.url, 'signal_test');
  const flag = (cookie: string) => api.send('POST', `/api/questions/${id}/report`, cookie, { reason: 'wrong' });
  const hidden = async () =>
    (await api.get('/api/admin/question-reports', A.cookie)).body.hidden.map((q: { id: string }) => q.id);

  await flag(A.cookie);
  await flag(B.cookie);
  await flag(F.cookie);
  assert.deepEqual(await hidden(), [], 'an account made today does not count yet');
  srv.db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(Date.now() - 2 * 86_400_000, F.user.id);
  await flag(F.cookie);
  assert.deepEqual(await hidden(), [id], 'three settled players hide it');
  const [auto] = (await api.get('/api/admin/log', A.cookie)).body.entries;
  assert.equal(auto.action, 'auto_hide_question');
  assert.equal(auto.admin, null, 'the game did it');
  assert.equal(auto.target, id);

  srv.db.prepare('INSERT OR REPLACE INTO question_stats (question_id, answered, correct) VALUES (?, 40, 2)').run(id);
  const fixed = await api.send('POST', `/api/admin/question-reports/${id}/resolve`, A.cookie, { action: 'fixed' });
  assert.equal(fixed.status, 200, fixed.body.error);
  assert.equal(fixed.body.groups.length, 0);
  assert.deepEqual(
    fixed.body.hidden.map((q: { id: string }) => q.id),
    [],
    'back in play',
  );
  assert.equal(
    srv.db.prepare('SELECT 1 AS x FROM question_stats WHERE question_id = ?').get(id),
    undefined,
    'its numbers start over',
  );
  assert.match((await api.get('/api/notifications', F.cookie)).body.notifications[0].text, /поправен/);
});

const webDist = path.resolve(import.meta.dirname, '../../web/dist');

test('website files are served with the right caching', {
  ...T,
  skip: !fs.existsSync(webDist) && 'web app not built',
}, async () => {
  const page = await fetch(`${srv.url}/friends`);
  assert.equal(page.status, 200);
  assert.equal((await fetch(`${srv.url}/`, { method: 'HEAD' })).status, 200, 'HEAD works for uptime monitors');
  assert.match(page.headers.get('content-type') ?? '', /text\/html/, 'app routes get the page');
  assert.equal(page.headers.get('cache-control'), 'no-cache', 'the page always revalidates');

  const asset = fs.readdirSync(path.join(webDist, 'assets')).find((f) => f.endsWith('.js'))!;
  const js = await fetch(`${srv.url}/assets/${asset}`);
  assert.equal(js.status, 200);
  assert.match(
    js.headers.get('cache-control') ?? '',
    /max-age=31536000.*immutable/,
    'hashed files are cached for good',
  );

  const gone = await fetch(`${srv.url}/assets/index-from-an-old-deploy.js`);
  assert.equal(gone.status, 404, 'a missing build file is a 404, not the page');

  // A shared challenge link previews as the challenge, not the generic site.
  const { id } = srv.db.prepare('SELECT id FROM challenges WHERE rival_id IS NULL LIMIT 1').get() as { id: string };
  const shared = await (await fetch(`${srv.url}/c/${id}`)).text();
  assert.match(shared, new RegExp(`<title>${A.user.username} те предизвиква`));
  assert.match(shared, /property="og:description" content="Резултатът за биене: \d+ точки/);
  assert.match(
    await (await fetch(`${srv.url}/c/unknown-id`)).text(),
    new RegExp(`<title>${PUBLIC_PAGES['/'].title}</title>`),
    'unknown links get the plain page',
  );
});

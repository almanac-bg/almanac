// End-to-end: a real server, real sockets, two players (A is the first account, so admin) and bots.
// Sections run in order and share state, like a play session.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { GameStartPayload, PowerupEvent, QuestionPayload, RevealPayload, RoomState } from '@quiz/shared';
import {
  type Account,
  autoPlay,
  type Client,
  connect,
  connected,
  cookieFrom,
  emitAck,
  http,
  newLog,
  next,
  register,
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
const setXp = (userId: number, xp: number) => srv.db.prepare('UPDATE users SET xp = ? WHERE id = ?').run(xp, userId);

before(async () => {
  srv = await startServer();
  api = http(srv.url);
  A = await register(srv.url, 'Иван_тест');
  B = await register(srv.url, 'maria_test');
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
  const dup = await api.send('POST', '/api/auth/register', '', { username: A.user.username.toUpperCase(), password: 'secret123' });
  assert.equal(dup.status, 409, 'duplicate username (case-insensitive, Cyrillic) is rejected');
  const bad = await api.send('POST', '/api/auth/login', '', { username: A.user.username, password: 'wrongpass' });
  assert.equal(bad.status, 401, 'wrong password is rejected');
  assert.equal((await api.get('/api/me', A.cookie)).body.user?.username, A.user.username, '/me works with the session cookie');

  // Sessions slide: one used in the second half of its life is renewed to a full 30 days.
  const token = decodeURIComponent(A.cookie.split('=')[1]);
  srv.db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() + 3 * 24 * 60 * 60_000, token);
  await api.get('/api/me', A.cookie);
  const { expires_at } = srv.db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token) as { expires_at: number };
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

test('solo', T, async () => {
  const log = newLog();
  const play = autoPlay(sa, 'right', log);
  assert.deepEqual(await emitAck(sa, 'solo:start', { category: 'history' }), { ok: true });
  const { start, end } = await play;
  assert.equal(log.questions.length, 10);
  assert.ok(log.questions.every((q) => q.category === 'history'), 'all from the chosen category');
  assert.match(log.questions.map((q) => q.difficulty[0]).join(''), /^e*m*h*$/, 'difficulty ramps up');
  assert.equal(end.standings[0].correct, 10);
  assert.equal(start?.powerups.length, 0, 'no jokers at level 1');
  const ids = end.rewards!.achievements;
  assert.ok(ids.includes('first_game') && ids.includes('perfect'), `first_game + perfect (${ids})`);
  assert.ok(end.rewards!.breakdown.some((l) => l.label === 'Първи мач за деня'), 'daily bonus');
});

test('ranked duel with a mid-game reconnect', T, async () => {
  const pa = autoPlay(sa, 'right');
  const bFirstQuestion = next(sb, 'game:question');
  assert.ok((await emitAck(sa, 'queue:join', 'duel')).ok);
  assert.ok((await emitAck(sb, 'queue:join', 'duel')).ok);
  await bFirstQuestion;
  sb.disconnect();
  await sleep(150);
  sb = connect(srv.url, B.cookie);
  const synced = next<GameStartPayload>(sb, 'game:start');
  const pb = autoPlay(sb, 'wrong');
  const sync = await synced;
  assert.equal(sync.startsInMs, 0, 'reconnect re-syncs the running game');
  assert.equal(sync.players.length, 2);
  const [{ end: ea }, { end: eb }] = await Promise.all([pa, pb]);
  assert.equal(ea.standings[0].id, `u${A.user.id}`, 'A won');
  assert.ok(ea.rewards!.rating!.after > ea.rewards!.rating!.before, 'winner gains rating');
  assert.ok(eb.rewards!.rating!.after < eb.rewards!.rating!.before, 'loser drops rating');
  assert.ok(ea.rewards!.achievements.includes('first_win') && ea.rewards!.achievements.includes('flawless_duel'));
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
  assert.match(created.code, /^\d{5}$/);
  assert.ok((await emitAck(sb, 'room:join', created.code)).ok);
  assert.equal((await emitAck(sb, 'room:join', '00000')).ok, false, 'unknown codes are rejected');
  sa.emit('room:bot', 'add');
  sb.emit('room:bot', 'add'); // not the host → ignored
  await sleep(150);
  assert.equal(states.at(-1)!.players.length, 3, '2 humans + 1 bot');
  assert.equal((await emitAck(sb, 'room:start')).ok, false, "non-hosts can't start");
  const pa = autoPlay(sa, 'wrong');
  const pb = autoPlay(sb, 'right');
  assert.ok((await emitAck(sa, 'room:start')).ok);
  const [{ end: ea }, { end: eb, start: sbStart }] = await Promise.all([pa, pb]);
  assert.equal(sbStart!.totalQuestions, 5);
  assert.equal(sbStart!.category, 'music');
  assert.equal(eb.rewards!.rating, null, 'private rooms are unranked');
  assert.ok(ea.rewards!.achievements.includes('host'));
  await sleep(100);
  assert.equal(states.at(-1)!.inGame, false, 'room returns to the lobby');
  sa.emit('room:leave');
  await sleep(100);
  assert.equal(states.at(-1)!.hostId, `u${B.user.id}`, 'host passes on when the host leaves');
  sb.emit('room:leave');
  sb.off('room:state', onState);
});

test('forfeit frees the player', T, async () => {
  const q = next(sb, 'game:question');
  await emitAck(sb, 'solo:start', { category: 'mixed' });
  await q;
  sb.emit('game:leave');
  await sleep(200);
  assert.ok((await emitAck(sb, 'queue:join', 'duel')).ok, 'can queue again after leaving');
  sb.emit('queue:leave');
});

test('profiles, achievements, leaderboards, loadout', T, async () => {
  const prof = await api.get(`/api/profile/${encodeURIComponent(A.user.username)}`, B.cookie);
  assert.equal(prof.status, 200);
  assert.equal(prof.body.overview.gamesPlayed, 4);
  assert.equal(prof.body.recent.length, 4);
  const ach = await api.get('/api/achievements', A.cookie);
  assert.ok(ach.body.achievements.length >= 39);
  const duel = await api.get('/api/leaderboard/duel', A.cookie);
  assert.equal(duel.body.entries[0].user.id, A.user.id);
  assert.ok(duel.body.season?.name, 'ranked boards are seasonal');
  assert.ok((await api.get('/api/leaderboard/level', B.cookie)).body.me.rank >= 1);
  assert.equal((await api.send('PATCH', '/api/me/loadout', A.cookie, { avatar: 'crown' })).status, 200, 'royale_win avatar');
  assert.equal((await api.send('PATCH', '/api/me/loadout', A.cookie, { avatar: 'star' })).status, 400, 'level-50 avatar is locked');
});

test('daily challenge', T, async () => {
  const log = newLog();
  const play = autoPlay(sa, 'right', log);
  assert.ok((await emitAck(sa, 'daily:start')).ok);
  const { start, end } = await play;
  assert.equal(start!.mode, 'daily');
  assert.equal(start!.powerups.length, 0, 'no jokers in the daily');
  assert.equal(end.rewards!.daily!.rank, 1);
  assert.ok(end.rewards!.achievements.includes('daily_first') && end.rewards!.achievements.includes('daily_perfect'));
  assert.equal((await emitAck(sa, 'daily:start')).ok, false, 'one attempt per day');

  const logB = newLog();
  const pb = autoPlay(sb, 'wrong', logB);
  assert.ok((await emitAck(sb, 'daily:start')).ok);
  const { end: eb } = await pb;
  assert.deepEqual(logB.questions.map((q) => q.q), log.questions.map((q) => q.q), 'same questions for everyone');
  assert.deepEqual(logB.questions.map((q) => q.options), log.questions.map((q) => q.options), 'same option order');
  assert.deepEqual(eb.rewards!.daily, { rank: 2, total: 2, streak: 1 });
  const info = await api.get('/api/daily', A.cookie);
  assert.equal(info.body.played.rank, 1);
  assert.equal(info.body.entries.length, 2);
  assert.equal(info.body.streak, 1);
  const board = await api.get('/api/leaderboard/daily', B.cookie);
  assert.equal(board.body.entries[0].user.id, A.user.id);
  assert.equal(board.body.me.rank, 2);
});

test('friends, invites and challenges', T, async () => {
  const update = next(sb, 'friends:update');
  const req = await api.send('POST', '/api/friends', A.cookie, { username: B.user.username.toUpperCase() });
  assert.equal(req.status, 200);
  assert.equal(req.body.outgoing.length, 1);
  await update;
  assert.equal((await api.get('/api/me', B.cookie)).body.user.friendRequests, 1);
  assert.equal((await api.send('POST', '/api/friends', A.cookie, { username: B.user.username })).status, 400, 'no duplicate requests');
  const accepted = await api.send('POST', `/api/friends/${A.user.id}/accept`, B.cookie);
  assert.equal(accepted.body.friends.length, 1);
  assert.equal((await api.get('/api/friends', A.cookie)).body.friends[0].presence, 'online');
  assert.equal((await api.get(`/api/profile/${encodeURIComponent(B.user.username)}`, A.cookie)).body.friendship, 'friends');

  const room = await emitAck(sa, 'room:create', {});
  const invited = next(sb, 'invite');
  assert.ok((await emitAck(sa, 'invite:send', { userId: B.user.id })).ok);
  const invite = await invited;
  assert.equal(invite.roomCode, room.code);
  assert.equal(invite.kind, 'room');
  const declined = next(sa, 'notice');
  sb.emit('invite:decline', { fromUserId: A.user.id });
  assert.match((await declined).message, /отказа/);
  sa.emit('room:leave');

  const challenged = next(sb, 'invite');
  const challenge = await emitAck(sa, 'friends:challenge', { userId: B.user.id });
  assert.ok(challenge.ok);
  assert.equal((await challenged).kind, 'challenge');
  const roomState = next<RoomState>(sb, 'room:state');
  assert.ok((await emitAck(sb, 'room:join', challenge.code)).ok);
  assert.equal((await roomState).settings.maxPlayers, 2, 'a challenge is a 1v1 room');
  assert.equal((await api.get('/api/friends', B.cookie)).body.friends[0].presence, 'room');
  sa.emit('room:leave');
  sb.emit('room:leave');
  await sleep(100);
});

test('team room', T, async () => {
  const states: RoomState[] = [];
  const onState = (s: RoomState | null) => s && states.push(s);
  sa.on('room:state', onState);
  const room = await emitAck(sa, 'room:create', { questions: 5 });
  await emitAck(sb, 'room:join', room.code);
  sa.emit('room:settings', { teams: true, elimination: true });
  sa.emit('room:bot', 'add');
  sa.emit('room:bot', 'add');
  await sleep(150);
  let st = states.at(-1)!;
  assert.ok(st.settings.teams && !st.settings.elimination, 'teams switch eliminations off');
  const teamOf = (id: string) => st.players.find((p) => p.id === id)!.team;
  assert.notEqual(teamOf(`u${A.user.id}`), teamOf(`u${B.user.id}`), 'A and B start on different teams');
  sa.emit('room:team', `u${B.user.id}`);
  await sleep(100);
  st = states.at(-1)!;
  assert.equal(teamOf(`u${A.user.id}`), teamOf(`u${B.user.id}`), 'the host moved B');
  const pa = autoPlay(sa, 'right');
  const pb = autoPlay(sb, 'right');
  assert.ok((await emitAck(sa, 'room:start')).ok);
  const [{ start, end }] = await Promise.all([pa, pb]);
  assert.ok(start!.teams && start!.players.every((p) => p.team === 0 || p.team === 1));
  assert.equal(end.teamScores!.length, 2);
  assert.ok(end.teamScores![0].score >= end.teamScores![1].score);
  assert.equal(end.standings.find((s) => s.id === `u${A.user.id}`)!.placement, 1);
  assert.ok(end.rewards!.achievements.includes('team_win'));
  sa.off('room:state', onState);
  sa.emit('room:leave');
  sb.emit('room:leave');
  await sleep(100);
});

test('ranked 2 на 2 queue', T, async () => {
  const play = autoPlay(sa, 'right');
  assert.ok((await emitAck(sa, 'queue:join', 'teams')).ok);
  const { start, end } = await play;
  assert.equal(start!.players.length, 4);
  assert.equal(start!.players.filter((p) => p.team === 0).length, 2, 'two teams of two');
  assert.ok(end.rewards!.rating, 'team rating moves');
});

test('jokers', T, async () => {
  setXp(A.user.id, 20_000); // level 20: every joker
  setXp(B.user.id, 20_000);
  const reveals: RevealPayload[] = [];
  let start: GameStartPayload | null = null;
  let retry: { wrong: number } | null = null;
  let frozeTarget: string | undefined;
  let timeBonus: number | undefined;
  sa.on('game:start', (s) => (start = s));
  sa.on('game:retry', (r) => (retry = r));
  sa.on('game:powerup', (e: PowerupEvent) => {
    if (e.powerup === 'time' && e.playerId === `u${A.user.id}`) timeBonus = e.extraMs;
    if (e.powerup === 'freeze') frozeTarget = e.targetId;
  });
  sa.on('game:reveal', (r) => reveals.push(r));
  sa.on('game:question', (q: QuestionPayload) => {
    const right = rightOption(q);
    const answer = (choice: number, ms: number) => setTimeout(() => sa.emit('game:answer', { index: q.index, choice }), ms);
    if (q.index === 0) {
      sa.emit('game:powerup', { index: 0, powerup: 'freeze' });
      sa.emit('game:powerup', { index: 0, powerup: 'double' }); // second joker on the same question → ignored
      answer(right, 60);
    } else if (q.index === 1) {
      sa.emit('game:powerup', { index: 1, powerup: 'retry' });
      answer((right + 1) % 4, 40);
      answer(right, 120);
    } else if (q.index === 2) {
      sa.emit('game:powerup', { index: 2, powerup: 'time' });
      answer(right, 40);
    } else {
      answer(right, 30);
    }
  });
  const bFrozen = new Promise<boolean>((res) =>
    sb.on('game:powerup', (e) => e.powerup === 'freeze' && e.targetId === `u${B.user.id}` && res(true)),
  );
  sb.on('game:question', (q) => setTimeout(() => sb.emit('game:answer', { index: q.index, choice: rightOption(q) }), 20));
  const aEnd = next(sa, 'game:end', 60_000);
  const bEnd = next(sb, 'game:end', 60_000);
  await emitAck(sa, 'queue:join', 'duel');
  await emitAck(sb, 'queue:join', 'duel');
  await Promise.all([aEnd, bEnd]);
  for (const ev of ['game:start', 'game:retry', 'game:powerup', 'game:question', 'game:reveal'] as const) sa.off(ev);
  sb.off('game:question').off('game:powerup');

  const me = `u${A.user.id}`;
  const them = `u${B.user.id}`;
  assert.ok(['freeze', 'time', 'retry'].every((p) => start!.powerups.includes(p as never)), 'level 20 has all jokers');
  assert.ok(await Promise.race([bFrozen, sleep(10).then(() => false)]), 'the target is told it got frozen');
  assert.equal(frozeTarget, them, 'freeze targets the opponent');
  assert.equal(reveals[0].results[them].choice, null, 'a frozen player cannot answer');
  assert.equal(reveals[0].results[me].doubled, false, 'one joker per question');
  assert.ok(retry, 'Втори шанс reports the first miss');
  assert.ok(reveals[1].results[me].correct && reveals[1].results[me].retried, 'the second pick counts (half points)');
  assert.equal(timeBonus, 5000, 'Още време adds 5 s');
});

test('community questions', T, async () => {
  const draft = {
    category: 'geography',
    difficulty: 'easy',
    q: 'Тестов общностен въпрос за реките?',
    options: ['Верен ✓ общ', 'Грешен a', 'Грешен b', 'Грешен c'],
    answer: 0,
  };
  const sub = await api.send('POST', '/api/submissions', B.cookie, draft);
  assert.equal(sub.status, 201, sub.body.error);
  assert.equal((await api.send('POST', '/api/submissions', B.cookie, draft)).status, 400, 'duplicates are rejected');
  const invalid = await api.send('POST', '/api/submissions', B.cookie, { ...draft, q: 'кратко', options: ['a', 'a', 'b', 'c'] });
  assert.equal(invalid.status, 400);
  assert.equal((await api.get('/api/admin/submissions', B.cookie)).status, 403, 'non-admins cannot moderate');
  assert.equal((await api.get('/api/admin/submissions?status=pending', A.cookie)).body.submissions.length, 1);

  const notice = next(sb, 'notice');
  const edited = { ...draft, q: 'Тестов общностен въпрос за реките (редактиран)?' };
  const approve = await api.send('POST', `/api/admin/submissions/${sub.body.submission.id}/approve`, A.cookie, { edits: edited });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.pending, 0);
  assert.match((await notice).message, /одобрен/);
  const mine = (await api.get('/api/submissions/mine', B.cookie)).body.submissions[0];
  assert.equal(mine.status, 'approved');
  assert.match(mine.q, /редактиран/);
  const achievements = (await api.get('/api/achievements', B.cookie)).body.achievements;
  assert.ok(achievements.find((a: { id: string }) => a.id === 'author_1').unlockedAt, 'author_1 unlocked');

  let found = false;
  for (let i = 0; i < 4 && !found; i++) {
    const log = newLog();
    const play = autoPlay(sb, 'right', log);
    await emitAck(sb, 'solo:start', { category: 'geography' });
    await play;
    found = log.questions.some((q) => q.author === B.user.username);
  }
  assert.ok(found, 'approved questions are played, with author credit');
});

test('season settlement', T, async () => {
  srv.db
    .prepare("INSERT INTO season_ratings (user_id, season, mode, rating, peak, games, wins) VALUES (?, '2000-01', 'duel', 1300, 1310, 5, 4)")
    .run(A.user.id);
  srv.db
    .prepare("INSERT INTO season_ratings (user_id, season, mode, rating, peak, games, wins) VALUES (?, '2000-01', 'duel', 900, 950, 1, 0)")
    .run(B.user.id);
  const me = (await api.get('/api/me', A.cookie)).body.user;
  assert.equal(me.seasonRewards.length, 1);
  assert.equal(me.seasonRewards[0].tier, 'gold');
  assert.equal(me.seasonRewards[0].xp, 500);
  assert.equal(me.bestSeasonTier, 2);
  assert.ok(me.achievements.includes('season_gold'));
  assert.ok(me.seasonRewards[0].unlocks.some((u: { id: string }) => u.id === 'season_gold'));
  assert.equal((await api.send('PATCH', '/api/me/loadout', A.cookie, { frame: 'season_gold' })).status, 200);
  assert.equal((await api.get('/api/me', B.cookie)).body.user.seasonRewards[0].tier, null, 'too few games → no tier');
  await api.send('POST', '/api/season/seen', A.cookie);
  assert.equal((await api.get('/api/me', A.cookie)).body.user.seasonRewards.length, 0);
  const season = (await api.get('/api/season', A.cookie)).body;
  assert.equal(season.history[0].tier, 'gold');
  assert.equal(season.modes.length, 5);
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

  // Someone else can't claim a verified address, but isn't told why until verification.
  assert.equal((await api.send('POST', '/api/account/email', B.cookie, { email: 'pesho@example.com' })).status, 200);
  const stolen = (await api.send('POST', '/api/auth/verify-email', '', { token: tokenFrom(srv.mails().at(-1)!) })).body;
  assert.match(stolen.error, /друг профил/);
  assert.equal((await api.send('POST', '/api/account/email', B.cookie, { email: 'not-an-email' })).status, 400);

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
  assert.equal((await api.send('POST', '/api/auth/reset', '', { token: resetToken, password: '123' })).status, 400, 'short passwords are refused');
  const done = await fetch(`${srv.url}/api/auth/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: resetToken, password: 'brand-new-pass' }),
  });
  assert.equal(done.status, 200);
  const newCookie = cookieFrom(done);
  assert.equal((await api.get('/api/me', C.cookie)).body.user, null, 'old sessions are logged out');
  assert.equal((await api.get('/api/me', newCookie)).body.user.username, 'pesho_mail', 'the reset logs you in');
  assert.equal((await api.send('POST', '/api/auth/reset', '', { token: resetToken, password: 'another-pass' })).status, 400, 'reset links are single-use');
  assert.equal((await api.send('POST', '/api/auth/login', '', { username: 'pesho_mail', password: 'secret123' })).status, 401);
  assert.equal((await api.send('POST', '/api/auth/login', '', { username: 'pesho@example.com', password: 'brand-new-pass' })).status, 200, 'login by email');

  // Expired links don't work.
  await api.send('POST', '/api/auth/forgot', '', { login: 'pesho_mail' });
  srv.db.prepare('UPDATE email_tokens SET expires_at = 0 WHERE used_at IS NULL').run();
  assert.equal((await api.send('POST', '/api/auth/reset', '', { token: tokenFrom(srv.mails().at(-1)!), password: 'whatever-pass' })).status, 400);

  // Changing the password needs the current one and keeps only this session.
  const second = await fetch(`${srv.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'pesho_mail', password: 'brand-new-pass' }),
  });
  const secondCookie = cookieFrom(second);
  assert.equal((await api.send('POST', '/api/account/password', newCookie, { current: 'wrong', next: 'third-pass' })).status, 400);
  assert.equal((await api.send('POST', '/api/account/password', newCookie, { current: 'brand-new-pass', next: 'third-pass' })).status, 200);
  assert.ok((await api.get('/api/me', newCookie)).body.user, 'the current session stays');
  assert.equal((await api.get('/api/me', secondCookie)).body.user, null, 'other sessions are logged out');

  assert.equal((await api.send('DELETE', '/api/account/email', newCookie)).body.user.email, null, 'email can be removed');
});

test('moderation: name filter, reports, rename, ban', T, async () => {
  assert.equal((await api.send('POST', '/api/auth/register', '', { username: 'pu7ka', password: 'secret123' })).status, 400, 'offensive names are refused');
  assert.equal((await api.send('POST', '/api/auth/register', '', { username: 'Admin_1', password: 'secret123' })).status, 400, 'reserved names are refused');

  const D = await register(srv.url, 'troll_test');
  assert.equal((await api.send('POST', '/api/reports', B.cookie, { username: 'troll_test', reason: 'nope' })).status, 400, 'reason is required');
  assert.equal((await api.send('POST', '/api/reports', D.cookie, { username: 'troll_test', reason: 'name' })).status, 400, 'no self-reports');
  assert.equal((await api.send('POST', '/api/reports', B.cookie, { username: 'troll_test', reason: 'behavior', details: 'спами емоции' })).status, 200);
  assert.equal((await api.send('POST', '/api/reports', B.cookie, { username: 'troll_test', reason: 'name' })).status, 200, 'a repeat report updates the open one');
  assert.equal((await api.get('/api/admin/reports', B.cookie)).status, 403, 'only admins see reports');
  const queue = (await api.get('/api/admin/reports', A.cookie)).body.groups;
  assert.equal(queue.length, 1);
  assert.equal(queue[0].target.username, 'troll_test');
  assert.equal(queue[0].reports.length, 1);
  assert.equal(queue[0].reports[0].reason, 'name');
  assert.deepEqual((await api.get('/api/admin/summary', A.cookie)).body.openReports, 1);

  const resolve = (body: object) => api.send('POST', `/api/admin/reports/${D.user.id}/resolve`, A.cookie, body);
  assert.equal((await resolve({ action: 'rename', username: 'kurva_1' })).status, 400, "moderators can't pick offensive names either");
  assert.equal((await resolve({ action: 'rename', username: 'Мирен_играч' })).status, 200);
  assert.equal((await api.get('/api/me', D.cookie)).body.user.username, 'Мирен_играч');
  assert.equal((await api.get('/api/admin/reports', A.cookie)).body.groups.length, 0, 'reports close when resolved');

  await api.send('POST', '/api/reports', B.cookie, { username: 'Мирен_играч', reason: 'cheating' });
  assert.equal((await resolve({ action: 'ban', days: 7, reason: 'Нечестна игра' })).status, 200);
  assert.equal((await api.get('/api/me', D.cookie)).body.user, null, 'a ban logs the player out');
  const login = await api.send('POST', '/api/auth/login', '', { username: 'Мирен_играч', password: 'secret123' });
  assert.equal(login.status, 403);
  assert.match(login.body.error, /спрян до .*Нечестна игра/);
  assert.equal((await resolve({ action: 'ban', days: null, reason: '' })).status, 200, 'permanent bans');
  assert.match((await api.send('POST', '/api/auth/login', '', { username: 'Мирен_играч', password: 'secret123' })).body.error, /за постоянно/);
});

test('data export and account deletion', T, async () => {
  const exp = await fetch(`${srv.url}/api/account/export`, { headers: { cookie: B.cookie } });
  assert.match(exp.headers.get('content-disposition') ?? '', /attachment/);
  const data = (await exp.json()) as { account: { username: string }; matches: unknown[]; achievements: unknown[]; friends: unknown[] };
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
  assert.equal((await api.send('POST', '/api/auth/login', '', { username: 'to_be_deleted', password: 'secret123' })).status, 401);
  const rows = srv.db.prepare("SELECT COUNT(*) AS n FROM match_players WHERE name = 'to_be_deleted'").get() as { n: number };
  assert.equal(rows.n, 0, 'match history no longer names the player');
  const anon = srv.db.prepare("SELECT COUNT(*) AS n FROM match_players WHERE name = 'Изтрит играч'").get() as { n: number };
  assert.ok(anon.n >= 1);
  assert.equal((srv.db.prepare('SELECT COUNT(*) AS n FROM category_stats WHERE user_id = ?').get(E.user.id) as { n: number }).n, 0, 'stats are erased');
});

test('players flag wrong questions; moderators hide them from new matches', T, async () => {
  const log = newLog();
  const play = autoPlay(sb, 'wrong', log);
  await emitAck(sb, 'solo:start', { category: 'science' });
  await play;
  const id = log.questions[0].id;
  assert.match(id, /^science-\d+$/, 'questions carry their id');

  const report = (questionId: string, body: object) => api.send('POST', `/api/questions/${questionId}/report`, B.cookie, body);
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

const webDist = path.resolve(import.meta.dirname, '../../web/dist');

test('website files are served with the right caching', { ...T, skip: !fs.existsSync(webDist) && 'web app not built' }, async () => {
  const page = await fetch(`${srv.url}/friends`);
  assert.equal(page.status, 200);
  assert.equal((await fetch(`${srv.url}/`, { method: 'HEAD' })).status, 200, 'HEAD works for uptime monitors');
  assert.match(page.headers.get('content-type') ?? '', /text\/html/, 'app routes get the page');
  assert.equal(page.headers.get('cache-control'), 'no-cache', 'the page always revalidates');

  const asset = fs.readdirSync(path.join(webDist, 'assets')).find((f) => f.endsWith('.js'))!;
  const js = await fetch(`${srv.url}/assets/${asset}`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('cache-control') ?? '', /max-age=31536000.*immutable/, 'hashed files are cached for good');

  const gone = await fetch(`${srv.url}/assets/index-from-an-old-deploy.js`);
  assert.equal(gone.status, 404, 'a missing build file is a 404, not the page');
});

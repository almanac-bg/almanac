// End-to-end, together: friends and invites, team rooms, Арена, Отбори, козове, recordings, community questions and
// the season's end. A real server, real sockets, two players (A is the first account, so admin) and bots; the tests
// run in order and share state.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  ACHIEVEMENTS,
  type GameStartPayload,
  type PowerupEvent,
  type QuestionPayload,
  RATED_AFTER,
  type RevealPayload,
  type RoomState,
  SEASON_REWARD_XP,
} from '@quiz/shared';
import {
  type Account,
  answer,
  autoPlay,
  type Client,
  connect,
  connected,
  emitAck,
  eventually,
  http,
  newLog,
  next,
  register,
  rightOption,
  startServer,
  type TestServer,
  withSecondFactor,
} from './helpers';

const T = { timeout: 90_000 };

let srv: TestServer;
let api: ReturnType<typeof http>;
let A: Account;
let B: Account;
let sa: Client;
let sb: Client;

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

/** A and B (friends by now) see each other out of any room: the next test starts clean. */
const bothOutOfRooms = () =>
  eventually(async () => {
    const presence = async (cookie: string) => (await api.get('/api/friends', cookie)).body.friends[0].presence;
    assert.deepEqual([await presence(A.cookie), await presence(B.cookie)], ['online', 'online']);
  });

test('friends, invites and challenges', T, async () => {
  // Today's daily, played by both (A right, B wrong): the day among friends, below.
  for (const [socket, how] of [
    [sa, 'right'],
    [sb, 'wrong'],
  ] as const) {
    const played = autoPlay(socket, how);
    assert.ok((await emitAck(socket, 'daily:start')).ok);
    await played;
  }
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

  // Both rate others (a day old, ten matches): a duel win between them pays.
  srv.db.prepare('UPDATE users SET games_played = MAX(games_played, 10) WHERE id IN (?, ?)').run(A.user.id, B.user.id);
  const xpBefore = (await api.get('/api/me', A.cookie)).body.user.xp;
  const since = Date.now();
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
  // What the win unlocked (a first achievement of its kind) pays on top.
  const unlocked = srv.db
    .prepare('SELECT achievement_id AS id FROM user_achievements WHERE user_id = ? AND unlocked_at >= ?')
    .all(A.user.id, since) as { id: string }[];
  const extra = unlocked.reduce((sum, { id }) => sum + ACHIEVEMENTS.find((a) => a.id === id)!.xp, 0);
  assert.equal(
    (await api.get('/api/me', A.cookie)).body.user.xp,
    xpBefore + 65 + extra,
    'the win, for whoever played first',
  );
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
  // Whoever won (bots that don't know an answer guess, and over five questions they can come out ahead): the winning
  // team shares first place.
  const aTeam = start!.players.find((p) => p.id === `u${A.user.id}`)!.team;
  assert.equal(
    end.standings.find((s) => s.id === `u${A.user.id}`)!.placement,
    end.teamScores![0].team === aTeam ? 1 : 2,
  );
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
  // The row in C's history knows whose recording it was: A's name goes from it with A's account.
  assert.deepEqual(
    {
      ...(srv.db
        .prepare(
          'SELECT record_owner_id AS owner, name FROM match_players WHERE match_id = ? AND user_id IS NULL AND is_bot = 1',
        )
        .get(end.gameId) as object),
    },
    { owner: A.user.id, name: A.user.username },
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

  // A mistake found once it's in the game: a moderator corrects it in place. Its id stays, and so do its numbers.
  const { question_id: qid } = srv.db
    .prepare('SELECT question_id FROM question_submissions WHERE id = ?')
    .get(sub.body.submission.id) as { question_id: string };
  srv.db
    .prepare('INSERT INTO question_stats (question_id, answered, correct, correct_ms) VALUES (?, 40, 30, 90000)')
    .run(qid);
  const corrected = { ...edited, options: ['Верен ✓ общ', 'Грешен a', 'Грешен b', 'Поправен c'], answer: 0 };
  assert.equal(
    (await api.send('PUT', `/api/admin/questions/${qid}`, B.cookie, corrected)).status,
    403,
    'only moderators correct',
  );
  assert.equal((await api.send('PUT', '/api/admin/questions/no-such-id', A.cookie, corrected)).status, 400);
  const fixed = await api.send('PUT', `/api/admin/questions/${qid}`, A.cookie, corrected);
  assert.equal(fixed.status, 200, fixed.body.error);
  const row = srv.db.prepare('SELECT options FROM questions WHERE id = ?').get(qid) as { options: string };
  assert.deepEqual(JSON.parse(row.options), corrected.options);
  assert.deepEqual(
    { ...srv.db.prepare('SELECT answered, correct FROM question_stats WHERE question_id = ?').get(qid) },
    { answered: 40, correct: 30 },
    'its numbers stay',
  );
  assert.deepEqual(
    (await api.get('/api/submissions/mine', B.cookie)).body.submissions[0].options,
    corrected.options,
    "the author's list shows it as it's played now",
  );
  const logged = srv.db
    .prepare("SELECT reason FROM moderation_log WHERE action = 'edit_question' AND target = ?")
    .get(qid) as { reason: string };
  assert.match(logged.reason, /^Беше: „Тестов общностен въпрос за реките \(редактиран\)\?“/);

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

  // An approval taken back from the log: the question leaves play.
  const approval = (await api.get('/api/admin/log', A.cookie)).body.entries.find(
    (e: { action: string; target: string }) => e.action === 'approve' && e.target === questionId,
  );
  assert.ok(approval.canUndo);
  const undone = await api.send('POST', `/api/admin/log/${approval.id}/undo`, A.cookie, {
    reason: 'Одобрен по погрешка.',
  });
  assert.equal(undone.status, 200, undone.body.error);
  const stillHidden = (await api.get('/api/admin/question-reports', A.cookie)).body.hidden;
  assert.ok(stillHidden.some((q: { id: string }) => q.id === questionId));
  await api.send('POST', `/api/admin/hidden-questions/${questionId}/unhide`, A.cookie);
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
  // As when a new season begins: the season these accounts were last settled for is over.
  srv.db.prepare('UPDATE users SET settled = NULL WHERE id IN (?, ?)').run(A.user.id, B.user.id);
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

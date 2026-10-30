// End-to-end, matches: a real server, real sockets, two players (A is the first account, so admin) and bots — Соло,
// „Поправителен“, Дуел, Роял, rooms and classes, own sets, leaving and coming back. The tests run in order and share
// state, like a play session; the other e2e-*.test.ts files run beside this one, each on a server of its own.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { RATED_AFTER, type RoomState, SCORING } from '@quiz/shared';
import {
  type Account,
  app,
  autoPlay,
  type Client,
  cli,
  connect,
  connected,
  emitAck,
  eventually,
  guest,
  http,
  jpeg,
  newLog,
  next,
  nextWhere,
  register,
  sleep,
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

test(
  'Соло at its own pace: 30 s gives time, not points; without a clock only base points; a pause on any answer',
  T,
  async () => {
    const P = await register(srv.url, 'bavno_igrae');
    const s = connect(srv.url, P.cookie);
    await connected(s);
    try {
      // 30 s: twice the clock, the speed bonus still against the usual one.
      const relaxed = newLog();
      const playRelaxed = autoPlay(s, 'right', relaxed);
      await emitAck(s, 'solo:start', { category: 'music', pace: 'relaxed' });
      const r = await playRelaxed;
      assert.equal(r.start!.pace, 'relaxed');
      const first = relaxed.questions[0];
      assert.equal(first.durationMs, first.speedMs! * 2);

      // No clock: no speed bonus — a first right answer is the base alone, a second adds the streak step.
      const holds = () =>
        (
          srv.db.prepare("SELECT COALESCE(SUM(value), 0) AS n FROM daily_stats WHERE metric = 'fact_holds'").get() as {
            n: number;
          }
        ).n;
      const holdsBefore = holds();
      // What the 30 s run measured: its answers (all quick here) count for skill.
      const skill = () =>
        (
          srv.db
            .prepare('SELECT COALESCE(SUM(answers), 0) AS n FROM player_skill WHERE user_id = ?')
            .get(P.user.id) as {
            n: number;
          }
        ).n;
      const skillBefore = skill();
      assert.ok(skillBefore > 0, 'the 30 s run was measured');

      // No clock: each answer waits for „Продължи“ (here: nothing comes until the player goes on).
      const untimed = newLog();
      let waited = false;
      s.on('game:reveal', async (rv) => {
        if (!waited) {
          waited = true;
          const soon = next(s, 'game:question', 600);
          await assert.rejects(soon, 'the next question waits');
          assert.equal((await emitAck(s, 'game:hold', { index: rv.index })).ok, false, 'held already');
        }
        s.emit('game:resume');
      });
      const playUntimed = autoPlay(s, 'right', untimed);
      await emitAck(s, 'solo:start', { category: 'music', pace: 'untimed' });
      const u = await playUntimed;
      s.off('game:reveal');
      assert.equal(u.start!.pace, 'untimed');
      assert.equal(untimed.questions[0].speedMs, null);
      const choice = untimed.reveals.filter((rv) => {
        const q = untimed.questions.find((x) => x.index === rv.index)!;
        return q.kind === 'choice';
      });
      const mine = (rv: (typeof choice)[number]) => rv.results[u.start!.youId];
      assert.equal(mine(choice[0]).points, SCORING.base + (mine(choice[0]).streak - 1) * SCORING.streakStep);
      assert.ok(waited);
      assert.equal(holds(), holdsBefore, 'a wait is not a fact stopped on');
      // Practice: right answers pay half, and nothing is measured (skill, mastery, quests, feats).
      const right = u.end.rewards!.breakdown.find((l) => l.label.startsWith('Верни отговори'));
      assert.match(right!.label, /без часовник/);
      assert.equal(skill(), skillBefore, 'nothing measured without a clock');
    } finally {
      s.close();
    }
  },
);

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

test(
  '„Само водя“ opens a room to every seat (a class), unless its size was chosen or knockouts keep it small',
  T,
  async () => {
    const host = connect(srv.url, A.cookie);
    await connected(host);
    const states: RoomState[] = [];
    const onState = (st: RoomState | null) => st && states.push(st);
    host.on('room:state', onState);
    const seats = async () => {
      await eventually(() => assert.ok(states.length));
      return states.at(-1)!.settings.maxPlayers;
    };
    try {
      assert.ok((await emitAck(host, 'room:create', { hostPlays: false })).ok);
      assert.equal(await seats(), 40, 'made for a big screen');
      states.length = 0;
      assert.ok((await emitAck(host, 'room:create', {})).ok);
      assert.equal(await seats(), 8, 'a room to play in');
      states.length = 0;
      host.emit('room:settings', { hostPlays: false });
      await eventually(async () => assert.equal(await seats(), 40, 'switched to „Само водя“'));
      states.length = 0;
      assert.ok((await emitAck(host, 'room:create', { maxPlayers: 12 })).ok);
      host.emit('room:settings', { hostPlays: false });
      await eventually(async () => assert.equal(states.at(-1)?.settings.hostPlays, false));
      assert.equal(await seats(), 12, 'its size was chosen');
      states.length = 0;
      assert.ok((await emitAck(host, 'room:create', { elimination: true, hostPlays: false })).ok);
      assert.equal(await seats(), 8, 'knockouts are for a handful');
      host.emit('room:leave');
    } finally {
      host.off('room:state', onState);
      host.close();
    }
  },
);

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

test(
  'a locked room: newcomers knock and the host lets each in or not; a kicked guest needs the host to come back',
  T,
  async () => {
    // Pupils come from the room's link: guests kept only for the room.
    const pupil = async () => {
      const made = await api.send('POST', '/api/auth/guest', '', { room: true });
      assert.equal(made.body.user.roomGuest, true);
      return { cookie: made.cookie!, socket: connect(srv.url, made.cookie!) };
    };
    const [p1, p2, p3, p4, p5, p6] = await Promise.all(Array.from({ length: 6 }, pupil));
    const pupils = [p1, p2, p3, p4, p5, p6].map((p) => p.socket);
    await connected(...pupils);
    assert.equal((await guest(srv.url)).user.roomGuest, false, 'a guest from anywhere else is an ordinary one');
    const C = await register(srv.url, 'blokirasht_test');
    const sc = connect(srv.url, C.cookie);
    await connected(sc);
    let hostState: RoomState | null = null;
    let pupilState: RoomState | null = null;
    const onHost = (st: RoomState | null) => {
      hostState = st;
    };
    const onPupil = (st: RoomState | null) => {
      pupilState = st;
    };
    const host = () => hostState as unknown as RoomState;
    const names = () => host().players.map((p) => p.name);
    try {
      sa.on('room:state', onHost);
      p1.socket.on('room:state', onPupil);
      const { code } = (await emitAck(sa, 'room:create', { hostPlays: false })) as { code: string };
      assert.ok((await emitAck(p1.socket, 'room:join', { code, nickname: 'Ана' })).ok);
      sa.emit('room:lock', true);
      await eventually(() => assert.equal(host().locked, true));

      // At the door: the host sees who, the others don't.
      const knock = await emitAck(p2.socket, 'room:join', { code, nickname: 'Боби' });
      assert.deepEqual(knock, { ok: true, code, waiting: true });
      await eventually(() =>
        assert.deepEqual(
          host().knocking.map(({ name, isGuest }) => ({ name, isGuest })),
          [{ name: 'Боби', isGuest: true }],
        ),
      );
      await eventually(() => assert.equal((pupilState as RoomState | null)?.knocking.length, 0));
      assert.equal(names().includes('Боби'), false);
      const inside = next(p2.socket, 'room:state');
      assert.ok((await emitAck(sa, 'room:admit', { playerId: host().knocking[0].id, admit: true })).ok);
      assert.ok(
        (await inside)?.players.some((p) => p.name === 'Боби'),
        'let in, they get the room',
      );

      // Not let in: told so, and they can't knock again.
      assert.ok((await emitAck(p3.socket, 'room:join', { code, nickname: 'Цвети' })).ok);
      await eventually(() => assert.equal(host().knocking.length, 1));
      const refused = next(p3.socket, 'room:refused');
      assert.ok((await emitAck(sa, 'room:admit', { playerId: host().knocking[0].id, admit: false })).ok);
      assert.equal((await refused).message, 'Домакинът не те пусна в стаята.');
      assert.match(
        ((await emitAck(p3.socket, 'room:join', { code, nickname: 'Цвети' })) as { error: string }).error,
        /премахна/,
      );

      // Two at the door under one name: the second one in gets a number.
      await emitAck(p4.socket, 'room:join', { code, nickname: 'Деси' });
      await emitAck(p5.socket, 'room:join', { code, nickname: 'деси' });
      await eventually(() => assert.equal(host().knocking.length, 2));
      const [first, second] = host().knocking;
      assert.ok((await emitAck(sa, 'room:admit', { playerId: first.id, admit: true })).ok);
      assert.ok((await emitAck(sa, 'room:admit', { playerId: second.id, admit: true })).ok);
      await eventually(() => assert.deepEqual(names().slice(1), ['Ана', 'Боби', 'Деси', 'деси 2']));

      // The host swaps a typed name for a plain one.
      const told = next(p2.socket, 'notice');
      const bobi = host().players.find((p) => p.name === 'Боби')!;
      sa.emit('room:rename', bobi.id);
      assert.match((await told).message, /„Играч 1“/);
      await eventually(() => assert.ok(names().includes('Играч 1')));

      // A kicked guest can't walk back in; a new guest knocks, and opening the room lets whoever knocked in.
      const ana = host().players.find((p) => p.name === 'Ана')!;
      sa.emit('room:kick', ana.id);
      await eventually(() => assert.equal(names().includes('Ана'), false));
      assert.equal((await emitAck(p1.socket, 'room:join', { code, nickname: 'Ана' })).ok, false);
      assert.deepEqual(await emitAck(p6.socket, 'room:join', { code, nickname: 'Ана' }), {
        ok: true,
        code,
        waiting: true,
      });
      sa.emit('room:lock', false);
      await eventually(() => assert.ok(names().includes('Ана')));
      assert.deepEqual([host().locked, host().knocking], [false, []]);

      // Someone who blocked the host (or was blocked) doesn't get in.
      assert.equal((await api.send('POST', `/api/blocks/${A.user.id}`, C.cookie)).status, 200);
      assert.match(((await emitAck(sc, 'room:join', code)) as { error: string }).error, /Не можеш да влезеш/);
    } finally {
      sa.off('room:state', onHost);
      sa.emit('room:leave');
      for (const s of [...pupils, sc]) s.close();
    }
  },
);

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
  // A picture as Safari's canvas writes it (EXIF and APP13 in the JPEG): kept without them, and served only by the
  // signed address the server gives, never to another site.
  const uploaded = await fetch(`${srv.url}/api/sets/images`, {
    method: 'POST',
    headers: { cookie: A.cookie, 'content-type': 'image/jpeg' },
    body: jpeg(320, 240, [app(0xe1, 'Exif GPS'), app(0xed, 'Photoshop')]),
  });
  assert.equal(uploaded.status, 200);
  const picture = (await uploaded.json()) as { id: string; url: string };
  const shown = await fetch(`${srv.url}${picture.url}`);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.deepEqual(Buffer.from(await shown.arrayBuffer()), jpeg(320, 240));
  assert.equal(
    (await fetch(`${srv.url}/api/sets/images/${picture.id}`)).status,
    404,
    'the bare address serves nothing',
  );

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
  // A notice of illegal content about the set: a case of its own, first in the queue, with a receipt for its sender.
  assert.equal(
    (await api.send('POST', `/api/sets/shared/${mine.code}/report`, B.cookie, { reason: 'name', details: 'x' })).status,
    400,
    "a set's reasons are a set's",
  );
  assert.equal(
    (await api.send('POST', `/api/sets/shared/${mine.code}/report`, B.cookie, { reason: 'illegal', details: 'обидно' }))
      .status,
    200,
  );
  assert.match(
    (await api.get('/api/notifications', B.cookie)).body.notifications[0].text,
    /Получихме сигнала ти за незаконно съдържание в „Урок по история“/,
  );
  const [setCase] = (await api.get('/api/admin/reports', A.cookie)).body.cases;
  assert.deepEqual(
    [setCase.kind, setCase.id, setCase.name, setCase.size, setCase.reports[0].reason],
    ['set', mine.code, 'Урок по история', 3, 'illegal'],
  );
  // The moderator reads all of it, and decides on the reports seen (one decided meanwhile is a conflict).
  const hideSet = { action: 'hide_set', basis: 'content', reason: 'Съдържа обиди към ученици.', copies: true };
  assert.equal((await api.get(`/api/admin/sets/${mine.code}`, B.cookie)).status, 403);
  assert.equal((await api.get(`/api/admin/sets/${mine.code}`, A.cookie)).body.set.questions.length, 3);
  // Nobody decides about what's their own, and what staff made is an owner's to decide: here, a second owner.
  const N = await register(srv.url, 'nadzor_test');
  assert.equal(cli(srv.dbPath, 'admin', 'owner', 'nadzor_test').status, 0);
  await withSecondFactor(srv.url, N.cookie);
  const decide = (reportIds: number[], decision: object, cookie = N.cookie) =>
    api.send('POST', `/api/admin/cases/set/${mine.code}/resolve`, cookie, { reportIds, decision });
  assert.match((await decide([setCase.reports[0].id], hideSet, A.cookie)).body.error, /себе си/);
  assert.equal((await decide([setCase.reports[0].id + 1000], hideSet)).status, 409);
  assert.equal((await decide([setCase.reports[0].id], { action: 'hide_set', reason: 'без основание' })).status, 400);
  assert.equal((await decide([setCase.reports[0].id], hideSet)).status, 200);
  assert.match(
    (await api.get('/api/notifications', A.cookie)).body.notifications[0].text,
    /Модератор скри набора ти „Урок по история“.*Основание: Неподходящо или незаконно съдържание.*Съдържа обиди/,
  );
  // B's copy goes with it, and B hears why.
  assert.equal((await api.get(`/api/sets/${copy.body.id}`, B.cookie)).body.hidden, true);
  const toB = (await api.get('/api/notifications', B.cookie)).body.notifications.map((n: { text: string }) => n.text);
  assert.ok(toB.some((t: string) => /копие на набор, скрит заради съдържанието му.*Съдържа обиди/.test(t)));
  assert.ok(toB.some((t: string) => /Разгледахме доклада ти за „Урок по история“: наборът е скрит/.test(t)));
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

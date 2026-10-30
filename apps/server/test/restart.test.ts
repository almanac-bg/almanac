// Deploys restart the server: running matches must play out first, and nobody may start a new one meanwhile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  autoPlay,
  connect,
  connected,
  emitAck,
  http,
  next,
  register,
  sleep,
  startServer,
  type TestServer,
} from './helpers';

const T = { timeout: 60_000 };
/** Sofia wall-clock time `seconds` from now, as EVENING_AT takes it. */
const sofiaIn = (seconds: number) =>
  new Date(Date.now() + seconds * 1000).toLocaleTimeString('en-GB', { timeZone: 'Europe/Sofia', hour12: false });

test('a restart lets the running match finish, refuses new ones, then exits', T, async () => {
  const srv = await startServer({ DRAIN_SECONDS: '60' });
  try {
    const A = await register(srv.url, 'igrae_v_momenta');
    const B = await register(srv.url, 'chaka_na_opashka');
    const sa = connect(srv.url, A.cookie);
    const sb = connect(srv.url, B.cookie);
    await connected(sa, sb);

    const play = autoPlay(sa, 'right');
    const firstQuestion = next(sa, 'game:question');
    assert.ok((await emitAck(sa, 'solo:start', { category: 'mixed' })).ok);
    await firstQuestion;

    const told = next(sb, 'server:draining');
    const exited = srv.kill('SIGTERM');
    assert.match((await told).message, /Обновяваме/, 'everyone hears about the restart');
    const refused = await emitAck(sb, 'queue:join', 'duel');
    assert.equal(refused.ok, false);
    assert.match(refused.error, /Обновяваме/, 'no new matches while draining');

    const { end } = await play;
    assert.equal(end.standings[0].correct, 10, 'the running match plays out to the end');
    assert.equal(await exited, 0, 'then the server stops on its own');
    sa.close();
    sb.close();
  } finally {
    await srv.stop();
  }
});

test('a restart while a run alone is stopped on a fact: the run goes on, and no new stop holds it up', T, async () => {
  const srv = await startServer({ DRAIN_SECONDS: '60' });
  try {
    const A = await register(srv.url, 'spira_da_chete');
    const sa = connect(srv.url, A.cookie);
    await connected(sa);
    let exited: Promise<number | null> | null = null;
    const holds: { ok: boolean }[] = [];
    sa.on('game:reveal', async (r) => {
      holds.push(await emitAck(sa, 'game:hold', { index: r.index }));
      // Stopped on the first one and never going on: the restart comes now.
      exited ??= srv.kill('SIGTERM');
    });
    const play = autoPlay(sa, 'right');
    assert.ok((await emitAck(sa, 'solo:start', { category: 'mixed' })).ok);
    const { end } = await play;
    assert.equal(end.standings[0].correct, 10, 'the run went on past the stop and played out');
    assert.deepEqual(holds[0], { ok: true });
    assert.ok(
      holds.slice(1).every((h) => !h.ok),
      'while the server drains, a stop isn’t granted (stop after stop would keep it waiting)',
    );
    assert.equal(await exited, 0, 'then the server stops on its own');
    sa.close();
  } finally {
    await srv.stop();
  }
});

test(
  'a question bank that can’t be read stops the start, saying why (the deploy then goes back by itself)',
  T,
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-bad-bank-'));
    try {
      const file = path.join(dir, 'questions.json');
      fs.writeFileSync(file, '[{ "id": "half a pull');
      await assert.rejects(startServer({ QUESTIONS_PATH: file }), /exited early[\s\S]*JSON/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'a restart keeps the lobbies: a room with its players, and the evening’s, which starts late if it has to',
  T,
  async () => {
    // The evening begins while the server restarts.
    const at = sofiaIn(20);
    const first = await startServer({ EVENING_AT: at });
    let second: TestServer | undefined;
    try {
      const host = await register(first.url, 'domakin_na_staia');
      const pupil = await register(first.url, 'uchenik_v_staia');
      const fan = await register(first.url, 'chaka_vecherta');
      const [sh, sp, sf] = [host, pupil, fan].map((a) => connect(first.url, a.cookie));
      await connected(sh, sp, sf);
      const made = await emitAck(sh, 'room:create', { questions: 5 });
      assert.ok(made.ok);
      assert.ok((await emitAck(sp, 'room:join', made.code)).ok);
      assert.deepEqual(await emitAck(sf, 'evening:join'), { ok: true });

      // What a deploy asks first: the evening is near, so it isn't a quiet moment.
      const live = (await http(first.url).get('/api/live')).body;
      assert.deepEqual(live.rooms, { open: 1, playing: 0, people: 2 });
      assert.equal(live.evening.waiting, 1);
      assert.match(live.busy.join('\n'), /the evening Роял: its lobby opens at/);
      const proxied = await fetch(`${first.url}/api/live`, { headers: { 'x-forwarded-for': '203.0.113.9' } });
      assert.equal(proxied.status, 404, 'only on the machine itself, never through the proxy');

      const told = next(sf, 'notice');
      assert.equal(await first.kill('SIGTERM'), 0);
      assert.match((await told).message, /Мястото ти във Вечерния Роял се пази/);
      for (const s of [sh, sp, sf]) s.close();

      await sleep(Math.max(0, live.evening.startsAt - Date.now() + 500));
      second = await startServer({ DB_PATH: first.dbPath, EVENING_AT: at });
      const [h2, p2, f2] = [host, pupil, fan].map((a) => connect(second!.url, a.cookie));
      const rooms = Promise.all([next(h2, 'room:state'), next(p2, 'room:state')]);
      const evening = autoPlay(f2, 'right');
      await connected(h2, p2, f2);
      for (const room of await rooms) {
        assert.ok(room, 'back in the room');
        assert.equal(room.code, made.code, 'the same room, by the same code');
        assert.deepEqual(
          room.players.map((p) => p.name),
          ['domakin_na_staia', 'uchenik_v_staia'],
        );
        assert.equal(room.hostId, `u${host.user.id}`);
        assert.equal(room.settings.questions, 5);
      }
      const { start } = await evening;
      assert.equal(start!.mode, 'evening', 'the evening began a moment late, with whoever was in its lobby');
      for (const s of [h2, p2, f2]) s.close();
    } finally {
      await second?.stop();
      await first.stop();
    }
  },
);

test('an upkeep that hasn’t run for an hour turns the health check red', T, async () => {
  const srv = await startServer();
  try {
    assert.equal((await fetch(`${srv.url}/api/health`)).status, 200);
    srv.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES ('alive_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(String(Date.now() - 61 * 60_000));
    const res = await fetch(`${srv.url}/api/health`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, problem: 'upkeep' });
  } finally {
    await srv.stop();
  }
});

test('an idle server stops right away', T, async () => {
  const srv = await startServer({ DRAIN_SECONDS: '60' });
  try {
    const started = Date.now();
    assert.equal(await srv.kill('SIGTERM'), 0);
    // Far under the 60 s it would give running matches, with room for a slow machine.
    assert.ok(Date.now() - started < 20_000, `took ${Date.now() - started} ms`);
  } finally {
    await srv.stop();
  }
});

test('a daily attempt cut short by a crash can be played again', T, async () => {
  const first = await startServer();
  let second: TestServer | undefined;
  try {
    const A = await register(first.url, 'prekasnat_dneven');
    const sa = connect(first.url, A.cookie);
    await connected(sa);
    const question = next(sa, 'game:question');
    assert.ok((await emitAck(sa, 'daily:start')).ok);
    await question;
    await first.kill('SIGKILL');
    sa.close();

    second = await startServer({ DB_PATH: first.dbPath });
    const again = connect(second.url, A.cookie);
    await connected(again);
    const retried = next(again, 'game:question');
    assert.ok((await emitAck(again, 'daily:start')).ok, 'the attempt died with the old process, so it is not lost');
    // Walked out once the first question is on screen (before it, nothing was played: the attempt would come back).
    await retried;
    again.emit('game:leave');
    await sleep(200);
    assert.equal((await emitAck(again, 'daily:start')).ok, false, 'walking out of the retry still uses it up');
    again.close();
  } finally {
    await second?.stop();
    await first.stop();
  }
});

test(
  'a daily cut short by a crash after an answer was revealed keeps the score so far, and is no replay',
  T,
  async () => {
    const first = await startServer();
    let second: TestServer | undefined;
    try {
      const A = await register(first.url, 'videl_otgovora');
      const sa = connect(first.url, A.cookie);
      await connected(sa);
      const question = next(sa, 'game:question');
      assert.ok((await emitAck(sa, 'daily:start')).ok);
      const q = await question;
      const revealed = next(sa, 'game:reveal');
      sa.emit('game:answer', { index: q.index, choice: 0 });
      await revealed;
      await first.kill('SIGKILL');
      sa.close();

      second = await startServer({ DB_PATH: first.dbPath });
      const again = connect(second.url, A.cookie);
      await connected(again);
      const refused = await emitAck(again, 'daily:start');
      assert.equal(refused.ok, false, 'the answer was seen: the same ten questions must not come again');
      assert.match(refused.error, /прекъсна при нас след 1 въпрос/);
      const saved = first.db
        .prepare(
          'SELECT finished_at, revealed FROM daily_results d JOIN users u ON u.id = d.user_id WHERE u.username = ?',
        )
        .get('videl_otgovora') as { finished_at: number | null; revealed: number };
      assert.ok(saved.finished_at, 'the run stands, with the score at its last reveal');
      assert.equal(saved.revealed, 1);
      again.close();
    } finally {
      await second?.stop();
      await first.stop();
    }
  },
);

// Deploys restart the server: running matches must play out first, and nobody may start a new one meanwhile.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoPlay, connect, connected, emitAck, next, register, startServer } from './helpers';

const T = { timeout: 60_000 };

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

    const told = next<{ message: string }>(sb, 'server:draining');
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

test('an idle server stops right away', T, async () => {
  const srv = await startServer({ DRAIN_SECONDS: '60' });
  try {
    const started = Date.now();
    assert.equal(await srv.kill('SIGTERM'), 0);
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
  } finally {
    await srv.stop();
  }
});

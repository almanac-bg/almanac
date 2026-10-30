// The evening Роял on a server of its own, set to start a few seconds after it does: its lobby, the match at the set
// time with bots making up eight, its places kept for the night's top, and the champion's title.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { EveningInfo, MeUser } from '@quiz/shared';
import {
  autoPlay,
  type Client,
  connect,
  connected,
  emitAck,
  http,
  register,
  startServer,
  type TestServer,
} from './helpers';

let srv: TestServer;
let socket: Client;
/** Sofia wall-clock time `seconds` from now, as EVENING_AT takes it. */
const sofiaIn = (seconds: number) =>
  new Date(Date.now() + seconds * 1000).toLocaleTimeString('en-GB', { timeZone: 'Europe/Sofia', hour12: false });

before(async () => {
  srv = await startServer({ EVENING_AT: sofiaIn(5) });
});

after(async () => {
  socket?.close();
  await srv?.stop();
});

test('the evening Роял: in from its lobby, on at the set time with bots making up eight; its top and its champion', async () => {
  const player = await register(srv.url, 'vecherniak');
  const api = http(srv.url);
  socket = connect(srv.url, player.cookie);
  await connected(socket);

  assert.deepEqual(await emitAck(socket, 'evening:join'), { ok: true });
  const waiting: EveningInfo = (await api.get('/api/evening', player.cookie)).body;
  assert.deepEqual([waiting.status!.waiting, waiting.status!.joined], [1, true]);

  const { start, end } = await autoPlay(socket, 'right');
  assert.equal(start!.mode, 'evening');
  assert.equal(start!.players.length, 8, 'one person and seven bots');
  assert.deepEqual(start!.eliminationSchedule, [4, 7, 10, 12, 13]);
  assert.equal(start!.totalQuestions, 15);
  assert.equal(end.rewards!.rating, null, 'unrated');

  // Over for tonight: the lobby is shut. The place is kept, with how many people (not bots) the match had.
  const later = await emitAck(socket, 'evening:join');
  assert.equal(later.ok, false);
  const kept = srv.db
    .prepare('SELECT placement, players, people FROM evening_results WHERE user_id = ?')
    .get(player.user.id) as { placement: number; players: number; people: number };
  assert.deepEqual(
    { ...kept },
    { placement: end.standings.find((s) => s.id === `u${player.user.id}`)!.placement, players: 8, people: 1 },
  );
  const night: EveningInfo = (await api.get('/api/evening', player.cookie)).body;
  assert.ok(night.status!.startsAt > Date.now(), 'the next one is tomorrow');

  // One person among bots: no night's top, and no champion, whoever came first.
  assert.equal(night.lastNight, null);
  const me: MeUser = (await api.get('/api/me', player.cookie)).body.user;
  assert.equal(me.eveningChampion, false);
  const equip = await api.send('PATCH', '/api/me/loadout', player.cookie, { title: 'evening_champion' });
  assert.equal(equip.status, 400);
});

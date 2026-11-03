// Reaching players (6c): a note when a friend request is accepted, blocking (guests too, and in matchmaking), the opt-in „X те изпревари на линка ти“
// email (once a day), and web push (a known push service only, a hello, a duel's turn, one of each kind a day).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import webpush from 'web-push';
import {
  autoPlay,
  connect,
  connected,
  emitAck,
  eventually,
  guest,
  http,
  register,
  startServer,
  type TestServer,
} from './helpers';

let srv: TestServer;
let api: ReturnType<typeof http>;
const pushDir = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-push-'));
const T = { timeout: 90_000 };
const keys = webpush.generateVAPIDKeys();

before(async () => {
  srv = await startServer({
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    PUSH_OUTBOX: pushDir,
    PUSH_QUIET: 'off',
  });
  api = http(srv.url);
});

after(async () => {
  await srv?.stop();
  fs.rmSync(pushDir, { recursive: true, force: true });
});

const pushes = () =>
  fs
    .readdirSync(pushDir)
    .sort()
    .map(
      (f) =>
        JSON.parse(fs.readFileSync(path.join(pushDir, f), 'utf8')) as {
          userId: number;
          kind: string;
          title: string;
          url: string;
        },
    );

async function befriend(a: { cookie: string; user: { id: number; username: string } }, b: typeof a) {
  assert.equal((await api.send('POST', '/api/friends', a.cookie, { username: b.user.username })).status, 200);
  assert.equal((await api.send('POST', `/api/friends/${a.user.id}/accept`, b.cookie)).status, 200);
}

test(
  'an accepted request tells whoever asked; a block ends the friendship and stops requests both ways',
  T,
  async () => {
    const A = await register(srv.url, 'pitashtiyat');
    const B = await register(srv.url, 'priemashtiyat');
    await befriend(A, B);
    const [note] = (await api.get('/api/notifications', A.cookie)).body.notifications;
    assert.match(note.text, /priemashtiyat прие поканата ти — вече сте приятели/);

    const blocked = await api.send('POST', `/api/blocks/${A.user.id}`, B.cookie);
    assert.deepEqual(
      blocked.body.players.map((p: { username: string }) => p.username),
      ['pitashtiyat'],
    );
    assert.equal((await api.get('/api/friends', A.cookie)).body.friends.length, 0, 'no longer friends');
    for (const [from, to] of [
      [A, B],
      [B, A],
    ] as const) {
      const asked = await api.send('POST', '/api/friends', from.cookie, { username: to.user.username });
      assert.equal(asked.status, 400);
      assert.equal(asked.body.error, 'Не можеш да добавиш този играч.', 'the same answer, whoever blocked');
    }
    assert.equal((await api.get(`/api/profile/${A.user.username}`, B.cookie)).body.blocked, true);
    assert.equal(
      (await api.get(`/api/profile/${B.user.username}`, A.cookie)).body.blocked,
      false,
      'only the blocker sees it',
    );

    assert.deepEqual((await api.send('DELETE', `/api/blocks/${A.user.id}`, B.cookie)).body.players, []);
    assert.equal((await api.send('POST', '/api/friends', A.cookie, { username: B.user.username })).status, 200);
  },
);

// The stores ask it of every player, and a guest meets names, groups and sets like anyone (the 31 October review, 8n.4).
test('a guest reports and blocks like anyone, and keeps the blocks when the account is saved', T, async () => {
  const X = await register(srv.url, 'nahalnikat');
  const G = await guest(srv.url);
  const reported = await api.send('POST', '/api/reports', G.cookie, { username: X.user.username, reason: 'name' });
  assert.equal(reported.status, 200, JSON.stringify(reported.body));
  const flagged = await api.send('POST', '/api/questions/history-0/report', G.cookie, { reason: 'wrong' });
  assert.equal(flagged.status, 200, JSON.stringify(flagged.body));
  const blocked = await api.send('POST', `/api/blocks/${X.user.id}`, G.cookie);
  assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
  assert.deepEqual(
    (await api.get('/api/blocks', G.cookie)).body.players.map((p: { username: string }) => p.username),
    ['nahalnikat'],
  );
  // A guest's word weighs like a new account's: it's there for the moderators, and counts toward no automatic hiding.
  assert.ok(srv.db.prepare('SELECT 1 FROM reports WHERE reporter_id = ? AND target_id = ?').get(G.user.id, X.user.id));

  const saved = await api.send('POST', '/api/account/claim', G.cookie, {
    username: 'zapazeniyat',
    password: 'secret123',
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const cookie = saved.cookie ?? G.cookie;
  assert.deepEqual(
    (await api.get('/api/blocks', cookie)).body.players.map((p: { username: string }) => p.username),
    ['nahalnikat'],
    'the same account, blocks and all',
  );
  assert.equal(
    (await api.send('POST', '/api/friends', X.cookie, { username: 'zapazeniyat' })).status,
    400,
    'and they still keep X away',
  );
});

test("a guest's flag on a question outlives the guest, without a name or words", T, async () => {
  const G = await guest(srv.url);
  const flagged = await api.send('POST', '/api/questions/history-1/report', G.cookie, {
    reason: 'wrong',
    details: 'Годината е друга.',
  });
  assert.equal(flagged.status, 200, JSON.stringify(flagged.body));
  assert.equal((await api.send('POST', '/api/account/delete', G.cookie, {})).status, 200);
  assert.deepEqual(
    {
      ...(srv.db
        .prepare("SELECT user_id, reason, details, status FROM question_reports WHERE question_id = 'history-1'")
        .get() as object),
    },
    { user_id: null, reason: 'wrong', details: '', status: 'open' },
  );
});

test('a network of guests shares one cap on reports: a guest costs nothing to make', T, async () => {
  const X = await register(srv.url, 'mnogo_dokladvan');
  let refused = 0;
  for (let i = 0; i < 32 && !refused; i++) {
    const G = await guest(srv.url);
    const r = await api.send('POST', '/api/reports', G.cookie, { username: X.user.username, reason: 'name' });
    if (r.status === 429) refused = i;
  }
  // The earlier tests' guests reported from this network too.
  assert.ok(refused > 20 && refused <= 30, `refused after ${refused}`);
  const A = await register(srv.url, 'istinski_profil');
  const own = await api.send('POST', '/api/reports', A.cookie, { username: X.user.username, reason: 'name' });
  assert.equal(own.status, 200, 'a saved account has its own caps');
});

test('blocked players never meet in a ranked match, nor through a recording of the other', T, async () => {
  const A = await register(srv.url, 'blokiraniyat');
  const B = await register(srv.url, 'blokirashtiyat');
  assert.equal((await api.send('POST', `/api/blocks/${A.user.id}`, B.cookie)).status, 200);
  const sa = connect(srv.url, A.cookie);
  const sb = connect(srv.url, B.cookie);
  await connected(sa, sb);
  try {
    // Both in the Дуел queue together: each gets a bot after the wait, not the other.
    const playA = autoPlay(sa, 'right');
    const playB = autoPlay(sb, 'right');
    assert.ok((await emitAck(sa, 'queue:join', 'duel')).ok);
    assert.ok((await emitAck(sb, 'queue:join', 'duel')).ok);
    const [a, b] = await Promise.all([playA, playB]);
    assert.ok(!a.start!.players.some((p) => p.userId === B.user.id), "B isn't in A's match");
    assert.ok(!b.start!.players.some((p) => p.userId === A.user.id), "A isn't in B's match");

    // A's Дуел is now a recording. For a player it fits (past the newcomer's bots, about as strong, its questions
    // unseen) it's the opponent; for one who blocked A, or whom A blocked, it never is.
    assert.ok(srv.db.prepare("SELECT 1 FROM runs WHERE user_id = ? AND mode = 'duel'").get(A.user.id), "A's run");
    srv.db.prepare('DELETE FROM runs WHERE user_id <> ?').run(A.user.id);
    // A's strength as one that's settled (one match doesn't settle it), so a player can be matched to it.
    srv.db.prepare("UPDATE player_skill SET answers = 100 WHERE user_id = ? AND category = 'all'").run(A.user.id);
    const { rating } = srv.db
      .prepare("SELECT rating FROM player_skill WHERE user_id = ? AND category = 'all'")
      .get(A.user.id) as { rating: number };
    const opponent = async (blocks: boolean) => {
      const P = await register(srv.url, blocks ? 'i_toy_blokira' : 'ne_blokira');
      srv.db.prepare('UPDATE users SET mp_games = 10 WHERE id = ?').run(P.user.id);
      srv.db
        .prepare("INSERT INTO player_skill (user_id, category, rating, answers) VALUES (?, 'all', ?, 100)")
        .run(P.user.id, rating);
      if (blocks) assert.equal((await api.send('POST', `/api/blocks/${A.user.id}`, P.cookie)).status, 200);
      const sp = connect(srv.url, P.cookie);
      await connected(sp);
      const play = autoPlay(sp, 'right');
      assert.ok((await emitAck(sp, 'queue:join', 'duel')).ok);
      const { start } = await play;
      sp.close();
      return start!.players.find((p) => p.record)?.name ?? null;
    };
    assert.equal(await opponent(false), A.user.username, 'the recording fits');
    assert.notEqual(await opponent(true), A.user.username, 'but not for one who blocked A');
  } finally {
    sa.close();
    sb.close();
  }
});

test('the „изпревари те“ email: opt-in, at most one a day, with a reply address and an unsubscribe', T, async () => {
  const C = await register(srv.url, 'sazdatelyat');
  srv.db.prepare("UPDATE users SET email = 'c@example.test', email_key = 'c@example.test' WHERE id = ?").run(C.user.id);
  const optIn = await api.send('POST', '/api/account/beaten-mails', C.cookie, { on: true });
  assert.equal(optIn.body.user.beatenMails, true);

  const sc = connect(srv.url, C.cookie);
  await connected(sc);
  const cPlays = autoPlay(sc, 'wrong');
  const link = await emitAck(sc, 'challenge:start', {});
  assert.ok(link.ok);
  await cPlays;
  sc.close();

  for (const name of ['parvi_igrach', 'vtori_igrach']) {
    const P = await register(srv.url, name);
    const sp = connect(srv.url, P.cookie);
    await connected(sp);
    const plays = autoPlay(sp, 'right');
    assert.ok((await emitAck(sp, 'challenge:start', { id: link.id })).ok);
    await plays;
    sp.close();
  }
  const mails = () => srv.mails().filter((m) => m.to === 'c@example.test');
  await eventually(() => assert.equal(mails().length, 1));
  const [mail] = mails() as (ReturnType<TestServer['mails']>[number] & {
    replyTo: string;
    headers: Record<string, string>;
  })[];
  assert.match(mail.subject, /parvi_igrach те изпревари на линка ти/);
  assert.equal(mail.headers['Auto-Submitted'], 'auto-generated');
  assert.match(mail.headers['List-Unsubscribe'], /\/api\/reminders\/off\?u=\d+&k=/);
  assert.equal(mail.replyTo, 'privacy@almanac.bg');

  const off = mail.headers['List-Unsubscribe'].slice(1, -1).replace('https://almanac.test', srv.url);
  assert.equal((await fetch(off, { method: 'POST' })).status, 200);
  assert.equal((await api.get('/api/me', C.cookie)).body.user.beatenMails, false, 'the link stops it');
});

test(
  'web push: only a browser push service, a hello on the new device, a duel turn — one of each kind a day',
  T,
  async () => {
    const F = await register(srv.url, 'telefonat');
    const G = await register(srv.url, 'predizvikva');
    const key = (n: number) => randomBytes(n).toString('base64url');
    const device = (endpoint: string) => ({ endpoint, keys: { p256dh: key(65), auth: key(16) } });

    assert.equal((await api.get('/api/push/key')).body.key, keys.publicKey, 'the key a device subscribes with');
    assert.equal(
      (await api.send('POST', '/api/push/subscribe', F.cookie, device('https://evil.example/x'))).status,
      400,
    );
    assert.equal((await api.send('POST', '/api/push/subscribe', F.cookie, device('https://10.0.0.1/x'))).status, 400);
    // Read as a push service by one parser and as another host by the request that goes out (push.ts, pushEndpoint).
    assert.equal(
      (await api.send('POST', '/api/push/subscribe', F.cookie, device('https://127.0.0.1%2epush.apple.com/x'))).status,
      400,
    );
    const phone = device(`https://fcm.googleapis.com/fcm/send/${key(20)}`);
    const on = await api.send('POST', '/api/push/subscribe', F.cookie, phone);
    assert.equal(on.status, 200, on.body.error);
    assert.equal(on.body.user.push.kinds.duels, true, 'the usual choices to start with');
    await eventually(() => assert.ok(pushes().some((p) => p.userId === F.user.id && p.kind === 'hello')));

    assert.equal(
      (await api.send('POST', '/api/push/prefs', F.cookie, { ...on.body.user.push, daily: 601 })).status,
      400,
    );
    const prefs = await api.send('POST', '/api/push/prefs', F.cookie, { ...on.body.user.push, daily: 19 * 60 });
    assert.equal(prefs.body.user.push.daily, 19 * 60);

    await befriend(G, F);
    const sg = connect(srv.url, G.cookie);
    await connected(sg);
    for (let i = 0; i < 2; i++) {
      const plays = autoPlay(sg, 'right');
      assert.ok((await emitAck(sg, 'challenge:start', { rival: F.user.id })).ok);
      await plays;
    }
    sg.close();
    await eventually(() => {
      const turns = pushes().filter((p) => p.userId === F.user.id && p.kind === 'duels');
      assert.equal(turns.length, 1, 'two duels, one push: the in-app notes have the rest');
      assert.match(turns[0].title, /Твой ред: predizvikva те предизвика/);
      assert.match(turns[0].url, /^\/c\//);
    });

    // The device is let go (switched off in Settings, or signed out of): nothing more goes to it.
    const devices = () =>
      (srv.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(F.user.id) as { n: number })
        .n;
    assert.equal((await api.send('POST', '/api/push/unsubscribe', G.cookie, { endpoint: phone.endpoint })).status, 200);
    assert.equal(devices(), 1, "someone else's device isn't theirs to let go");
    assert.equal((await api.send('POST', '/api/push/unsubscribe', F.cookie, { endpoint: phone.endpoint })).status, 200);
    assert.equal(devices(), 0);
  },
);

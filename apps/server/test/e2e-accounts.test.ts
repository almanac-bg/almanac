// End-to-end, accounts and moderation: sign-up and sign-in, mails, passwords, staff and their decisions, data export
// and deletion, flagged questions, the site's files. A real server, real sockets, two players (A is the first
// account, so admin); the tests run in order and share state.
import assert from 'node:assert/strict';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { dayKey, PUBLIC_PAGES, RATED_AFTER, seasonKey, shiftDay } from '@quiz/shared';
import { codeAt, stepAt } from '../src/totp';
import {
  type Account,
  autoPlay,
  type Client,
  cli,
  connect,
  connected,
  cookieFrom,
  emitAck,
  guest,
  http,
  newLog,
  register,
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

test('auth', T, async () => {
  const dup = await api.send('POST', '/api/auth/register', '', {
    username: A.user.username.toUpperCase(),
    password: 'secret123',
  });
  assert.equal(dup.status, 409, 'duplicate username (case-insensitive, Cyrillic) is rejected');
  // One Cyrillic "а" for the Latin "a": a word in two alphabets is refused by itself (names.ts → mixesScripts)…
  const mixed = await api.send('POST', '/api/auth/register', '', {
    username: 'm\u0430ria_test',
    password: 'secret123',
  });
  assert.equal(mixed.status, 400);
  assert.match(mixed.body.error, /смесва латиница и кирилица/);
  // …and a word wholly in Cyrillic capitals that look like Latin ones („КОМА“ for „KOMA“) is a different name to the
  // database, the same one on screen.
  await register(srv.url, 'KOMA_test');
  const twin = await api.send('POST', '/api/auth/register', '', {
    username: '\u041a\u041e\u041c\u0410_test',
    password: 'secret123',
  });
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
    assert.match(short.body.error, /поне 8 знака/);
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
    assert.match(stored.h, /^scrypt\$N=65536,r=8,p=2\$/, 'and is redone at the current cost');
    assert.equal(
      (await api.send('POST', '/api/auth/login', '', { username: 'star_hash', password: 'secret123' })).status,
      200,
    );
    // So is one from the cost before this (p = 1).
    const p1 = `scrypt$N=65536,r=8,p=1$${salt.toString('base64')}$${scryptSync('secret123', salt, 64, { N: 2 ** 16, r: 8, p: 1, maxmem: 256 * 2 ** 20 }).toString('base64')}`;
    srv.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(p1, old.user.id);
    assert.equal(
      (await api.send('POST', '/api/auth/login', '', { username: 'star_hash', password: 'secret123' })).status,
      200,
    );
    assert.match(
      (srv.db.prepare('SELECT password_hash AS h FROM users WHERE id = ?').get(old.user.id) as { h: string }).h,
      /^scrypt\$N=65536,r=8,p=2\$/,
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
  const sixth = await api.send('POST', '/api/auth/register', '', {
    username: 'pismo_6',
    password: 'secret123',
    email: 'someone@example.test',
  });
  assert.equal(sixth.status, 201);
  assert.match(sixth.body.emailNotSent, /Твърде много писма/, 'and the sign-up says the mail didn’t go');
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

test(
  'security.txt says where to report a problem, until a date someone renews on purpose (this fails a month before)',
  T,
  async () => {
    const text = await (await fetch(`${srv.url}/.well-known/security.txt`)).text();
    assert.match(text, /^Contact: mailto:/m);
    const expires = Date.parse(/^Expires: (.+)$/m.exec(text)![1]);
    assert.ok(
      expires > Date.now() + 30 * 24 * 60 * 60_000,
      'renew SECURITY_TXT_EXPIRES (index.ts), after checking the contacts still reach someone',
    );
  },
);

test('an unknown /api address answers JSON, like the rest of the API', T, async () => {
  const res = await fetch(`${srv.url}/api/no-such-route`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /json/);
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
  const queue = (await api.get('/api/admin/reports', A.cookie)).body.cases;
  assert.equal(queue.length, 1);
  assert.deepEqual([queue[0].kind, queue[0].id, queue[0].owner.username], ['player', String(D.user.id), 'troll_test']);
  assert.equal(queue[0].reports.length, 1);
  assert.equal(queue[0].reports[0].reason, 'name');
  assert.equal(queue[0].reports[0].reporter.name, 'maria_test', 'with who sent it');
  assert.deepEqual((await api.get('/api/admin/summary', A.cookie)).body.openReports, 1);

  // A decision answers the reports the moderator saw.
  const open = async () =>
    (await api.get('/api/admin/reports', A.cookie)).body.cases
      .filter((c: { kind: string; id: string }) => c.kind === 'player' && c.id === String(D.user.id))
      .flatMap((c: { reports: { id: number }[] }) => c.reports.map((r) => r.id));
  const resolve = async (decision: object) =>
    api.send('POST', `/api/admin/cases/player/${D.user.id}/resolve`, A.cookie, {
      reportIds: await open(),
      decision,
    });
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
    /Мирен_играч.*Неподходящо име.*Името обижда.*след сигнал от играч.*човек, не автоматично.*до 6 месеца.*извънсъдебно/,
    'the player is told what, on what basis and why, that a person decided, and where to appeal',
  );
  assert.equal((await api.get('/api/me', D.cookie)).body.user.username, 'Мирен_играч');
  assert.equal((await api.get('/api/admin/reports', A.cookie)).body.cases.length, 0, 'reports close when resolved');
  assert.match(
    (await api.get('/api/notifications', B.cookie)).body.notifications[0].text,
    /Разгледахме доклада ти за „troll_test“: името е сменено/,
    'and whoever reported hears what came of it',
  );

  await api.send('POST', '/api/reports', B.cookie, { username: 'Мирен_играч', reason: 'cheating' });
  assert.equal(
    (await resolve({ action: 'ban', days: 7, basis: 'cheating', reason: 'Отговаря с програма.' })).status,
    200,
  );
  assert.equal((await api.get('/api/me', D.cookie)).body.user, null, 'a ban logs the player out');
  const login = await api.send('POST', '/api/auth/login', '', { username: 'Мирен_играч', password: 'secret123' });
  assert.equal(login.status, 403);
  assert.match(
    login.body.error,
    /спрян до .*Нечестна игра.*Отговаря с програма.*човек.*Ако смяташ, че е грешка.*данните си или изтриване/,
  );
  // With nothing reported any more, from the player's card.
  assert.equal(
    (
      await api.send('POST', `/api/admin/players/${D.user.id}/ban`, A.cookie, {
        days: null,
        basis: 'cheating',
        reason: 'Пак отговаря с програма.',
      })
    ).status,
    200,
    'permanent bans',
  );
  assert.match(
    (await api.send('POST', '/api/auth/login', '', { username: 'Мирен_играч', password: 'secret123' })).body.error,
    /за постоянно/,
  );
});

test(
  'staff: an authenticator app before /admin opens, a code each session, the password again for changes; decisions about staff are the owner’s',
  T,
  async () => {
    // A saved guest made a moderator. Saving set the password, so it counts as given then.
    const guestM = await guest(srv.url);
    const claimed = await api.send('POST', '/api/account/claim', guestM.cookie, {
      username: 'pazitel_test',
      password: 'secret123',
    });
    assert.equal(claimed.status, 200);
    const M = { cookie: claimed.cookie!, id: claimed.body.user.id as number };
    const sessionHash = createHash('sha256')
      .update(decodeURIComponent(M.cookie.split('=')[1]))
      .digest('base64url');
    assert.equal(cli(srv.dbPath, 'admin', 'add', 'pazitel_test').status, 0);
    assert.equal((await api.get('/api/me', M.cookie)).body.user.staffRole, 'moderator');

    // Before anything opens, an authenticator app; what waits is counted meanwhile (the home card shows it).
    assert.equal((await api.get('/api/admin/summary', M.cookie)).body.secondFactor, 'setup');
    assert.equal((await api.get('/api/admin/reports', M.cookie)).body.setup2fa, true);
    const setup = await api.send('POST', '/api/auth/2fa/setup', M.cookie);
    assert.equal(setup.status, 200);
    assert.match(setup.body.uri, /^otpauth:\/\/totp\/.*pazitel_test\?secret=/);
    const secret: string = setup.body.secret;
    const now = () => stepAt(Date.now());
    const wrong = String((Number(codeAt(secret, now())) + 1) % 1_000_000).padStart(6, '0');
    assert.equal((await api.send('POST', '/api/auth/2fa/enable', M.cookie, { code: wrong })).status, 400);
    const first = codeAt(secret, now());
    assert.equal((await api.send('POST', '/api/auth/2fa/enable', M.cookie, { code: first })).status, 200);
    assert.equal((await api.get('/api/admin/summary', M.cookie)).body.secondFactor, 'ok');
    assert.equal((await api.get('/api/admin/reports', M.cookie)).status, 200);
    // Twelve hours on, a code again; each one works once.
    srv.db
      .prepare('UPDATE sessions SET second_factor_at = ? WHERE token = ?')
      .run(Date.now() - 13 * 60 * 60_000, sessionHash);
    assert.equal((await api.get('/api/admin/reports', M.cookie)).body.code, true);
    assert.equal((await api.send('POST', '/api/auth/2fa', M.cookie, { code: first })).status, 400, 'once');
    assert.equal((await api.send('POST', '/api/auth/2fa', M.cookie, { code: codeAt(secret, now() + 1) })).status, 200);

    // Changes want the password given within the hour.
    srv.db.prepare('UPDATE sessions SET confirmed_at = ? WHERE token = ?').run(Date.now() - 61 * 60_000, sessionHash);
    const reject = () => api.send('POST', '/api/admin/submissions/999999/reject', M.cookie, { reason: '' });
    const asked = await reject();
    assert.equal(asked.status, 403);
    assert.equal(asked.body.confirm, true, 'a change asks for it');
    assert.equal((await api.send('POST', '/api/auth/confirm', M.cookie, { password: 'wrong-password' })).status, 400);
    assert.equal((await api.send('POST', '/api/auth/confirm', M.cookie, { password: 'secret123' })).status, 200);
    assert.equal((await reject()).status, 400, 'then the change goes through (to "no such question")');
    srv.db.prepare('UPDATE sessions SET confirmed_at = ? WHERE token = ?').run(Date.now() - 61 * 60_000, sessionHash);
    assert.equal((await reject()).status, 403, 'an hour later it asks again');
    assert.equal((await api.send('POST', '/api/auth/confirm', M.cookie, { password: 'secret123' })).status, 200);

    // A moderator decides about players: not about themselves, not about staff; the numbers and the bank are the owner's.
    const grounds = { basis: 'abuse', reason: 'Проверка на правилата.' };
    const banOwner = await api.send('POST', `/api/admin/players/${A.user.id}/ban`, M.cookie, { days: 1, ...grounds });
    assert.match(banOwner.body.error, /собственикът/);
    const self = await api.send('POST', `/api/admin/players/${M.id}/rename`, M.cookie, {
      username: 'pazitel_2',
      ...grounds,
    });
    assert.match(self.body.error, /себе си/);
    assert.equal((await api.get('/api/admin/stats', M.cookie)).status, 403);
    assert.equal((await api.send('POST', '/api/admin/bank/reload', M.cookie)).status, 403);
    // A report about a moderator is the owner's to see and decide.
    await api.send('POST', '/api/reports', B.cookie, {
      username: 'pazitel_test',
      reason: 'behavior',
      details: 'проба',
    });
    const about = (cookie: string) =>
      api
        .get('/api/admin/reports', cookie)
        .then((r) => r.body.cases.find((c: { owner: { username: string } }) => c.owner.username === 'pazitel_test'));
    assert.equal(await about(M.cookie), undefined);
    const theirs = await about(A.cookie);
    assert.equal(
      (
        await api.send('POST', `/api/admin/cases/player/${M.id}/resolve`, A.cookie, {
          reportIds: theirs.reports.map((r: { id: number }) => r.id),
          decision: { action: 'dismiss' },
        })
      ).status,
      200,
    );
    // The data export leaves the app's secret out: a stolen session can't make its own codes from it.
    const exported = (await (
      await fetch(`${srv.url}/api/account/export`, { headers: { cookie: M.cookie } })
    ).json()) as {
      account: { totp_on_at: number | null };
    };
    assert.equal(JSON.stringify(exported).includes(secret), false);
    assert.ok(exported.account.totp_on_at, 'that it is on, though, is theirs to know');

    // Who joined the staff, in the log: the command line did it.
    const joined = (await api.get('/api/admin/log', A.cookie)).body.entries.find(
      (e: { action: string; user: { username: string } | null }) =>
        e.action === 'staff_add' && e.user?.username === 'pazitel_test',
    );
    assert.deepEqual([joined.admin, joined.reason], [null, 'Модератор']);
  },
);

test('every moderation decision is logged with its grounds, and can be undone', T, async () => {
  const E = await register(srv.url, 'izmamnik_test');
  const act = (what: string, body: object = {}) =>
    api.send('POST', `/api/admin/players/${E.user.id}/${what}`, A.cookie, body);
  const card = async () => (await api.get(`/api/admin/players/${E.user.id}`, A.cookie)).body.card;
  const log = async () => (await api.get('/api/admin/log', A.cookie)).body.entries;
  const undo = (id: number, reason = 'Обжалване: беше грешка.') =>
    api.send('POST', `/api/admin/log/${id}/undo`, A.cookie, { reason });

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
  const evening = srv.db.prepare(
    'INSERT INTO evening_results (day, user_id, placement, score, players) VALUES (?, ?, 1, 9000, 30)',
  );
  evening.run(day, E.user.id);
  // …and one from a season before: what the player is told is this season's results, so that one stands.
  evening.run(shiftDay(`${season}-01`, -10), E.user.id);
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
  assert.deepEqual(results(), { rating: 0, daily: 1, evening: 1 }, "this season's results annulled");
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

  // Undone newest first: each puts back what it changed. An older one waits while a later decision stands, or it
  // would override it (undoing a week's ban once lifted a later permanent one).
  const [unban, shorter] = await log();
  assert.equal((await undo(unban.id, 'кратко')).status, 400, 'an undo says why');
  assert.equal((await undo(unban.id)).status, 200);
  assert.ok((await card()).ban, 'the unban undone: banned again');
  assert.equal((await undo(unban.id)).status, 400, 'once');
  assert.ok(!(await log()).find((e: { id: number }) => e.id === ban.id).canUndo, 'not offered while the change stands');
  const refused = await undo(ban.id);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /По-късно решение/);
  assert.ok((await card()).ban.until < Date.now() + 4 * 86_400_000, 'still the 3 days decided since');
  assert.equal((await undo(shorter.id)).status, 200);
  assert.equal((await undo(ban.id)).status, 200);
  assert.equal((await card()).ban, null, 'the ban undone: as before it');
  assert.equal((await undo(annulled.id)).status, 200);
  assert.deepEqual(results(), before, 'the results back');
  const entries = await log();
  const undone = entries.find((e: { id: number }) => e.id === ban.id);
  assert.deepEqual([undone.undoneBy, undone.undoReason], [A.user.username, 'Обжалване: беше грешка.']);
  const told = srv.db
    .prepare('SELECT text FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(E.user.id) as { text: string };
  assert.match(told.text, /върна резултатите ти.*Причина: Обжалване: беше грешка\./, 'the player hears each undo');

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
    (await api.send('POST', `/api/groups/${groupId}/report`, B.cookie, { reason: 'name' })).status,
    404,
    'only its members report a group',
  );
  const code = (srv.db.prepare('SELECT code FROM player_groups WHERE id = ?').get(groupId) as { code: string }).code;
  await api.send('POST', `/api/groups/join/${code}`, B.cookie);
  assert.equal(
    (await api.send('POST', `/api/groups/${groupId}/report`, B.cookie, { reason: 'content', details: 'обидно' }))
      .status,
    400,
    "a group's reasons are a group's",
  );
  assert.equal(
    (await api.send('POST', `/api/groups/${groupId}/report`, B.cookie, { reason: 'name', details: 'обидно' })).status,
    200,
  );
  const report = (await api.get('/api/admin/reports', A.cookie)).body.cases.find(
    (c: { kind: string; id: string }) => c.kind === 'group' && c.id === String(groupId),
  );
  assert.deepEqual(
    [report.name, report.owner.username, report.reports[0].details],
    ['Измамници', 'izmamnik_test', 'обидно'],
  );
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
  const back = await api.send('PATCH', `/api/groups/${groupId}`, signedIn.cookie!, { name: 'Измамници 2' });
  assert.match(back.body.error, /Модератор смени името наскоро/, "the owner can't put a name straight back");
  assert.equal(
    (await api.get('/api/admin/reports', A.cookie)).body.cases.some((c: { kind: string }) => c.kind === 'group'),
    false,
    "renaming the group closes its case's reports",
  );
  const [renameGroup] = await log();
  assert.equal(renameGroup.action, 'rename_group');
  assert.equal((await undo(renameGroup.id)).status, 200);
  assert.equal((await card()).groups[0].name, 'Измамници');
  await api.send('POST', `/api/groups/${groupId}/leave`, B.cookie);
});

test('data export and account deletion', T, async () => {
  // Something of B's to export: a match (with the achievement it brings) and a friend.
  const played = autoPlay(sb, 'right');
  assert.ok((await emitAck(sb, 'solo:start', { category: 'mixed' })).ok);
  await played;
  await api.send('POST', '/api/friends', B.cookie, { username: A.user.username });
  await api.send('POST', `/api/friends/${B.user.id}/accept`, A.cookie);
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

test(
  'flags hide a question only from players who were shown it and rate others; „Поправен“ starts it over; dismissed flags never count again; a few a day',
  T,
  async () => {
    const id = 'history-7';
    const F = await register(srv.url, 'signal_test');
    const flag = (cookie: string, q = id) =>
      api.send('POST', `/api/questions/${q}/report`, cookie, { reason: 'wrong' });
    const hidden = async () =>
      (await api.get('/api/admin/question-reports', A.cookie)).body.hidden.map((q: { id: string }) => q.id);
    const settle = (userId: number) =>
      srv.db
        .prepare('UPDATE users SET created_at = ?, games_played = MAX(games_played, 10) WHERE id = ?')
        .run(Date.now() - 2 * 86_400_000, userId);
    const show = (userId: number, q = id) =>
      srv.db
        .prepare('INSERT OR REPLACE INTO seen_questions (user_id, question_id, seen_at) VALUES (?, ?, ?)')
        .run(userId, q, Date.now());
    settle(A.user.id);
    settle(B.user.id);

    await flag(A.cookie);
    await flag(B.cookie);
    await flag(F.cookie);
    assert.deepEqual(await hidden(), [], 'nobody was shown it: anyone can guess an id');
    for (const u of [A, B, F]) show(u.user.id);
    await flag(F.cookie);
    assert.deepEqual(await hidden(), [], 'an account made today, without matches, does not count yet');
    settle(F.user.id);
    await flag(F.cookie);
    assert.deepEqual(await hidden(), [id], 'three players who were shown it hide it');
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

    // Flagged again and dismissed: the same three can't take it out again.
    for (const u of [A, B, F]) await flag(u.cookie);
    assert.deepEqual(await hidden(), [id]);
    const dismissed = await api.send('POST', `/api/admin/question-reports/${id}/resolve`, A.cookie, {
      action: 'dismiss',
    });
    assert.equal(dismissed.status, 200, dismissed.body.error);
    // „Въпросът е наред“ taken back from the log: the flags are open again, and the question hidden again.
    const [dismissal] = (await api.get('/api/admin/log', A.cookie)).body.entries;
    assert.equal(dismissal.action, 'dismiss_flags');
    const back = await api.send('POST', `/api/admin/log/${dismissal.id}/undo`, A.cookie, {
      reason: 'Сигналите бяха прави.',
    });
    assert.equal(back.status, 200, back.body.error);
    assert.deepEqual(await hidden(), [id]);
    await api.send('POST', `/api/admin/question-reports/${id}/resolve`, A.cookie, { action: 'dismiss' });
    for (const u of [A, B, F]) await flag(u.cookie);
    assert.deepEqual(await hidden(), [], 'their flags were dismissed once: they wait for a moderator now');
    await api.send('POST', `/api/admin/question-reports/${id}/resolve`, A.cookie, { action: 'dismiss' });

    // Past MODERATION.autoHidesPerDay a day, flags alert the moderators but hide nothing more.
    const insert = srv.db.prepare(
      'INSERT INTO hidden_questions (question_id, hidden_by, hidden_at) VALUES (?, NULL, ?)',
    );
    for (let i = 0; i < 5; i++) insert.run(`cap-${i}`, Date.now());
    const other = 'history-8';
    for (const u of [A, B, F]) {
      show(u.user.id, other);
      await flag(u.cookie, other);
    }
    assert.ok(!(await hidden()).includes(other), 'five hidden by flags today already');
    srv.db.prepare("DELETE FROM hidden_questions WHERE question_id LIKE 'cap-%'").run();
    await api.send('POST', `/api/admin/question-reports/${other}/resolve`, A.cookie, { action: 'dismiss' });
  },
);

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

  // An API answer is never kept on the way, even at an address that ends like a file: a player may be named „ivan.exe“,
  // and their profile says something else to each viewer (the 31 October review, CF-2).
  const dotted = await register(srv.url, 'ivan.exe');
  const profile = await fetch(`${srv.url}/api/profile/ivan.exe`, { headers: { cookie: dotted.cookie } });
  assert.equal(profile.status, 200);
  assert.equal(profile.headers.get('cache-control'), 'no-store', 'per-viewer answers are never stored by a CDN');
  assert.equal((await fetch(`${srv.url}/api/no-such-thing.css`)).headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${srv.url}/qimg/no-such-picture.webp`)).headers.get('cache-control'), 'no-store');

  const gone = await fetch(`${srv.url}/assets/index-from-an-old-deploy.js`);
  assert.equal(gone.status, 404, 'a missing build file is a 404, not the page');
  assert.equal(gone.headers.get('cache-control'), 'no-store', 'and never kept: the name can come back (a rollback)');

  // A shared challenge link previews as the challenge, not the generic site.
  const made = autoPlay(sa, 'right');
  const created = await emitAck(sa, 'challenge:start', {});
  assert.ok(created.ok, JSON.stringify(created));
  const { id } = created;
  await made;
  const shared = await (await fetch(`${srv.url}/c/${id}`)).text();
  assert.match(shared, new RegExp(`<title>${A.user.username} те предизвиква`));
  assert.match(shared, /property="og:description" content="Резултатът за биене: \d+ точки/);
  // The app shows it at once: the preview is in the page, and without a session it doesn't wait to ask who's signed in.
  assert.match(shared, new RegExp(`<script type="application/json" id="challenge-preview">\\{"id":"${id}"`));
  assert.match(shared, /<div id="root" data-signed-out="1">/);
  const signedIn = await (await fetch(`${srv.url}/c/${id}`, { headers: { cookie: A.cookie } })).text();
  assert.match(signedIn, /<div id="root">/, 'with a session the app asks as usual');
  assert.match(
    await (await fetch(`${srv.url}/c/unknown-id`)).text(),
    new RegExp(`<title>${PUBLIC_PAGES['/'].title}</title>`),
    'unknown links get the plain page',
  );
});

test(
  'two settings and an owner’s button, by their routes: the recordings switch and reloading the bank',
  T,
  async () => {
    // „Записите на мачовете ми“: others play against this player's recorded Дуели, until it's off.
    const off = await api.send('POST', '/api/account/share-runs', B.cookie, { on: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.user.shareRuns, false);
    assert.equal(
      (srv.db.prepare('SELECT share_runs FROM users WHERE id = ?').get(B.user.id) as { share_runs: number }).share_runs,
      0,
    );
    assert.equal((await api.send('POST', '/api/account/share-runs', B.cookie, { on: 'yes' })).status, 400);
    assert.equal((await api.send('POST', '/api/account/share-runs', B.cookie, { on: true })).body.user.shareRuns, true);

    // The bank read again from disk: the owner's, and logged.
    assert.equal((await api.send('POST', '/api/admin/bank/reload', B.cookie)).status, 403);
    const reloaded = await api.send('POST', '/api/admin/bank/reload', A.cookie);
    assert.equal(reloaded.status, 200, reloaded.body.error);
    assert.ok(srv.db.prepare("SELECT 1 AS x FROM moderation_log WHERE action = 'reload_bank'").get(), 'in the log');
  },
);

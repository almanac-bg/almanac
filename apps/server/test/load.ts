// Load test: how many people one server carries before matches start to stutter. Not part of `npm test` (it runs for
// minutes): `npm run build && npm run load -w @quiz/server`, optionally with the steps as arguments (`… load 500 1000`),
// and `--seed <accounts>` to play on a database with a long history (test/seed.ts: months of matches, the answer log,
// dailies… for that many accounts) instead of an empty one. Keep the computer awake meanwhile (on a Mac,
// `caffeinate -i npm run load …`), and raise the open-files limit for big steps (`ulimit -n 20000`).
//
// The production bundle runs on a throwaway database with real game timings. Simulated players (guests, each from a
// network of its own) play the way people do: solo runs, Duel and Royale from the queues, an answer after a few
// seconds, now and then a коз or an emote, the next match a moment after the last. Their number grows in steps; at each
// step a separate process asks /api/health ten times a second — everything the server does runs on one thread, so the
// time it takes to answer is how long every running match waits too. With a seeded database it also opens pages as
// the seeded accounts (their /me, a profile, the level board), the reads that grow with history.
//
// At the end the server restarts as for a deploy, with everyone still connected: it drains, a new one starts on the
// same database, and every player has to find it again at once.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { QuestionPayload } from '@quiz/shared';
import { type Client, connect, rightOption, sleep, startServer, type TestServer } from './helpers';

const args = process.argv.slice(2);
const seedAt = args.indexOf('--seed');
const seeded = seedAt >= 0 ? Number(args.splice(seedAt, 2)[1]) : 0;
const STEPS = args.map(Number).filter(Boolean);
const steps = STEPS.length ? STEPS : [250, 500, 1000, 2000];
/** Seconds each step is measured, after its new players have joined. */
const HOLD_S = 45;

process.env.TEST_TARGET = 'dist';
const env: Record<string, string> = {
  GAME_TIME_SCALE: '1',
  // As in production: bots fill a queue after a few seconds.
  BOT_FILL_SECONDS: '4',
  BOT_FILL_BUSY_SECONDS: '4',
  PUBLIC_QUEUES: 'duel,royale',
  // Matches running at the restart get this long to finish (production gives five and a half minutes).
  DRAIN_SECONDS: '20',
};
let sessions: { id: number; username: string; token: string }[] = [];
const seedDir = seeded ? fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-seeded-')) : null;
if (seedDir) {
  const file = path.join(seedDir, 'quiz.db');
  console.log(`Seeding a database with ${seeded.toLocaleString('en')} accounts' history…`);
  execFileSync(process.execPath, ['--import', 'tsx', path.join(import.meta.dirname, 'seed.ts'), file, String(seeded)], {
    stdio: 'inherit',
  });
  sessions = JSON.parse(fs.readFileSync(`${file}.sessions.json`, 'utf8'));
  env.DB_PATH = file;
}
let started = performance.now();
let srv: TestServer = await startServer(env);
// On a seeded database the first start also counts the running tallies from all of it (catchUpTallies).
console.log(`Server up in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
const port = new URL(srv.url).port;
env.PORT = port;
env.DB_PATH = srv.dbPath;
const pidOf = () =>
  Number(
    execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'])
      .toString()
      .trim()
      .split('\n')[0],
  );
let serverPid = pidOf();

const stats = { matches: 0, answers: 0, refused: 0, dropped: 0 };
const t0 = performance.now();
/** Seconds into the run each player dropped. */
const dropsAt: number[] = [];
/** This process's own hold-ups: a player simulated late is the test's fault, not the server's. */
const clientLag = monitorEventLoopDelay({ resolution: 10 });
clientLag.enable();
/** Why players were refused or dropped, by reason. */
const why: Record<string, number> = {};
const players: Client[] = [];
let networkSeq = 0;
const pick = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** One person: a guest of their own, from a network of their own, playing match after match. */
async function player() {
  const n = networkSeq++;
  const from = `198.18.${n >> 8}.${n & 255}`;
  const r = await fetch(`${srv.url}/api/auth/guest`, { method: 'POST', headers: { 'x-forwarded-for': from } });
  if (!r.ok) {
    stats.refused++;
    why[`guest: ${r.status}`] = (why[`guest: ${r.status}`] ?? 0) + 1;
    return;
  }
  // Back by itself after a restart, as the app is (socket.io's delays: 1 s, growing to 5 s, spread at random).
  const s = connect(
    srv.url,
    r.headers.get('set-cookie')!.split(';')[0],
    { 'x-forwarded-for': from },
    { reconnects: true },
  );
  players.push(s);
  // As the app (packages/client/src/realtime.ts): a restart the server announced is followed by a reconnect anywhere
  // in the first 5 s, not all in the same second; once in, the usual pace again.
  s.on('server:draining', () => s.io.reconnectionDelay(2500).randomizationFactor(1));
  s.on('connect', () => s.io.reconnectionDelay(1000).randomizationFactor(0.5));
  s.on('disconnect', (reason) => {
    stats.dropped++;
    why[`disconnect: ${reason}`] = (why[`disconnect: ${reason}`] ?? 0) + 1;
    dropsAt.push(Math.round((performance.now() - t0) / 1000));
  });
  s.on('connect_error', (err) => {
    stats.dropped++;
    why[`connect_error: ${err.message}`] = (why[`connect_error: ${err.message}`] ?? 0) + 1;
  });
  s.on('game:question', (q: QuestionPayload) => {
    if (Math.random() < 0.1) s.emit('game:powerup', { index: q.index, powerup: pick(['fifty', 'double'] as const) });
    setTimeout(
      () => {
        const right = rightOption(q);
        s.emit('game:answer', { index: q.index, choice: Math.random() < 0.7 ? right : (right + 1) % 4 });
        stats.answers++;
        if (Math.random() < 0.05) s.emit('game:react', 'fire');
      },
      between(1500, 9000),
    );
  });
  const play = () => {
    const kind = Math.random();
    const ask = (ok: boolean) => !ok && stats.refused++;
    if (kind < 0.5) s.emit('solo:start', { category: 'mixed' }, (res) => ask(res.ok));
    else s.emit('queue:join', kind < 0.85 ? 'duel' : 'royale', (res) => ask(res.ok));
  };
  s.on('game:end', () => {
    stats.matches++;
    setTimeout(play, between(2000, 6000));
  });
  s.on('connect', play);
}

/**
 * Requests from a process of its own (this one is busy being thousands of players), one every `everyMs`, going round
 * the list: one line per answer, its time in ms (-1: no answer).
 */
function probe(requests: { path: string; cookie?: string }[], everyMs: number): { stop: () => number[] } {
  const child: ChildProcess = spawn(
    process.execPath,
    [
      '-e',
      `const [base, list, every] = JSON.parse(process.argv[1]); let i = 0;
       setInterval(async () => {
         const { path, cookie } = list[i++ % list.length];
         const t = performance.now();
         try {
           const r = await fetch(base + path, { headers: cookie ? { cookie } : {} });
           await r.arrayBuffer();
           console.log(r.ok ? performance.now() - t : -1);
         } catch { console.log(-1); }
       }, every);`,
      JSON.stringify([srv.url, requests, everyMs]),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const times: number[] = [];
  child.stdout!.on('data', (d: Buffer) => {
    for (const line of d.toString().trim().split('\n')) times.push(Number(line));
  });
  return {
    stop: () => {
      child.kill();
      return times;
    },
  };
}

const HEALTH = [{ path: '/api/health' }];
/** As the seeded accounts: their own page, someone else's profile, the level board. */
const PAGES = sessions.flatMap(({ token }, i) => {
  const cookie = `quiz_session=${token}`;
  const other = sessions[(i + 1) % sessions.length].username;
  return [
    { path: '/api/me', cookie },
    { path: `/api/profile/${encodeURIComponent(other)}`, cookie },
    { path: '/api/leaderboard/level', cookie },
  ];
});

function serverUsage(): { cpu: number; rssMb: number } {
  const [cpu, rss] = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', String(serverPid)])
    .toString()
    .trim()
    .split(/\s+/);
  return { cpu: Number(cpu), rssMb: Math.round(Number(rss) / 1024) };
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

/** p50 / p99 / max of the answers that came, in ms. */
function spread(times: number[]): string {
  const ok = times.filter((t) => t >= 0).sort((a, b) => a - b);
  return ok.length
    ? `${percentile(ok, 0.5).toFixed(0)} / ${percentile(ok, 0.99).toFixed(0)} / ${ok.at(-1)!.toFixed(0)}`
    : '—';
}
const failed = (times: number[]) => times.filter((t) => t < 0).length;

console.log(
  `\nLoad test: ${steps.join(' → ')} players, ${HOLD_S} s each, real game timings, production bundle, ${
    seeded ? `a database with ${seeded.toLocaleString('en')} accounts' history` : 'an empty database'
  }.\n`,
);
console.log(
  `players  connected  matches  answers/s   health p50 / p99 / max (ms)${seeded ? '    pages p50 / p99 / max' : ''}   failed   server CPU   memory`,
);
let old: TestServer | null = null;
try {
  for (const target of steps) {
    // Joining over ten seconds, as people do, not all in one instant.
    const joining = target - players.length;
    for (let i = 0; i < joining; i++) {
      void player();
      await sleep(10_000 / joining);
    }
    await sleep(5_000);
    const before = { ...stats };
    started = performance.now();
    const wallStarted = Date.now();
    const health = probe(HEALTH, 100);
    const pages = seeded ? probe(PAGES, 200) : null;
    let cpu = 0;
    let rssMb = 0;
    for (let t = 0; t < HOLD_S; t += 5) {
      await sleep(5_000);
      const usage = serverUsage();
      cpu = Math.max(cpu, usage.cpu);
      rssMb = Math.max(rssMb, usage.rssMb);
    }
    const times = health.stop();
    const pageTimes = pages?.stop() ?? [];
    const seconds = (performance.now() - started) / 1000;
    // A computer that slept freezes the server and the players alike, and every connection then times out at once on
    // waking: such a step measured the laptop, not the server.
    const slept = (Date.now() - wallStarted) / 1000 - seconds > 2;
    const online = players.filter((s) => s.connected).length;
    console.log(
      [
        String(players.length).padStart(7),
        String(online).padStart(10),
        String(stats.matches - before.matches).padStart(8),
        ((stats.answers - before.answers) / seconds).toFixed(0).padStart(10),
        spread(times).padStart(27),
        seeded ? spread(pageTimes).padStart(25) : '',
        String(
          failed(times) + failed(pageTimes) + stats.refused - before.refused + stats.dropped - before.dropped,
        ).padStart(11),
        `${cpu.toFixed(0)}%`.padStart(12),
        `${rssMb} MB`.padStart(9),
        slept ? '   (the computer slept: not a measurement)' : '',
      ].join(''),
    );
  }

  // A deploy with everyone still connected: the server drains and stops, a new one starts on the same database and
  // port, and every player's connection finds it again, all at once.
  const online = players.filter((s) => s.connected).length;
  const before = { ...stats };
  started = performance.now();
  const exitCode = await srv.kill('SIGTERM');
  const stoppedAt = (performance.now() - started) / 1000;
  old = srv;
  srv = await startServer(env);
  serverPid = pidOf();
  const upAt = (performance.now() - started) / 1000;
  const health = probe(HEALTH, 100);
  let back = 0;
  while (performance.now() - started < upAt * 1000 + 60_000) {
    await sleep(250);
    back = players.filter((s) => s.connected).length;
    if (back >= online) break;
  }
  const backAt = (performance.now() - started) / 1000;
  const resumed = { ...stats };
  await sleep(15_000);
  const times = health.stop();
  console.log(
    `\nRestart with ${online} players connected: stopped after ${stoppedAt.toFixed(1)} s (drain up to ${
      env.DRAIN_SECONDS
    } s, exit ${exitCode}); the new server answering at ${upAt.toFixed(1)} s; ${back} of ${online} players back at ${backAt.toFixed(
      1,
    )} s; health from then on ${spread(times)} ms, ${failed(times)} failed; ${
      stats.answers - resumed.answers
    } answers in the 15 s after (${resumed.matches - before.matches} matches ended by the restart).`,
  );

  if (Object.keys(why).length) {
    console.log('\nRefused or dropped:', why);
    console.log('Dropped at (s into the run):', [...new Set(dropsAt)].join(', '));
  }
  console.log(`This process's own longest hold-up: ${Math.round(clientLag.max / 1e6)} ms`);
} finally {
  for (const s of players) s.close();
  await srv.stop();
  // The first server's folder holds the database the second one ran on: it goes last.
  await old?.stop();
  if (seedDir) fs.rmSync(seedDir, { recursive: true, force: true });
}
process.exit(0);

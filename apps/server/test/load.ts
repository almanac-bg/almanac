// Load test: how many people one server carries before matches start to stutter. Not part of `npm test` (it runs for
// minutes): `npm run build && npm run load -w @quiz/server`, optionally with the steps as arguments (`… load 500 1000`).
// Keep the computer awake meanwhile (on a Mac, `caffeinate -i npm run load …`), and raise the open-files limit for big
// steps (`ulimit -n 20000`).
//
// The production bundle runs on a throwaway database with real game timings. Simulated players (guests, each from a
// network of its own) play the way people do: solo runs, Duel and Royale from the queues, an answer after a few
// seconds, now and then a коз or an emote, the next match a moment after the last. Their number grows in steps; at each
// step a separate process asks /api/health ten times a second — everything the server does runs on one thread, so the
// time it takes to answer is how long every running match waits too.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { QuestionPayload } from '@quiz/shared';
import { type Client, connect, rightOption, sleep, startServer } from './helpers';

const STEPS = process.argv.slice(2).map(Number).filter(Boolean);
const steps = STEPS.length ? STEPS : [250, 500, 1000, 2000];
/** Seconds each step is measured, after its new players have joined. */
const HOLD_S = 45;

process.env.TEST_TARGET = 'dist';
const srv = await startServer({
  GAME_TIME_SCALE: '1',
  // As in production: bots fill a queue after a few seconds.
  BOT_FILL_SECONDS: '4',
  BOT_FILL_BUSY_SECONDS: '4',
  PUBLIC_QUEUES: 'duel,royale',
});
const port = new URL(srv.url).port;
const serverPid = Number(
  execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'])
    .toString()
    .trim()
    .split('\n')[0],
);

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
  const s = connect(srv.url, r.headers.get('set-cookie')!.split(';')[0], { 'x-forwarded-for': from });
  players.push(s);
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

/** /api/health from a process of its own (this one is busy being thousands of players): one line per answer. */
function probe(): { stop: () => number[] } {
  const child: ChildProcess = spawn(
    process.execPath,
    [
      '-e',
      `setInterval(async () => { const t = performance.now(); try { await fetch(${JSON.stringify(`${srv.url}/api/health`)}); console.log(performance.now() - t); } catch { console.log(-1); } }, 100);`,
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

function serverUsage(): { cpu: number; rssMb: number } {
  const [cpu, rss] = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', String(serverPid)])
    .toString()
    .trim()
    .split(/\s+/);
  return { cpu: Number(cpu), rssMb: Math.round(Number(rss) / 1024) };
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

console.log(`Load test: ${steps.join(' → ')} players, ${HOLD_S} s each, real game timings, production bundle.\n`);
console.log('players  connected  matches  answers/s   health p50 / p99 / max (ms)   failed   server CPU   memory');
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
    const started = performance.now();
    const wallStarted = Date.now();
    const health = probe();
    let cpu = 0;
    let rssMb = 0;
    for (let t = 0; t < HOLD_S; t += 5) {
      await sleep(5_000);
      const usage = serverUsage();
      cpu = Math.max(cpu, usage.cpu);
      rssMb = Math.max(rssMb, usage.rssMb);
    }
    const times = health.stop();
    const seconds = (performance.now() - started) / 1000;
    // A computer that slept freezes the server and the players alike, and every connection then times out at once on
    // waking: such a step measured the laptop, not the server.
    const slept = (Date.now() - wallStarted) / 1000 - seconds > 2;
    const ok = times.filter((t) => t >= 0).sort((a, b) => a - b);
    const online = players.filter((s) => s.connected).length;
    console.log(
      [
        String(players.length).padStart(7),
        String(online).padStart(10),
        String(stats.matches - before.matches).padStart(8),
        ((stats.answers - before.answers) / seconds).toFixed(0).padStart(10),
        `${percentile(ok, 0.5).toFixed(0)} / ${percentile(ok, 0.99).toFixed(0)} / ${ok.at(-1)!.toFixed(0)}`.padStart(
          27,
        ),
        String(times.length - ok.length + stats.refused - before.refused + stats.dropped - before.dropped).padStart(11),
        `${cpu.toFixed(0)}%`.padStart(12),
        `${rssMb} MB`.padStart(9),
        slept ? '   (the computer slept: not a measurement)' : '',
      ].join(''),
    );
  }
  if (Object.keys(why).length) {
    console.log('\nRefused or dropped:', why);
    console.log('Dropped at (s into the run):', [...new Set(dropsAt)].join(', '));
  }
  console.log(`This process's own longest hold-up: ${Math.round(clientLag.max / 1e6)} ms`);
} finally {
  for (const s of players) s.close();
  await srv.stop();
}
process.exit(0);

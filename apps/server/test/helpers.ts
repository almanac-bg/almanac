import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { once as onceEvent } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after } from 'node:test';
import {
  CATEGORY_IDS,
  type ClientToServerEvents,
  type GameEndPayload,
  type GameStartPayload,
  type MeUser,
  type QuestionPayload,
  type RevealPayload,
  type ServerToClientEvents,
} from '@quiz/shared';
import { io, type Socket } from 'socket.io-client';
import { codeAt, stepAt } from '../src/totp';

export type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const serverDir = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 30 questions per category (12 easy / 12 medium / 6 hard). The correct option is marked with ✓,
 * so tests can answer right or wrong on purpose even though the server shuffles options. Every other one has a
 * "Знаеше ли?" fact.
 */
export function writeFixtureQuestions(file: string) {
  const questions = CATEGORY_IDS.flatMap((category) =>
    Array.from({ length: 30 }, (_, i) => {
      const answer = i % 4;
      return {
        id: `${category}-${i}`,
        category,
        difficulty: i < 12 ? 'easy' : i < 24 ? 'medium' : 'hard',
        q: `Тестов въпрос ${category} #${i}?`,
        options: [0, 1, 2, 3].map((k) => (k === answer ? `Верен ✓ ${i}` : `Грешен ${k} ${i}`)),
        answer,
        ...(i % 2 === 0 && { fact: `Факт за ${category} #${i}.`, factSource: 'https://example.test/fact' }),
      };
    }),
  );
  // Number questions for the finals: years, and a size on a log scale. The answer is in the text (as ✓ marks the right
  // option), so a test can give it.
  const numbers = CATEGORY_IDS.flatMap((category) =>
    Array.from({ length: 3 }, (_, i) => {
      const log = i === 2;
      const answer = log ? 5000 : 1800 + i * 10;
      return {
        id: `${category}-n${i}`,
        kind: 'number',
        category,
        difficulty: (['easy', 'medium', 'hard'] as const)[i],
        q: `Тестово число ${category} #${i} (= ${answer})?`,
        number: log
          ? { answer, unit: 'км', min: 1, max: 1_000_000, step: 1, scale: 'log', tolerance: 3 }
          : { answer, unit: '', min: 1000, max: 2025, step: 1, scale: 'linear', tolerance: 50 },
      };
    }),
  );
  fs.writeFileSync(file, JSON.stringify([...questions, ...numbers]));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export interface SentMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface TestServer {
  url: string;
  db: DatabaseSync;
  dbPath: string;
  /** Emails the server "sent", oldest first. */
  mails(): SentMail[];
  /** Sends a signal to the server process and resolves with its exit code once it exits. */
  kill(signal: NodeJS.Signals): Promise<number | null>;
  /** Errors the server reported (reportError) so far: a test that causes one on purpose names it here. */
  allowErrors(...patterns: RegExp[]): void;
  stop(): Promise<void>;
}

/**
 * Errors test servers reported that no test said to expect: they fail the file (in after(), so a test's own failure
 * isn't hidden by the server's). The server prints them as 💥 lines too.
 */
const unexpectedErrors: string[] = [];
after(() => {
  if (unexpectedErrors.length)
    throw new Error(`The server reported errors no test expected:\n${unexpectedErrors.join('\n')}`);
});

/**
 * Boots a real server on a free port with a throwaway database, fixture questions, fast timers
 * (GAME_TIME_SCALE) and quick bot fill. TEST_TARGET=dist runs the production bundle instead of the sources.
 */
export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-test-'));
  const questions = path.join(dir, 'questions.json');
  // A given database: the same one again, as after a restart.
  const dbPath = env.DB_PATH ?? path.join(dir, 'test.db');
  const outbox = path.join(dir, 'outbox');
  const errorsFile = path.join(dir, 'errors.jsonl');
  const allowed: RegExp[] = [];
  writeFixtureQuestions(questions);
  // A given port: the same server again, as after a restart (test/load.ts).
  const port = env.PORT ? Number(env.PORT) : await freePort();
  const args =
    process.env.TEST_TARGET === 'dist'
      ? [path.join(serverDir, 'dist/index.mjs')]
      : [require.resolve('tsx/cli'), path.join(serverDir, 'src/index.ts')];
  const child: ChildProcess = spawn(process.execPath, args, {
    env: {
      // Nothing else from the developer's shell (a Sentry DSN, VAPID keys, NODE_ENV): what a test server is, is here.
      ...shellBasics(),
      PORT: String(port),
      DB_PATH: dbPath,
      QUESTIONS_PATH: questions,
      BOT_FILL_SECONDS: '1',
      BOT_FILL_BUSY_SECONDS: '1',
      PUBLIC_QUEUES: 'all',
      GAME_TIME_SCALE: '0.05',
      MAIL_OUTBOX: outbox,
      ERROR_OUTBOX: errorsFile,
      APP_URL: 'https://almanac.test',
      // The tests talk to it over plain HTTP, as if from behind the proxy.
      COOKIE_SECURE: 'false',
      // No evening Роял at whatever hour the tests run (CI often runs at 21:00 Sofia): evening.test sets its own.
      EVENING_AT: 'off',
      // Where `npm test` collects every statement for the plan check (test/plans.ts).
      ...(process.env.SQL_LOG && { SQL_LOG: process.env.SQL_LOG }),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so a simulated crash (SIGKILL) reaches the server under the tsx wrapper too.
    detached: true,
  });
  let output = '';
  child.stdout!.on('data', (d) => (output += d));
  child.stderr!.on('data', (d) => (output += d));

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${output}`);
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server did not start:\n${output}`);
    await sleep(100);
  }

  const db = new DatabaseSync(dbPath);
  return {
    url,
    db,
    dbPath,
    mails: () =>
      fs.existsSync(outbox)
        ? fs
            .readdirSync(outbox)
            .sort()
            .map((f) => JSON.parse(fs.readFileSync(path.join(outbox, f), 'utf8')) as SentMail)
        : [],
    async kill(signal) {
      const exited = onceEvent(child, 'exit');
      // Other signals go to the wrapper, which forwards them once (a second SIGTERM means "stop now").
      if (signal === 'SIGKILL') process.kill(-child.pid!, signal);
      else child.kill(signal);
      const [code] = await exited;
      return code as number | null;
    },
    allowErrors(...patterns) {
      allowed.push(...patterns);
    },
    async stop() {
      db.close();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await onceEvent(child, 'exit');
      }
      if (fs.existsSync(errorsFile))
        for (const line of fs.readFileSync(errorsFile, 'utf8').split('\n').filter(Boolean)) {
          const { where, message } = JSON.parse(line) as { where: string; message: string };
          if (!allowed.some((p) => p.test(`${where}: ${message}`))) unexpectedErrors.push(`💥 ${where}: ${message}`);
        }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface Account {
  cookie: string;
  user: MeUser;
}

export async function register(url: string, username: string, email?: string): Promise<Account> {
  const r = await fetch(`${url}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123', email }),
  });
  const body = (await r.json()) as { user: MeUser };
  if (!r.ok) throw new Error(`register ${username}: ${JSON.stringify(body)}`);
  return { cookie: r.headers.get('set-cookie')!.split(';')[0], user: body.user };
}

/** "Играй като гост": an account with no name or password yet. */
export async function guest(url: string): Promise<Account> {
  const r = await fetch(`${url}/api/auth/guest`, { method: 'POST' });
  const body = (await r.json()) as { user: MeUser };
  if (!r.ok) throw new Error(`guest: ${JSON.stringify(body)}`);
  return { cookie: r.headers.get('set-cookie')!.split(';')[0], user: body.user };
}

/**
 * A staff account's authenticator app set up, and this session's code given — what /admin asks before anything else.
 * Needs the password given within the hour (a fresh sign-in counts). Returns the app's secret, for later codes.
 */
export async function withSecondFactor(url: string, cookie: string): Promise<string> {
  const api = http(url);
  const setup = await api.send('POST', '/api/auth/2fa/setup', cookie);
  if (setup.status !== 200) throw new Error(`2FA setup: ${JSON.stringify(setup.body)}`);
  const enabled = await api.send('POST', '/api/auth/2fa/enable', cookie, {
    code: codeAt(setup.body.secret, stepAt(Date.now())),
  });
  if (enabled.status !== 200) throw new Error(`2FA enable: ${JSON.stringify(enabled.body)}`);
  return setup.body.secret;
}

/** What a child process needs from the shell to run at all: where programs, the home folder and temporary files are. */
export function shellBasics(): Record<string, string> {
  const keep = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'SystemRoot'];
  return Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]!]));
}

/** Runs the admin command line (src/cli.ts, or the bundle with TEST_TARGET=dist) against a test server's database. */
export function cli(dbPath: string, ...args: string[]): { status: number | null; output: string } {
  const entry =
    process.env.TEST_TARGET === 'dist'
      ? [path.join(serverDir, 'dist/cli.mjs')]
      : [require.resolve('tsx/cli'), path.join(serverDir, 'src/cli.ts')];
  const r = spawnSync(process.execPath, [...entry, ...args], {
    env: { ...shellBasics(), DB_PATH: dbPath },
    encoding: 'utf8',
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

export function http(url: string) {
  const call = async (method: string, path: string, cookie = '', body?: unknown) => {
    const r = await fetch(`${url}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // A new session (signing in, saving a guest) comes as a cookie: the one to go on with.
    const session = r.headers
      .getSetCookie()
      .find((c) => /quiz_session=./.test(c))
      ?.split(';')[0];
    // biome-ignore lint/suspicious/noExplicitAny: tests read whichever fields of a route's JSON they assert on
    return { status: r.status, body: (await r.json()) as any, cookie: session };
  };
  return {
    get: (path: string, cookie = '') => call('GET', path, cookie),
    send: call,
  };
}

/** A player's connection. Tests reconnect by hand; `reconnects` makes it come back by itself, as the app's does. */
export function connect(
  url: string,
  cookie: string,
  extraHeaders: Record<string, string> = {},
  { reconnects = false } = {},
): Client {
  return io(url, {
    transports: ['websocket'],
    extraHeaders: { cookie, ...extraHeaders },
    forceNew: true,
    reconnection: reconnects,
  });
}

export async function connected(...clients: Client[]) {
  await Promise.all(clients.map((c) => (c.connected ? null : onceEvent(c as never, 'connect'))));
}

type ClientEvent = keyof ClientToServerEvents;
type ServerEvent = keyof ServerToClientEvents;
/** What an event's ack callback (its last argument) is called with. */
type AckOf<F> = F extends (...args: infer P) => void
  ? P extends [...unknown[], (res: infer R) => void]
    ? R
    : never
  : never;
/** The payload a server event carries. */
type PayloadOf<E extends ServerEvent> = Parameters<ServerToClientEvents[E]>[0];
/** Untyped emit/once: the helpers are generic over the event, and tests send malformed payloads on purpose. */
type LooseSocket = {
  emit: (event: string, ...args: unknown[]) => unknown;
  once: (event: string, listener: (payload: never) => void) => unknown;
  on: (event: string, listener: (payload: never) => void) => unknown;
  off: (event: string, listener: (payload: never) => void) => unknown;
};

/** Emits and resolves with the server's ack. */
export const emitAck = <E extends ClientEvent>(s: Client, event: E, ...args: unknown[]) =>
  new Promise<AckOf<ClientToServerEvents[E]>>((resolve) => (s as unknown as LooseSocket).emit(event, ...args, resolve));

/** Next occurrence of an event, or a rejection after `ms`. */
export const next = <E extends ServerEvent>(s: Client, event: E, ms = 5000) =>
  new Promise<PayloadOf<E>>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    (s as unknown as LooseSocket).once(event, (payload: PayloadOf<E>) => {
      clearTimeout(t);
      resolve(payload);
    });
  });

/** The next occurrence of an event that `match` accepts, or a rejection after `ms`. */
export const nextWhere = <E extends ServerEvent>(
  s: Client,
  event: E,
  match: (payload: PayloadOf<E>) => boolean,
  ms = 5000,
) =>
  new Promise<PayloadOf<E>>((resolve, reject) => {
    const socket = s as unknown as LooseSocket;
    const listener = (payload: PayloadOf<E>) => {
      if (!match(payload)) return;
      clearTimeout(t);
      socket.off(event, listener);
      resolve(payload);
    };
    const t = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`timeout waiting for ${event}`));
    }, ms);
    socket.on(event, listener);
  });

/**
 * Retries `check` until it passes, then returns; after `ms`, fails with its last error. For state that arrives in its
 * own time (a broadcast, a presence change): a fixed sleep is either too short on a slow runner or wasted time.
 */
export async function eventually(check: () => void | Promise<void>, ms = 3000) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      return await check();
    } catch (err) {
      if (Date.now() > until) throw err;
    }
    await sleep(10);
  }
}

export interface PlayLog {
  questions: QuestionPayload[];
  reveals: RevealPayload[];
}

/** The token from the last link in an email. */
export const tokenFrom = (mail: SentMail) => new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;

/** The session cookie a response sets. */
export const cookieFrom = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];

export const newLog = (): PlayLog => ({ questions: [], reveals: [] });
export const rightOption = (q: QuestionPayload) => q.options.findIndex((o) => o.includes('✓'));
/** A fixture number question's answer (it's in the text). */
export const rightNumber = (q: QuestionPayload) => Number(q.q.match(/\(= (\d+)\)/)![1]);

/** Answers a question: the right option or number, or a wrong one (a number far off). */
export function answer(s: Client, q: QuestionPayload, right: boolean, afterMs = 30) {
  setTimeout(() => {
    if (q.kind === 'number') s.emit('game:guess', { index: q.index, value: right ? rightNumber(q) : q.number!.min });
    else s.emit('game:answer', { index: q.index, choice: right ? rightOption(q) : (rightOption(q) + 1) % 4 });
  }, afterMs);
}

/**
 * Answers every question until the match ends: 'right' picks the ✓ option (or gives the number), 'wrong' another one.
 * Resolves with the start and end payloads.
 */
export function autoPlay(
  s: Client,
  strategy: 'right' | 'wrong',
  log?: PlayLog,
): Promise<{ start: GameStartPayload | null; end: GameEndPayload }> {
  return new Promise((resolve) => {
    let start: GameStartPayload | null = null;
    const onStart = (p: GameStartPayload) => (start = p);
    const onQuestion = (q: QuestionPayload) => {
      log?.questions.push(q);
      answer(s, q, strategy === 'right');
    };
    const onReveal = (r: RevealPayload) => log?.reveals.push(r);
    const onEnd = (end: GameEndPayload) => {
      s.off('game:start', onStart).off('game:question', onQuestion).off('game:reveal', onReveal).off('game:end', onEnd);
      resolve({ start, end });
    };
    s.on('game:start', onStart).on('game:question', onQuestion).on('game:reveal', onReveal).on('game:end', onEnd);
  });
}

/** A JPEG's shape as a canvas writes it: JFIF, tables, the frame, Huffman tables, a scan; `extra` segments after JFIF. */
export function jpeg(w: number, h: number, extra: number[][] = []): Buffer {
  const segment = (marker: number, body: number[]) => [
    0xff,
    marker,
    (body.length + 2) >> 8,
    (body.length + 2) & 0xff,
    ...body,
  ];
  return Buffer.from([
    0xff,
    0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]),
    ...extra.flat(),
    ...segment(0xdb, Array(65).fill(1)),
    ...segment(0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0]),
    ...segment(0xc4, Array(20).fill(0)),
    ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12,
    0x34,
    0xff,
    0xd9,
  ]);
}
/** An APPn (or comment) segment carrying `text`. */
export const app = (marker: number, text: string) => [0xff, marker, 0, text.length + 2, ...Buffer.from(text, 'latin1')];

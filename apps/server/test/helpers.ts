import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { once as onceEvent } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

export type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const serverDir = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 30 questions per category (12 easy / 12 medium / 6 hard). The correct option is marked with ✓,
 * so tests can answer right or wrong on purpose even though the server shuffles options.
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
      };
    }),
  );
  fs.writeFileSync(file, JSON.stringify(questions));
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
  stop(): Promise<void>;
}

/**
 * Boots a real server on a free port with a throwaway database, fixture questions, fast timers
 * (GAME_TIME_SCALE) and quick bot fill. TEST_TARGET=dist runs the production bundle instead of the sources.
 */
export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-test-'));
  const questions = path.join(dir, 'questions.json');
  const dbPath = path.join(dir, 'test.db');
  const outbox = path.join(dir, 'outbox');
  writeFixtureQuestions(questions);
  const port = await freePort();
  const args =
    process.env.TEST_TARGET === 'dist'
      ? [path.join(serverDir, 'dist/index.mjs')]
      : [require.resolve('tsx/cli'), path.join(serverDir, 'src/index.ts')];
  const child: ChildProcess = spawn(process.execPath, args, {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      QUESTIONS_PATH: questions,
      BOT_FILL_SECONDS: '1',
      PUBLIC_QUEUES: 'all',
      GAME_TIME_SCALE: '0.05',
      MAIL_OUTBOX: outbox,
      APP_URL: 'https://almanac.test',
      SMTP_URL: '',
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
    async stop() {
      db.close();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await onceEvent(child, 'exit');
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

/** Runs the admin command line (src/cli.ts, or the bundle with TEST_TARGET=dist) against a test server's database. */
export function cli(dbPath: string, ...args: string[]): { status: number | null; output: string } {
  const entry =
    process.env.TEST_TARGET === 'dist'
      ? [path.join(serverDir, 'dist/cli.mjs')]
      : [require.resolve('tsx/cli'), path.join(serverDir, 'src/cli.ts')];
  const r = spawnSync(process.execPath, [...entry, ...args], { env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

export function http(url: string) {
  const call = async (method: string, path: string, cookie = '', body?: unknown) => {
    const r = await fetch(`${url}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  return {
    get: (path: string, cookie = '') => call('GET', path, cookie),
    send: call,
  };
}

export function connect(url: string, cookie: string, extraHeaders: Record<string, string> = {}): Client {
  return io(url, { transports: ['websocket'], extraHeaders: { cookie, ...extraHeaders }, forceNew: true, reconnection: false });
}

export async function connected(...clients: Client[]) {
  await Promise.all(clients.map((c) => (c.connected ? null : onceEvent(c as never, 'connect'))));
}

type AnySocket = { emit: (...a: any[]) => unknown; once: (...a: any[]) => unknown };

/** Emits and resolves with the server's ack. */
export const emitAck = <T = any>(s: Client, event: string, ...args: unknown[]): Promise<T> =>
  new Promise((resolve) => (s as unknown as AnySocket).emit(event, ...args, resolve));

/** Next occurrence of an event, or a rejection after `ms`. */
export const next = <T = any>(s: Client, event: string, ms = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    (s as unknown as AnySocket).once(event, (x: T) => {
      clearTimeout(t);
      resolve(x);
    });
  });

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

/**
 * Answers every question until the match ends: 'right' picks the ✓ option, 'wrong' another one.
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
      const right = rightOption(q);
      const choice = strategy === 'right' ? right : (right + 1) % 4;
      setTimeout(() => s.emit('game:answer', { index: q.index, choice }), 30);
    };
    const onReveal = (r: RevealPayload) => log?.reveals.push(r);
    const onEnd = (end: GameEndPayload) => {
      s.off('game:start', onStart).off('game:question', onQuestion).off('game:reveal', onReveal).off('game:end', onEnd);
      resolve({ start, end });
    };
    s.on('game:start', onStart).on('game:question', onQuestion).on('game:reveal', onReveal).on('game:end', onEnd);
  });
}

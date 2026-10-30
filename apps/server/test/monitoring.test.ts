// Error reports: server errors reach Sentry as envelopes, the browser's go through our tunnel (only to our own
// project), and a flood of errors can't use up the monthly quota. A fake Sentry endpoint stands in for the real one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { format } from 'node:util';
import { sleep } from './helpers';

const received: { url: string; body: string }[] = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    received.push({ url: req.url ?? '', body });
    res.end('{}');
  });
});
await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
const { port } = fake.address() as { port: number };
const DSN = `http://public123@127.0.0.1:${port}/42`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-monitoring-'));
process.env.DB_PATH = path.join(tmp, 'monitoring.db');
process.env.SENTRY_DSN = DSN;
process.env.APP_RELEASE = 'test-release';
const { forwardEnvelope, reportError, scrubLog, shipLogs, watchEventLoop } = await import('../src/monitoring');

after(() => {
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const lines = (body: string) =>
  body
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

test('a server error becomes a Sentry event with its stack, place and account number — nothing more', async () => {
  received.length = 0;
  const original = console.error;
  console.error = () => {};
  try {
    await reportError(new TypeError('boom'), 'socket game:answer', { userId: 7 });
  } finally {
    console.error = original;
  }
  assert.equal(received.length, 1);
  assert.equal(received[0].url, '/api/42/envelope/');
  const [header, item, event] = lines(received[0].body);
  assert.equal(header.dsn, DSN);
  assert.equal(item.type, 'event');
  assert.equal(event.release, 'test-release');
  assert.deepEqual(event.tags, { where: 'socket game:answer' });
  assert.deepEqual(event.user, { id: '7' });
  const [exception] = event.exception.values;
  assert.deepEqual([exception.type, exception.value], ['TypeError', 'boom']);
  assert.ok(
    exception.stacktrace.frames.some((f: { filename: string }) => f.filename.endsWith('monitoring.test.ts')),
    'with frames',
  );
});

test('a stalled event loop is reported with how long it stalled; a short hold-up only goes to the log', async () => {
  received.length = 0;
  const [error, warn] = [console.error, console.warn];
  const warnings: string[] = [];
  console.error = () => {};
  console.warn = (message: string) => warnings.push(message);
  const stop = watchEventLoop({ everyMs: 400, logMs: 50, reportMs: 250 });
  const block = (ms: number) => {
    const until = performance.now() + ms;
    while (performance.now() < until);
  };
  try {
    await sleep(50);
    block(100); // a hold-up worth a look
    await sleep(900); // two periods: the sample may land in the one after
    assert.equal(received.length, 0, 'no report for it');
    assert.match(warnings.join('\n'), /held up for \d+ ms/);

    block(350); // every match frozen for a third of a second
    await sleep(900);
    assert.equal(received.length, 1);
    const event = lines(received[0].body)[2];
    assert.equal(event.exception.values[0].value, 'The event loop stalled');
    assert.ok(event.extra.worstMs >= 300, `worst ${event.extra.worstMs} ms`);
  } finally {
    stop();
    [console.error, console.warn] = [error, warn];
  }
});

test('the same error repeating is reported once, and a flood is capped', async () => {
  received.length = 0;
  const original = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < 5; i++) await reportError(new Error('same thing'), 'loop');
    for (let i = 0; i < 50; i++) await reportError(new Error(`different ${i}`), 'flood');
  } finally {
    console.error = original;
  }
  assert.equal(received.filter((r) => r.body.includes('same thing')).length, 1);
  assert.ok(received.length <= 20, `at most 20 a minute, got ${received.length}`);
});

test('the browser tunnel passes on envelopes for our project only', async () => {
  received.length = 0;
  const envelope = (dsn: string) => `${JSON.stringify({ dsn })}\n${JSON.stringify({ type: 'event' })}\n{}\n`;
  assert.equal(forwardEnvelope(envelope(DSN)), true);
  assert.equal(forwardEnvelope(envelope('https://other@evil.example/1')), false, 'never an open relay');
  assert.equal(forwardEnvelope('not json'), false);
  // A log line from a browser could pass for the server's own: accepted (no retries) and dropped, as is anything else.
  const log = `${JSON.stringify({ dsn: DSN })}\n${JSON.stringify({ type: 'log', item_count: 1 })}\n{"items":[]}\n`;
  assert.equal(forwardEnvelope(log), true);
  const replay = `${JSON.stringify({ dsn: DSN })}\n${JSON.stringify({ type: 'event' })}\n{}\n${JSON.stringify({ type: 'replay_event', length: 2 })}\n{}\n`;
  assert.equal(forwardEnvelope(replay), true);
  await sleep(200);
  assert.equal(received.length, 1, 'only the error report went on');
  assert.equal(received[0].url, '/api/42/envelope/');
});

/** The console's four methods replaced by a recorder (what stdout would have shown), for the length of `fn`. */
async function recording(fn: () => Promise<void>) {
  const methods = ['log', 'info', 'warn', 'error'] as const;
  const originals = methods.map((m) => console[m]);
  const said: string[] = [];
  for (const m of methods) console[m] = (...args: unknown[]) => void said.push(format(...args));
  try {
    await fn();
  } finally {
    for (const [i, m] of methods.entries()) console[m] = originals[i];
  }
  return said;
}

type LogItem = { level: string; body: string; trace_id: string; attributes: Record<string, { value: string }> };
const logItems = () =>
  received.flatMap(({ body }) => {
    const [, item, payload] = lines(body);
    assert.equal(item.type, 'log');
    assert.equal(item.item_count, payload.items.length);
    assert.equal(item.content_type, 'application/vnd.sentry.items.log+json');
    return payload.items as LogItem[];
  });

test('the server log goes to Sentry too, line by line as stdout shows it, without email or IP addresses, names or codes', async () => {
  received.length = 0;
  let stop: () => Promise<void> = async () => {};
  const said = await recording(async () => {
    stop = shipLogs();
    console.log('🗓️  Unused accounts: %d warned', 2);
    console.warn(
      'to ivan@example.com from 203.0.113.5 and 2001:db8::7 at /profile/Иван?x=1, /c/AbC and /daily/preview',
    );
    console.error('💥 %s:', 'GET /api/x', new TypeError('boom'));
    await stop();
    console.log('after the stop: stdout only');
  });
  assert.equal(said.length, 4, 'stdout gets every line, as before');
  assert.equal(said[0], '🗓️  Unused accounts: 2 warned');
  assert.equal(received.length, 1, 'one envelope for the lot');
  assert.equal(lines(received[0].body)[0].dsn, DSN);
  const items = logItems();
  assert.deepEqual(
    items.map((i) => i.level),
    ['info', 'warn', 'error'],
  );
  assert.equal(items[0].body, said[0]);
  assert.equal(items[1].body, 'to [email] from [ip] and [ip] at /profile/*, /c/* and /daily/preview');
  assert.match(items[2].body, /^💥 GET \/api\/x: TypeError: boom\n\s+at /, 'the stack, as stdout has it');
  assert.match(items[0].trace_id, /^[0-9a-f]{32}$/);
  assert.equal(new Set(items.map((i) => i.trace_id)).size, 1, "one run's lines read together");
  assert.equal(items[0].attributes['sentry.release'].value, 'test-release');
});

test('a flood of log lines is capped at 300 a minute, with a line saying how many were held back', async () => {
  received.length = 0;
  await recording(async () => {
    const stop = shipLogs();
    for (let i = 0; i < 400; i++) console.log(`line ${i}`);
    await stop();
  });
  const items = logItems();
  const sent = items.filter((i) => i.body.startsWith('line '));
  assert.ok(sent.length <= 300, `${sent.length} sent`);
  assert.ok(
    received.every(({ body }) => lines(body)[2].items.length <= 100),
    'at most 100 to an envelope',
  );
  assert.equal(items.at(-1)?.body, `📡 ${400 - sent.length} log line(s) held back: more than 300 a minute.`);
});

test('what stays in a log line: times, versions, paths that only count', () => {
  for (const line of [
    'at 2026-10-29T18:45:12.000Z, 12:30:45 Sofia',
    'Node v24.11.0, schema v27',
    '/groups/12 and /sets/7 and /api/daily/link',
  ])
    assert.equal(scrubLog(line), line);
  assert.equal(scrubLog('ECONNREFUSED 127.0.0.1:587'), 'ECONNREFUSED [ip]:587');
});

test('scrubbing takes time in line with the text, whatever it holds (a browser report is anyone’s text)', () => {
  const hostile = [
    '/'.repeat(200_000),
    '/c/'.repeat(70_000),
    'a@'.repeat(100_000),
    '1:'.repeat(100_000),
    'a'.repeat(200_000),
  ];
  for (const text of hostile) {
    const started = performance.now();
    scrubLog(text);
    const ms = performance.now() - started;
    assert.ok(ms < 250, `${text.slice(0, 6)}… took ${ms.toFixed(0)} ms`);
  }
});

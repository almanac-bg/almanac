// Error reports: server errors reach Sentry as envelopes, the browser's go through our tunnel (only to our own
// project), and a flood of errors can't use up the monthly quota. A fake Sentry endpoint stands in for the real one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
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
const { forwardEnvelope, reportError, watchEventLoop } = await import('../src/monitoring');

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
  await sleep(200);
  assert.equal(received.length, 1);
  assert.equal(received[0].url, '/api/42/envelope/');
});

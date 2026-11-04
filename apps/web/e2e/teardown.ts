import fs from 'node:fs';
import { serverErrors } from '../playwright.config';

/**
 * After the run: every error the server reported while the browser tests ran (ERROR_OUTBOX). One no test expected fails
 * the run, as a page's console error fails its test (support.ts): a 💥 in a socket handler would otherwise pass, unless
 * something on screen happened to show it.
 *
 * Expected in the WebKit and Firefox jobs only: a stalled event loop. Four of those browsers on a runner of four cores
 * take the CPU from the server for a second at a time — on 4 November, twice in the same shard, with every test passing,
 * while its four workers ran the desktop axe scans at once. The server's own hold-ups are still caught by the Chromium
 * job, which runs the same tests against the same server, and in production by the report itself.
 */
const EXPECTED: RegExp[] = process.env.E2E_ENGINES ? [/^💥 event loop: The event loop stalled\b/] : [];

export default function teardown() {
  if (!fs.existsSync(serverErrors)) return;
  const reported = fs
    .readFileSync(serverErrors, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { where: string; message: string; extra?: Record<string, unknown> })
    .map(({ where, message, extra }) => `💥 ${where}: ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}`);
  const unexpected = reported.filter((line) => !EXPECTED.some((p) => p.test(line)));
  // Expected or not, what was reported is said: a stall's length is worth seeing where it doesn't fail the run.
  for (const line of reported) if (!unexpected.includes(line)) console.warn(`(expected here) ${line}`);
  if (unexpected.length) throw new Error(`The server reported errors no test expected:\n${unexpected.join('\n')}`);
}

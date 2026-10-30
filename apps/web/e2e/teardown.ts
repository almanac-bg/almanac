import fs from 'node:fs';
import { serverErrors } from '../playwright.config';

/**
 * After the run: every error the server reported while the browser tests ran (ERROR_OUTBOX). One no test expected fails
 * the run, as a page's console error fails its test (support.ts): a 💥 in a socket handler would otherwise pass, unless
 * something on screen happened to show it.
 */
const EXPECTED: RegExp[] = [];

export default function teardown() {
  if (!fs.existsSync(serverErrors)) return;
  const unexpected = fs
    .readFileSync(serverErrors, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { where: string; message: string })
    .map(({ where, message }) => `💥 ${where}: ${message}`)
    .filter((line) => !EXPECTED.some((p) => p.test(line)));
  if (unexpected.length) throw new Error(`The server reported errors no test expected:\n${unexpected.join('\n')}`);
}

// The mark (the 31 October review, WEB-3 = VD-2 = COPY-5): the rosette wherever a player or an installer looks, never
// the retired bolt; the lockup drawn once (apps/web/scripts/lockup.mjs) and the same in every page that inlines it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { BRAND } from '@quiz/shared';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const INLINED = ['apps/web/index.html', 'apps/web/public/offline.html', 'deploy/Caddyfile'];

test('no page a player or an installer sees carries the retired bolt', () => {
  for (const file of [
    ...INLINED,
    'apps/web/public/cf-error.html',
    'apps/web/vite.config.ts',
    'apps/web/src/components/landing/Entry.tsx',
    'apps/server/src/index.ts',
    '.github/about/org-profile.md',
    '.github/about/description.txt',
  ]) {
    const text = read(file);
    assert.ok(!text.includes('M36 6 14 36'), `${file}: the bolt's path`);
    assert.ok(!text.includes('⚡'), `${file}: ⚡`);
    assert.ok(!/\bZap\b/.test(text), `${file}: lucide's Zap`);
  }
});

test('the brand lockup is drawn once, with the name, and inlined the same everywhere', () => {
  const lockup = read('apps/web/public/brand-lockup.svg').trim();
  assert.ok(lockup.includes(`aria-label="${BRAND.name}"`), 'the name it draws is the brand’s');
  for (const file of INLINED)
    assert.equal(
      /<!--lockup-->([\s\S]*?)<!--\/lockup-->/.exec(read(file))?.[1],
      lockup,
      `${file}: run npm run lockup -w @quiz/web`,
    );
});

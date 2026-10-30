// Writes the third-party notices the site and the image ship with (served at /licenses.txt, linked in the footer):
// every npm package the site or the server can include (the lockfile's packages that aren't development-only), with
// its licence text, and the fonts' and emoji's licences. A copy of what the licences ask to travel with the code.
//
//   node scripts/licenses.mjs <output file>      (the web build runs it: apps/web/dist/licenses.txt)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = process.argv[2];
if (!out) throw new Error('Usage: node scripts/licenses.mjs <output file>');

const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;
const rule = (title) => `${title}\n${'='.repeat([...title].length)}\n`;

const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const packages = new Map();
for (const [where, entry] of Object.entries(lock.packages)) {
  // Development-only tools, this repository's own workspaces, and optional ones for another platform aren't shipped.
  if (!where.startsWith('node_modules/') || entry.dev || entry.link) continue;
  const dir = path.join(root, where);
  if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const id = `${pkg.name}@${pkg.version}`;
  if (packages.has(id)) continue;
  const files = fs
    .readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f))
    .sort();
  const licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? entry.license ?? 'see below');
  const texts = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim());
  packages.set(id, { id, licence, texts });
}

const own = (file) => fs.readFileSync(path.join(root, file), 'utf8').trim();
const parts = [
  rule('АЛМАНАХ: third-party notices'),
  'АЛМАНАХ is free software under the GNU Affero General Public License, version 3 or later. It includes the work of',
  'others, under their own licences, which follow: the fonts, the emoji, and the npm packages in the site and the server.',
  '',
  rule('Onest (font)'),
  own('apps/web/src/fonts/OFL-onest.txt'),
  '',
  rule('Unbounded (font)'),
  own('apps/web/src/fonts/OFL-unbounded.txt'),
  '',
  rule('Fluent Emoji (pictures)'),
  own('apps/web/src/emoji/LICENSE'),
  '',
  rule(`npm packages (${packages.size})`),
];
for (const p of [...packages.values()].sort((a, b) => a.id.localeCompare(b.id))) {
  parts.push(
    `--- ${p.id} (${p.licence})`,
    '',
    ...(p.texts.length ? p.texts : ['(no licence file in the package)']),
    '',
  );
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, `${parts.join('\n').trimEnd()}\n`);
console.log(`${out}: notices for ${packages.size} packages, 2 fonts and the emoji`);

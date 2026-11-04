// The third-party notices the app ships with (Настройки → Лицензи): every npm package inside the app's bundle — read
// from the bundle's own source maps, so the list is what's in the app, not every tool the install brings — with its
// licence text, and the fonts'. The code that runs natively comes with those same packages (React Native, Expo's
// modules); the libraries the iOS and Android builds add on top of them are the build's to list (docs/app-stores.md).
// Written to src/settings/licenses.json; `--check` fails when that file is no longer what the bundle holds (CI).
//
//   npm run bundle && npm run licenses [-- --check]          (in apps/mobile)
import fs from 'node:fs';
import path from 'node:path';
import { readNotice } from '../../../scripts/notices.mjs';

const app = path.resolve(import.meta.dirname, '..');
const root = path.resolve(app, '../..');
const out = path.join(app, 'src/settings/licenses.json');
const check = process.argv.includes('--check');

const maps = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
    if (entry.isDirectory()) walk(path.join(dir, entry.name));
    else if (entry.name.endsWith('.map')) maps.push(path.join(dir, entry.name));
};
const dist = path.join(app, 'dist');
if (fs.existsSync(dist)) walk(dist);
if (!maps.length) throw new Error('No source maps in apps/mobile/dist: run `npm run bundle` first.');

// A source inside a package: everything up to its last node_modules/<name> (or <@scope/name>) is the package's folder.
// The bundle's paths start at the app's folder.
const dirs = new Set();
for (const map of maps)
  for (const source of JSON.parse(fs.readFileSync(map, 'utf8')).sources) {
    const at = source.lastIndexOf('node_modules/');
    if (at < 0) continue;
    const [first = '', second = ''] = source.slice(at + 'node_modules/'.length).split('/');
    const name = first.startsWith('@') ? `${first}/${second}` : first;
    dirs.add(path.join(app, source.slice(0, at), 'node_modules', name));
  }

// A package without a licence file of its own (React Native's and Expo's smaller packages, published from one
// repository): the licence of a package from the same repository that has one. None there either: the licence its
// package.json names, as its terms read, with its author — MIT's, the only one this has needed.
const repositoryOf = (pkg) =>
  (typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? ''))
    .replace(/^git\+/, '')
    .replace(/^(ssh:\/\/)?git@github\.com[:/]/, 'https://github.com/')
    .replace(/\.git$/, '')
    .toLowerCase();
const installed = [];
const scan = (modules) => {
  if (!fs.existsSync(modules)) return;
  for (const name of fs.readdirSync(modules)) {
    if (name.startsWith('.')) continue;
    const dir = path.join(modules, name);
    if (name.startsWith('@')) scan(dir);
    else if (fs.existsSync(path.join(dir, 'package.json'))) {
      installed.push(dir);
      scan(path.join(dir, 'node_modules'));
    }
  }
};
scan(path.join(app, 'node_modules'));
const byRepository = new Map();
for (const dir of installed) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const repo = repositoryOf(pkg);
  if (!repo || byRepository.has(repo)) continue;
  const { texts } = readNotice(dir);
  if (texts.length) byRepository.set(repo, texts);
}
const MIT = (holder) =>
  [
    'MIT License',
    '',
    `Copyright (c) ${holder}`,
    '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
    '',
    'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
  ].join('\n');
/** Repositories whose packages carry neither a licence file nor an author: who holds them (the repository's LICENSE). */
const HOLDERS = {
  'https://github.com/react/metro': 'Meta Platforms, Inc. and affiliates.',
};
function noticeOf(dir) {
  const notice = readNotice(dir);
  if (notice.texts.length) return notice;
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const repo = repositoryOf(pkg);
  // A package of a monorepo names its folder in it: the repository is the same one without it.
  const same = byRepository.get(repo);
  if (same) return { ...notice, texts: same };
  const author = HOLDERS[repo] ?? (typeof pkg.author === 'string' ? pkg.author : pkg.author?.name);
  if (notice.licence === 'MIT' && author) return { ...notice, texts: [MIT(author.split(/[<(]/)[0]?.trim() ?? author)] };
  throw new Error(`${notice.name}: no licence text found — add one here`);
}

const packages = new Map();
for (const dir of dirs) {
  const { name, licence, texts } = noticeOf(dir);
  // The same package twice (two versions in the bundle): one notice, with every text either one has.
  const known = packages.get(name);
  const all = [...new Set([...(known?.texts ?? []), ...texts])];
  packages.set(name, {
    name,
    licence: known && known.licence !== licence ? `${known.licence}, ${licence}` : licence,
    texts: all,
  });
}

const repository = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).repository?.url ?? '';
const notices = {
  // Where the app's own code is (AGPL-3.0-or-later): the screen links the tag of the version that's running.
  source: repository.replace(/^git\+/, '').replace(/\.git$/, ''),
  fonts: [
    { name: 'Onest', text: fs.readFileSync(path.join(root, 'apps/web/src/fonts/OFL-onest.txt'), 'utf8').trim() },
    {
      name: 'Unbounded',
      text: fs.readFileSync(path.join(root, 'apps/web/src/fonts/OFL-unbounded.txt'), 'utf8').trim(),
    },
  ],
  packages: [...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, licence, texts }) => ({
      name,
      licence,
      text: texts.join('\n\n'),
    })),
};
if (!notices.source.startsWith('https://')) throw new Error('The root package.json has no repository URL.');

const written = `${JSON.stringify(notices, null, 2)}\n`;
if (check) {
  const committed = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (committed !== written) {
    const before = new Map((committed ? JSON.parse(committed).packages : []).map((p) => [p.name, p]));
    const after = new Map(notices.packages.map((p) => [p.name, p]));
    const changed = [
      ...[...after.keys()].filter((n) => !before.has(n)).map((n) => `+ ${n}`),
      ...[...before.keys()].filter((n) => !after.has(n)).map((n) => `- ${n}`),
      ...[...after.keys()]
        .filter((n) => before.has(n) && JSON.stringify(before.get(n)) !== JSON.stringify(after.get(n)))
        .map((n) => `~ ${n}`),
    ];
    console.error(
      `src/settings/licenses.json is not what the bundle holds${changed.length ? `:\n${changed.join('\n')}` : ' (the source or the fonts)'}\nRun \`npm run bundle && npm run licenses\` in apps/mobile and commit it.`,
    );
    process.exit(1);
  }
  console.log(`src/settings/licenses.json: up to date (${notices.packages.length} packages, 2 fonts)`);
} else {
  fs.writeFileSync(out, written);
  console.log(`src/settings/licenses.json: ${notices.packages.length} packages, 2 fonts`);
}

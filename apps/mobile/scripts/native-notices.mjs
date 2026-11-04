// What a build holds natively against what Настройки → Лицензи lists (native-notices/notices.json): the iOS .app's
// frameworks and bundles, the Android .apk's (or .aab's) .so libraries and META-INF/*.version files. Whatever no notice
// covers — nor the npm packages' own (`covered`) — is named, and the run fails: a new native library came with an
// upgrade, and its licence belongs in the list before the build goes to the stores (docs/app-stores.md → Лицензите).
//
//   npm run native-notices -- path/to/АЛМАНАХ.app        (an iOS build, unzipped from its .ipa or a simulator's .tar.gz)
//   npm run native-notices -- path/to/build.apk           (or .aab)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [build] = process.argv.slice(2);
if (!build || !fs.existsSync(build)) {
  console.error('Usage: npm run native-notices -- <path to an .app, .apk or .aab>');
  process.exit(2);
}
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../native-notices/notices.json'), 'utf8'),
);

const ios = fs.statSync(build).isDirectory();
let items;
if (ios) {
  const frameworks = path.join(build, 'Frameworks');
  items = [
    ...(fs.existsSync(frameworks) ? fs.readdirSync(frameworks).filter((f) => f.endsWith('.framework')) : []),
    ...fs.readdirSync(build).filter((f) => f.endsWith('.bundle')),
  ];
} else {
  const entries = execFileSync('unzip', ['-Z1', build], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n');
  items = [
    ...entries.filter((e) => /(^|\/)lib\/[^/]+\/[^/]+\.so$/.test(e)).map((e) => path.basename(e)),
    ...entries.filter((e) => /(^|\/)META-INF\/[^/]+\.version$/.test(e)).map((e) => path.basename(e, '.version')),
  ];
}
items = [...new Set(items)].sort();

const covered = manifest.covered.map((r) => new RegExp(r));
const listed = manifest.notices.flatMap((n) => n.match.map((r) => ({ name: n.name, re: new RegExp(r) })));
const unlisted = items.filter((item) => !covered.some((re) => re.test(item)) && !listed.some((l) => l.re.test(item)));

console.log(
  `${ios ? 'iOS' : 'Android'} build: ${items.length} native parts, ${items.length - unlisted.length} covered.`,
);
if (unlisted.length) {
  console.error(
    `Not in native-notices/notices.json — add each library with its licence, then \`npm run licenses\`:\n${unlisted.map((i) => `  ${i}`).join('\n')}`,
  );
  process.exit(1);
}

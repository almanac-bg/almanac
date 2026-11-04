// A dynamic import() in a development build is a bundle of its own, which Metro serves by the file's path under the
// app's folder. The shared code (packages/) lies outside it — the app is no workspace of the root's, so Metro's root is
// apps/mobile — and its path comes out wrong: "Unable to resolve module ./packages/client/src/index", and an app that
// starts signed in never starts (4 November 2026, the first run on a phone). A store build inlines every import, so
// only development broke, and no test of the screens could see it. Hence: the shared code only ever imported as such.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Every `import('…')` in a file, with what it imports. */
function dynamicImports(file: string) {
  const code = fs.readFileSync(file, 'utf8');
  return [...code.matchAll(/(?<![\w.])import\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
}

test('the app imports the shared code statically, never with import()', () => {
  const found = sources(path.join(root, 'apps/mobile/src')).flatMap((file) =>
    dynamicImports(file)
      .filter((spec) => spec.startsWith('@almanac/'))
      .map((spec) => `${path.relative(root, file)}: import('${spec}')`),
  );
  expect(found).toEqual([]);
});

test('the shared code imports with import() only packages the app installs, never a file of its own', () => {
  const found = ['packages/client/src', 'packages/shared/src'].flatMap((dir) =>
    sources(path.join(root, dir)).flatMap((file) =>
      dynamicImports(file)
        .filter((spec) => spec.startsWith('.') || spec.startsWith('@almanac/'))
        .map((spec) => `${path.relative(root, file)}: import('${spec}')`),
    ),
  );
  expect(found).toEqual([]);
});

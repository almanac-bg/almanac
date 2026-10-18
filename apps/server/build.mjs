// Bundles the server (and the shared package) into one ESM file that runs on plain Node — no tsx in production.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = import.meta.dirname;
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });

await build({
  entryPoints: [path.join(root, 'src/index.ts')],
  outfile: path.join(out, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // ws probes these optional native speedups inside try/catch.
  external: ['bufferutil', 'utf-8-validate'],
  // CommonJS dependencies bundled into ESM still call require() for Node built-ins.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});

// The question bank is read from disk next to the bundle (see questions.ts).
fs.mkdirSync(path.join(out, 'data'), { recursive: true });
fs.copyFileSync(path.join(root, 'src/data/questions.json'), path.join(out, 'data/questions.json'));

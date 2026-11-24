// The game is for the browsers cmd/build names (its Engines). tsc's lib holds the language to ES2023, but its DOM types
// are the newest browsers', so a DOM member newer than those engines passes every check: URLSearchParams.size (Safari
// 17) left every page link of a chapter pointing at page 1 on iOS 16 (the audit of 2026-11-24). Each member here is
// one the engines lack; a use of one needs a guard (`typeof x === "function"`) and a line in `guarded`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("../..", import.meta.url).pathname;

test("the build's engines are the ones this list was written for", () => {
  const build = readFileSync(join(root, "cmd/build/main.go"), "utf8");
  const engines = [...build.matchAll(/Name: api\.Engine(\w+), Version: "([\d.]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  // Lowering one: look again at what's below, then change both.
  assert.deepEqual(engines, ["Chrome 111", "Firefox 121", "Safari 16.4"]);
});

// What the engines lack, as text a use of it would show, and the first versions that have it.
const newer: [RegExp, string][] = [
  [/\bURL\.(canParse|parse)\(/, "Safari 17, Chrome 120"],
  [/\.checkVisibility\(/, "Safari 17.4, Chrome 121"],
  [/\.startViewTransition\(/, "Safari 18, Firefox 144"],
  [/\.(showPopover|hidePopover|togglePopover)\(/, "Safari 17, Chrome 114, Firefox 125"],
  [/\bAbortSignal\.any\(/, "Safari 17.4, Chrome 116, Firefox 124"],
  [/\bCloseWatcher\b/, "not in Safari or Firefox"],
  [/["']scrollend["']/, "not in Safari"],
];
// A use behind a test of its own, by file and the text it guards.
const guarded = new Set<string>([]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|js)$/.test(e.name) && !e.name.endsWith(".test.ts") ? [path] : [];
  });
}

test("the client uses nothing its engines lack", () => {
  const files = [...sources(join(root, "web/src")), ...sources(join(root, "web/public"))];
  assert.ok(files.length > 30, `only ${files.length} files found: the check no longer reads the client?`);
  const found: string[] = [];
  for (const path of files) {
    const file = path.slice(root.length);
    const text = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    // URLSearchParams.size (Safari 17, Chrome 113): by the names a search is kept in, as a type can't be read here.
    const searches = [...text.matchAll(/\b(\w+) = new URLSearchParams\b/g)].map((m) => m[1]);
    for (const name of searches)
      if (new RegExp(`\\b${name}\\.size\\b`).test(text)) found.push(`${file}: ${name}.size (Safari 17)`);
    for (const [pattern, since] of newer) {
      const m = text.match(pattern);
      if (m && !guarded.has(`${file} ${m[0]}`)) found.push(`${file}: ${m[0]} (${since})`);
    }
  }
  assert.deepEqual(
    [...new Set(found)],
    [],
    "the build's engines lack these: use something older, or guard it and list it",
  );
});

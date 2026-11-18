// A screen never waits with a bare „…“ (DESIGN.md, Waiting): every wait is ui.ts's loading(), in the shape of what
// comes, which the router knows to wait for (lib/router.ts, ready). A text that is only „…“ (or "...") anywhere in the
// client fails here; e2e/moves.spec.ts holds the same in a real browser, frame by frame.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const src = import.meta.dirname;

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* sources(path);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) yield path;
  }
}

/** A string that is nothing but dots: „…“, "...", or either with spaces around. */
const dots = /(["'`])\s*(…|\.\.\.)\s*\1/;

test("no screen waits with a bare „…“: every wait is loading(), in the shape of what comes", () => {
  const found: string[] = [];
  for (const file of sources(src)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        // A spread („...rest“) is code, not a text; only a quoted string of dots is one.
        if (dots.test(line)) found.push(`${relative(src, file)}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(found, [], `a wait drawn as „…“; draw it with loading() (ui.ts) instead:\n${found.join("\n")}`);
});

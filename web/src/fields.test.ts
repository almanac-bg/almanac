// No field asks the browser for a player's full name (autocomplete "name"): the names here are seen by strangers, and
// a class told „write your name“ would get every pupil's full legal name filled in. A name field is a nickname, or
// nothing the browser fills in.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..", "..");

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* files(path);
    else if (/\.(ts|html)$/.test(e.name) && !e.name.endsWith(".test.ts")) yield path;
  }
}

test("no field asks the browser for a full name", () => {
  const found: string[] = [];
  for (const place of ["web/src", "web/public"])
    for (const path of files(place))
      readFileSync(join(root, path), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/autocomplete\s*[:=]\s*["'](?:[\w-]+\s+)*(?:name|given-name|family-name|additional-name)["']/.test(line))
            found.push(`${path}:${i + 1}: ${line.trim()}`);
        });
  assert.deepEqual(found, []);
});

// No field asks the browser to check it (required, pattern, minlength): the browser says what's wrong in its own bubble,
// in its own language (English as often as not), and the forms are made not to ask (lib/dom.ts, noValidate). A form says
// what's missing in the game's words, in its alert line, and puts the cursor in the field (game/report.ts).
test("no field asks the browser to check it", () => {
  const found: string[] = [];
  for (const path of files("web/src"))
    readFileSync(join(root, path), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*["']?(required|pattern|minlength)["']?\s*:/.test(line)) found.push(`${path}:${i + 1}: ${line.trim()}`);
      });
  assert.deepEqual(found, []);
});

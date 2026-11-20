// A screen that loads on its own (kit.ts) names the app's pieces it uses twice: declared at the top (`let { … } = {} as
// Kit`), and set as it opens (`({ … } = kit)`). A piece in the first list and not the second is undefined at run time,
// with no type error to say so (a verdict threw on it once): the two lists are the same.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const screens = join(import.meta.dirname, "screens");

const names = (list: string) =>
  list
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .sort();

test("each screen sets every piece of the kit it declares", () => {
  let checked = 0;
  for (const file of readdirSync(screens)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const src = readFileSync(join(screens, file), "utf8");
    const declared = /let \{([^}]*)\} = \{\} as Kit;/.exec(src);
    if (!declared) continue;
    const set = /\(\{([^}]*)\}\s*=\s*kit\);/.exec(src);
    assert.ok(set, `${file}: declares the kit's pieces, never sets them`);
    assert.deepEqual(names(set[1] ?? ""), names(declared[1] ?? ""), `${file}: the two lists differ`);
    checked++;
  }
  assert.ok(checked >= 8, `only ${checked} screens checked: the pattern changed?`);
});

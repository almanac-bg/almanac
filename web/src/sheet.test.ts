import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// A sheet built by hand, outside a scope, kept every effect it made for as long as the page was open (the avatars'
// sheet, 15 at each opening): every sheet is ui.ts's sheet(), which builds it in a scope of its own and ends it.
test("every sheet over the page is made by sheet()", () => {
  const src = import.meta.dirname;
  for (const file of readdirSync(src, { recursive: true }) as string[]) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file === "ui.ts") continue;
    assert.doesNotMatch(readFileSync(join(src, file), "utf8"), /h\(\s*"dialog"/, `${file}: a <dialog> by hand`);
  }
});

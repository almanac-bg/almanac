// A touch screen keeps :hover on what was tapped last, so after a tap two places in the bar looked current and rows
// looked chosen: every :hover in the style is inside `@media (hover: hover) and (pointer: fine)`, where a pointer
// really hovers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("every :hover is only where a pointer hovers", () => {
  const open: string[] = []; // the preludes of the blocks we're in
  let prelude = "";
  const loose: string[] = [];
  let seen = 0;
  for (const ch of css) {
    if (ch === "{") {
      const p = prelude.trim();
      if (p.includes(":hover")) {
        seen++;
        if (!open.some((o) => o.startsWith("@media") && o.includes("(hover: hover) and (pointer: fine)")))
          loose.push(p);
      }
      open.push(p);
      prelude = "";
    } else if (ch === "}") {
      open.pop();
      prelude = "";
    } else if (ch === ";") prelude = "";
    else prelude += ch;
  }
  assert.ok(seen >= 10, `only ${seen} :hover rules found: the check no longer reads the style?`);
  assert.deepEqual(loose, [], "wrap these in @media (hover: hover) and (pointer: fine)");
});

// Text under the body's size has its roles (DESIGN.md, Type): a sentence under a thing (--t-note), a short label
// (--t-label), a compact card's fine print (--t-fine), each one look wherever it is. A rule that draws such text in a
// size and weight of its own, beside them, is how „a note“ came to be six looks at once: it fails here. What stays
// literal: a control's words (800 and up), a number's unit beside its figure (line 1: „от 10“), a picture's tag
// (0.75rem: a seal's ink, a ladder's names, the spread's average).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

test("small text takes its role, never a look of its own", () => {
  const own = [...css.matchAll(/font: (\d+) ([\d.]+)rem \/ ([\d.]+(?:rem)?) var\(--font-sans\)/g)]
    .filter(([, weight, size, line]) => Number(weight) < 800 && Number(size) < 1 && line !== "1" && size !== "0.75")
    .map(([declaration]) => declaration);
  assert.deepEqual(own, []);
});

test("the roles are set once, with the page's other tokens", () => {
  for (const role of ["note", "label", "fine"])
    assert.equal(css.match(new RegExp(`--t-${role}:`, "g"))?.length, 1, `--t-${role}`);
});

test("no text is drawn under 12px", () => {
  const tiny = [...css.matchAll(/font(?:-size)?: (?:\d+ )?(0\.[0-6]\d*)rem/g)].map(([declaration]) => declaration);
  assert.deepEqual(tiny, []);
});

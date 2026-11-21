// Every avatar the server knows (internal/play: Shapes) is drawn, named and has its natural colours in the client,
// and the client offers no other.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pictures } from "./pictures.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** The play package's Go source, its tests left out. */
const play = () =>
  readdirSync(join(root, "internal/play"))
    .filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"))
    .map((f) => read(join("internal/play", f)))
    .join("\n");

/** The ids in a Go list: `Name = []string{...}`, or `Name = append(slices.Clone(Other), ...)`. */
function goList(src: string, name: string): string[] {
  const ids = (s = "") => [...s.matchAll(/"([a-z]+)"/g)].map((x) => x[1] ?? "");
  const more = new RegExp(`\\b${name}\\s*=\\s*append\\(slices\\.Clone\\((\\w+)\\),([^)]*)\\)`).exec(src);
  if (more) return [...goList(src, more[1] ?? ""), ...ids(more[2])];
  const m = new RegExp(`\\b${name}\\s*=\\s*\\[\\]string\\{([^}]*)\\}`).exec(src);
  assert.ok(m, `${name} in internal/play`);
  return ids(m[1]);
}

test("every avatar is drawn and named, and the choice offers no other", () => {
  const go = play();
  const ui = read("web/src/ui.ts");
  const css = read("web/src/app.css");
  const animals = goList(go, "Shapes");
  assert.equal(animals.length, 15);
  for (const s of animals) {
    assert.ok(pictures[s], `${s} isn't drawn in art/pictures.ts`);
    assert.match(ui, new RegExp(`\\n  ${s}: "`), `${s} has no name in ui.ts shapeNames`);
    assert.match(
      css,
      new RegExp(`\\.tone-natural\\.sh-${s} \\.avatar-pic \\{`),
      `${s} has no natural colours in app.css`,
    );
    // A part's own colour is an ink with a name (ka, kb; la the first as a stroke), set with the shape's others.
    const inks = new RegExp(`\\.tone-natural\\.sh-${s} \\.avatar-pic \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    for (const [ink, uses] of [
      ["ka", /class="[kl]a"/],
      ["kb", /class="kb"/],
    ] as const)
      if (uses.test(pictures[s] ?? "")) assert.match(inks, new RegExp(`--${ink}: #`), `${s} paints with ${ink}`);
  }
  // Each animal on a tile of its own colour, none repeated, so that two players' faces never share a ground.
  const tiles = animals.map(
    (s) => new RegExp(`\\.tone-natural\\.sh-${s} \\{\\s*--tone: (#[0-9a-f]{6});`).exec(css)?.[1],
  );
  for (const [i, s] of animals.entries()) assert.ok(tiles[i], `${s} has no tile colour of its own in app.css`);
  assert.equal(new Set(tiles).size, animals.length, `the animals' tiles repeat a colour: ${tiles.join(" ")}`);
  // Never by a part's place among the picture's layers: the next change to the drawing would colour another part.
  assert.doesNotMatch(css, /avatar-pic\s*>\s*:nth-/, "an avatar's part is coloured by its ink, not by :nth-child");
  const named = ui.slice(ui.indexOf("export const shapeNames"), ui.indexOf("const freeShapes"));
  const names = [...named.matchAll(/\n {2}([a-z]+): "/g)].map((m) => m[1] ?? "");
  assert.deepEqual(names, animals, "shapeNames are the server's animals, in its order");
});

// The server draws a shared day's card (internal/card) in Go, from the chapters' glyphs as pictures.ts draws them:
// kept in internal/card/glyphs.json, written again by WRITE_GLYPHS=1 npm test, and held equal here. The chapters are
// app.css's, each with its colour by day (--t-<id>).
test("the server's card has the chapters' glyphs as pictures.ts draws them", () => {
  const css = read("web/src/app.css");
  const day = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));
  const ids = [...day.matchAll(/--t-(\w+): #/g)].map((m) => m[1] ?? "");
  assert.ok(ids.length >= 10, "app.css has the chapters' colours");
  const glyphs = Object.fromEntries(
    ids.map((id) => [id, pictures[`topic-${id}`] ?? assert.fail(`no picture for ${id}`)]),
  );
  const want = `${JSON.stringify(glyphs, null, 2)}\n`;
  const file = join(root, "internal/card/glyphs.json");
  if (process.env.WRITE_GLYPHS) writeFileSync(file, want);
  assert.equal(read("internal/card/glyphs.json"), want, "internal/card/glyphs.json is old: WRITE_GLYPHS=1 npm test");
});

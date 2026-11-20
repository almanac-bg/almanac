// Every avatar the server knows (internal/play: Shapes) is drawn, named and has its natural colours in the client,
// and the client offers no other; every division is drawn.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
      new RegExp(`\\.tone-natural\\.sh-${s} > \\.avatar-pic \\{`),
      `${s} has no natural colours in app.css`,
    );
  }
  const named = ui.slice(ui.indexOf("export const shapeNames"), ui.indexOf("export const toneNames"));
  const names = [...named.matchAll(/\n {2}([a-z]+): "/g)].map((m) => m[1] ?? "");
  assert.deepEqual(names, animals, "shapeNames are the server's animals, in its order");
  const tones = ui.slice(ui.indexOf("export const toneNames"), ui.indexOf("const freeShapes"));
  const toned = [...tones.matchAll(/\n {2}([a-z]+): "/g)].map((m) => m[1] ?? "");
  assert.deepEqual(toned, goList(go, "Tones"), "toneNames are the server's tones, in its order");
});

test("every division is drawn", () => {
  for (const d of ["bronze", "silver", "gold", "platinum", "diamond", "legend"])
    assert.ok(pictures[`division-${d}`], `division ${d}`);
});

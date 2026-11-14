// Every avatar the server knows (internal/play: FreeShapes, Unlockable) is drawn, and has a name in the client.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pictures } from "./pictures.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** The ids in a Go `Name = []string{...}` list. */
function goList(src: string, name: string): string[] {
  const m = new RegExp(`${name}\\s*=\\s*\\[\\]string\\{([^}]*)\\}`).exec(src);
  assert.ok(m, `${name} in progress.go`);
  return [...(m[1] ?? "").matchAll(/"([a-z]+)"/g)].map((x) => x[1] ?? "");
}

test("every avatar is drawn and named", () => {
  const go = read("internal/play/progress.go");
  const ui = read("web/src/ui.ts");
  const shapes = [...goList(go, "FreeShapes"), ...goList(go, "Unlockable")];
  assert.ok(shapes.length > 30);
  for (const s of shapes) {
    assert.ok(pictures[s], `${s} isn't drawn in art/pictures.ts`);
    assert.match(ui, new RegExp(`\\n  ${s}: "`), `${s} has no name in ui.ts shapeNames`);
  }
});

test("every frame and division is drawn", () => {
  const wardrobe = read("internal/play/wardrobe.go");
  const frames = wardrobe.slice(wardrobe.indexOf("var Frames"), wardrobe.indexOf("var Backdrops"));
  for (const [, id] of frames.matchAll(/\{"([a-z0-9]+)", "/g)) assert.ok(pictures[`frame-${id}`], `frame ${id}`);
  for (const d of ["bronze", "silver", "gold", "platinum", "diamond", "legend"])
    assert.ok(pictures[`division-${d}`], `division ${d}`);
});

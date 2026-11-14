// Every avatar the server knows (internal/play: FreeShapes, Unlockable) is drawn and has a name in the client; every
// achievement's picture, medal, frame and division is drawn.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { medalPictures } from "./badge.ts";
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
  assert.ok(shapes.length >= 20);
  for (const s of shapes) {
    assert.ok(pictures[s], `${s} isn't drawn in art/pictures.ts`);
    assert.match(ui, new RegExp(`\\n  ${s}: "`), `${s} has no name in ui.ts shapeNames`);
  }
});

test("every achievement has a picture of its own, and every medal is drawn", () => {
  const go = read("internal/play/progress.go");
  const list = go.slice(go.indexOf("var Achievements"), go.indexOf("func achievementByID"));
  const ids = [...list.matchAll(/\{"([a-zA-Z0-9]+)", "/g)].map((m) => m[1] ?? "");
  assert.ok(ids.length >= 20);
  const seen = new Set<string>();
  for (const id of ids) {
    const p = medalPictures[id];
    assert.ok(p && pictures[p], `${id} has no picture drawn for its medal (art/badge.ts)`);
    assert.ok(!seen.has(p), `${p} is on two medals`);
    seen.add(p);
  }
  for (const tier of ["common", "rare", "epic", "legendary"]) assert.ok(pictures[`badge-${tier}`], `badge ${tier}`);
});

test("every frame and division is drawn", () => {
  const wardrobe = read("internal/play/wardrobe.go");
  const frames = wardrobe.slice(wardrobe.indexOf("var Frames"), wardrobe.indexOf("var Backdrops"));
  for (const [, id] of frames.matchAll(/\{"([a-z0-9]+)", "/g)) assert.ok(pictures[`frame-${id}`], `frame ${id}`);
  for (const d of ["bronze", "silver", "gold", "platinum", "diamond", "legend"])
    assert.ok(pictures[`division-${d}`], `division ${d}`);
});

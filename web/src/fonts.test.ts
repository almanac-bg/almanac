// The fonts: each family's first file holds all a page of Bulgarian needs, so such a page asks for one file of each
// family it shows, never two; the second holds the rest, and the style says which is which with the very ranges the
// files were cut to (fonts/subset.sh).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");
const script = readFileSync(new URL("./fonts/subset.sh", import.meta.url), "utf8");

/** The code points of a unicode-range ("U+0020-007E, U+00A0"). */
function points(range: string): Set<number> {
  const out = new Set<number>();
  for (const part of range.split(",")) {
    const [from = "", to = from] = part.trim().replace(/^U\+/, "").split("-");
    for (let c = Number.parseInt(from, 16); c <= Number.parseInt(to, 16); c++) out.add(c);
  }
  return out;
}

/** The ranges the script cuts a file to, by its variable's name. */
function cut(name: string): string {
  const m = script.match(new RegExp(`^${name}="([^"]+)"`, "m"));
  assert.ok(m?.[1], `subset.sh has no ${name}=`);
  return m[1].replace(/\\\n/g, "").replace(/,/g, ", ");
}

// A face is a family in a style: Literata's roman and its italic are two faces, each with its own two files.
const faces = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map(([, body = ""]) => ({
  family: `${body.match(/font-family: "([^"]+)"/)?.[1] ?? ""} ${body.match(/font-style: ([a-z]+)/)?.[1] ?? "normal"}`,
  file: body.match(/url\("\.\/fonts\/([a-z-]+)\.woff2"\)/)?.[1] ?? "",
  range: (body.match(/unicode-range:\s*([^;]+);/)?.[1] ?? "").replace(/\s+/g, " ").trim(),
}));

test("each face is a file for Bulgarian and one for the rest, with the ranges they were cut to", () => {
  const families = new Set(faces.map((f) => f.family));
  assert.ok(families.size >= 4, "the style has fewer font faces than it did: change this test with it");
  for (const family of families) {
    const files = faces.filter((f) => f.family === family);
    assert.equal(files.length, 2, `${family}: ${files.length} files`);
    const [main, rest] = files;
    assert.ok(main && rest);
    assert.ok(rest.file === `${main.file}-rest`, `${family}: ${main.file}, ${rest.file}`);
    assert.equal(main.range, cut("main"), `${family}: the first file's range isn't the one subset.sh cuts it to`);
    assert.equal(rest.range, cut("rest"), `${family}: the second file's range isn't the one subset.sh cuts it to`);
  }
});

test("a page of Bulgarian needs only the first file of a family, and no character is in both", () => {
  const main = points(cut("main"));
  const rest = points(cut("rest"));
  for (const c of main) assert.ok(!rest.has(c), `U+${c.toString(16).toUpperCase()} is in both files`);
  const bulgarian =
    "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯабвгдежзийклмнопрстуфхцчшщъьюяѝ " +
    "0123456789 .,:;!?()[]%+-=/*&@#'\"„“–—…№·°×−€   ABCxyz";
  for (const ch of bulgarian) {
    const c = ch.codePointAt(0) ?? 0;
    assert.ok(main.has(c), `„${ch}“ (U+${c.toString(16).toUpperCase()}) isn't in the first file`);
  }
});

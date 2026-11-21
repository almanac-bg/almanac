// Where a chapter stands (ui.ts, standing), in words and as a bar: the rank held (none before a first seal) and what's
// left to the next, past Летопис as well; and the bar filled for the chapter's ink out of the next rank's (past Летопис,
// within its hundred), never the whole while the next isn't held. Its colours hold their contrast: the bar's fill
// against its track and the page, by day and by night, and on a chapter's sheet.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The page ui.ts loads into, as little of it as it reads as it loads.
Object.assign(globalThis, {
  location: { pathname: "/", search: "", hash: "" },
  document: { addEventListener: () => {}, getElementById: () => null, documentElement: { dataset: {} } },
});
const { standingWords, wayOf } = await import("./ui.ts");

const at = (level: number, ink: number, from: number, nextAt: number) => ({
  chapter: "history",
  level,
  ink,
  from,
  nextAt,
});

test("the words say the rank held and what's left to the next", () => {
  const sp = (s: string) => s.replaceAll(" ", " ");
  assert.deepEqual(standingWords(at(2, 7, 5, 15)).map(sp), ["Страница", "още 8 до „Тетрадка“"]);
  assert.deepEqual(standingWords(at(1, 1, 1, 5)).map(sp), ["Бележка", "още 4 до „Страница“"]);
  assert.deepEqual(standingWords(at(0, 0, 0, 1)).map(sp), ["Още без печат", "още 1 до „Бележка“"]);
  assert.deepEqual(standingWords(at(6, 250, 250, 350)).map(sp), ["Летопис", "още 100 до „Летопис · 2“"]);
  assert.deepEqual(standingWords(at(7, 413, 350, 450)).map(sp), ["Летопис · 2", "още 37 до „Летопис · 3“"]);
  // The next rank's ink reached but not yet counted (a day's count holds it): one still to come, never none.
  assert.deepEqual(standingWords(at(3, 40, 15, 40)).map(sp), ["Тетрадка", "още 1 до „Книга“"]);
  // The next rank's name never breaks inside it.
  assert.ok(standingWords(at(7, 413, 350, 450))[1]?.includes("Летопис · 3"));
});

test("the bar is the ink out of the next rank's, in the words' own units", () => {
  // 1 of 5, 40 of 100: never empty just past a rank, so a first ink shows on the bar.
  assert.equal(wayOf(at(1, 1, 1, 5)), 0.2);
  assert.equal(wayOf(at(4, 40, 40, 100)), 0.4);
  assert.equal(wayOf(at(2, 5, 5, 15)), 1 / 3);
  assert.equal(wayOf(at(2, 10, 5, 15)), 2 / 3);
  assert.equal(wayOf(at(6, 300, 250, 350)), 300 / 350);
  assert.equal(wayOf(at(0, 0, 0, 1)), 0);
  // Held at one to come: as the words say it, never full.
  assert.equal(wayOf(at(3, 45, 15, 40)), 39 / 40);
  // A rank never falls, though its ink may (a fact found untrue): the bar is the ink as it is.
  assert.equal(wayOf(at(4, 30, 40, 100)), 0.3);
});

test("past Летопис, each rank a further hundred, the bar is the ink within its hundred", () => {
  assert.equal(wayOf(at(7, 413, 350, 450)), 0.63);
  assert.equal(wayOf(at(7, 350, 350, 450)), 0);
  assert.equal(wayOf(at(8, 499, 450, 550)), 0.49);
  // Held at one to come, and ink fallen under its rank's: never full, never less than empty.
  assert.equal(wayOf(at(7, 460, 350, 450)), 0.99);
  assert.equal(wayOf(at(8, 440, 450, 550)), 0);
});

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+): (#[0-9a-f]{6});/g)].map((m) => [m[1] ?? "", m[2] ?? ""]),
  );
}

const dayAt = css.indexOf(":root {");
const day = tokens(css.slice(dayAt, css.indexOf("@media (prefers-color-scheme: dark)", dayAt)));
const nightAt = css.indexOf(':root[data-scheme="night"] {\n    --bg');
const night = { ...day, ...tokens(css.slice(nightAt, css.indexOf("}", nightAt))) };

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const luminance = (c: number[]) =>
  [0.2126, 0.7152, 0.0722].reduce((sum, k, i) => {
    const v = (c[i] ?? 0) / 255;
    return sum + k * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  }, 0);
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
};
const mix = (a: number[], b: number[], share: number) =>
  a.map((v, i) => (v * share + (b[i] ?? 0) * (100 - share)) / 100);

/** The share of the fill a track takes in a rule (`color-mix(in srgb, <fill> N%, transparent)`). */
function trackShare(selector: string): number {
  const rule = css.slice(css.indexOf(`${selector} {`));
  return Number(
    /background: color-mix\(in srgb, [^ ]+ (\d+)%, transparent\)/.exec(rule.slice(0, rule.indexOf("}")))?.[1],
  );
}

const chapters = Object.keys(day)
  .filter((k) => k.startsWith("d-"))
  .map((k) => k.slice(2));

for (const [name, t] of [
  ["day", day],
  ["night", night],
] as const) {
  test(`${name}: the bar's fill holds 3:1 on the page and its track, in every chapter's colour`, () => {
    const share = trackShare(".standing-bar");
    assert.ok(share > 0, "no track for .standing-bar");
    assert.ok(chapters.length >= 10);
    for (const ch of chapters)
      for (const ground of ["bg", "surface"]) {
        const fill = rgb(t[`d-${ch}`] ?? "");
        const g = rgb(t[ground] ?? "");
        const page = contrast(fill, g);
        const track = contrast(fill, mix(fill, g, share));
        assert.ok(page >= 3, `${name}: ${ch}'s bar on --${ground} is ${page.toFixed(2)}`);
        assert.ok(track >= 3, `${name}: ${ch}'s bar on its track on --${ground} is ${track.toFixed(2)}`);
      }
  });

  test(`${name}: on a chapter's sheet the bar is the sheet's ink, 3:1 on its track`, () => {
    const share = trackShare(".leaf .standing-bar");
    assert.ok(share > 0, "no track for .leaf .standing-bar");
    const ink = rgb("#16132b");
    for (const ch of chapters) {
      const sheet = rgb(t[`s-${ch}`] ?? "");
      const c = contrast(ink, mix(ink, sheet, share));
      assert.ok(c >= 3, `${name}: the bar on ${ch}'s sheet is ${c.toFixed(2)}`);
    }
  });
}

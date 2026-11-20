// The look's colours hold their contrast in both themes (DESIGN.md, Colour): text 4.5:1 on the page and its surfaces,
// a control's line 3:1, and the dark ink on every chapter's large sheet 4.5:1, by day and by night (a sheet is darkened
// by night only as far as that holds). And a screen's order is its HTML's: no `order` reorders what a screen reads out
// (the budgets are held in HTML order: e2e/fit.spec.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

/** The tokens a block sets: its `--name: #hex;` lines. */
function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+): (#[0-9a-f]{6});/g)].map((m) => [m[1] ?? "", m[2] ?? ""]),
  );
}

const dayAt = css.indexOf(":root {");
const day = tokens(css.slice(dayAt, css.indexOf("@media (prefers-color-scheme: dark)", dayAt)));
const nightAt = css.indexOf(':root[data-scheme="night"] {\n    --bg');
const night = { ...day, ...tokens(css.slice(nightAt, css.indexOf("}", nightAt))) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
}

const chapters = [
  "general",
  "science",
  "history",
  "geography",
  "movies",
  "music",
  "sports",
  "technology",
  "literature",
  "nature",
  "mix",
  "bulgaria",
];

for (const [name, t] of [
  ["day", day],
  ["night", night],
] as const) {
  test(`${name}: text holds 4.5:1 on the page and its surfaces, and a control's line 3:1`, () => {
    for (const ground of ["bg", "surface", "surface-2"])
      for (const text of ["ink", "ink-2", "ink-3", "grey"]) {
        const c = contrast(t[text] ?? "", t[ground] ?? "");
        assert.ok(c >= 4.5, `${name}: --${text} on --${ground} is ${c.toFixed(2)}`);
      }
    for (const ground of ["bg", "surface"]) {
      const c = contrast(t["line-2"] ?? "", t[ground] ?? "");
      assert.ok(c >= 3, `${name}: --line-2 on --${ground} is ${c.toFixed(2)}`);
    }
    const c = contrast(t["on-action"] ?? "", t.action ?? "");
    assert.ok(c >= 4.5, `${name}: the action's text is ${c.toFixed(2)}`);
  });

  test(`${name}: the ink on every chapter's sheet holds 4.5:1`, () => {
    for (const ch of chapters) {
      const sheet = t[`s-${ch}`];
      assert.ok(sheet, `${name}: no --s-${ch}`);
      const c = contrast(t["on-sheet"] ?? "", sheet);
      assert.ok(c >= 4.5, `${name}: ink on ${ch}'s sheet is ${c.toFixed(2)}`);
    }
  });
}

/** How much darker a sheet is by night than its chapter's vivid: the share of each channel kept. */
function kept(ch: string): number {
  const ch3 = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [a, b] = [ch3(day[`t-${ch}`] ?? ""), ch3(night[`s-${ch}`] ?? "")];
  const i = a.indexOf(Math.max(...a));
  return (b[i] ?? 0) / (a[i] ?? 1);
}

test("by night a light chapter's sheet is darker by a fifth, the four deep ones' by 12% at most", () => {
  const deep = ["history", "geography", "movies", "music"];
  for (const ch of chapters) {
    const k = kept(ch);
    if (deep.includes(ch)) assert.ok(k >= 0.875 && k < 1, `${ch}: ${k.toFixed(3)}`);
    else assert.ok(Math.abs(k - 0.8) < 0.01, `${ch}: ${k.toFixed(3)}`);
  }
});

test("no stylesheet reorders a screen: what's read is in the HTML's order", () => {
  for (const sheet of ["app.css", "outcome.css"]) {
    const text = readFileSync(new URL(`./${sheet}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(text, /(^|[;{\s])order\s*:/, `${sheet} sets an order`);
  }
});

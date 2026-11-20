// The card is drawn on a canvas, where no stylesheet reaches: its chapters' colours are the day's tokens in app.css,
// written again, and held equal here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cardTiles, deep, mix, vivid } from "./card.ts";

const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
const day = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));

test("the card's chapter colours are app.css's, by day", () => {
  for (const [id, hex] of Object.entries(vivid)) assert.match(day, new RegExp(`--t-${id}: ${hex};`), id);
  for (const [id, hex] of Object.entries(deep)) assert.match(day, new RegExp(`--d-${id}: ${hex};`), id);
});

test("colours mix as color-mix in srgb does", () => {
  assert.equal(mix("#ffffff", "#000000", 0.5), "#808080");
  assert.equal(mix("#ff6b4a", "#ffffff", 1), "#ff6b4a");
});

test("a question that counts for nobody keeps its place on the card, dashed and empty", () => {
  const marks = [
    { right: true },
    { right: false, close: true },
    { right: false, void: true },
    { right: false },
    ...Array.from({ length: 6 }, () => ({ right: true })),
  ];
  assert.deepEqual(cardTiles(marks).slice(0, 5), ["right", "near", "void", "wrong", "right"]);
  assert.equal(cardTiles(marks).length, 10);
});

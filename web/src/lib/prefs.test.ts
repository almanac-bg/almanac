import assert from "node:assert/strict";
import { test } from "node:test";

// The browser's storage, stood in for: a player who had „По-едър текст“ on, before the sizes.
const stored = new Map<string, string>([["almanac.big", "on"]]);
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => stored.set(k, v),
  removeItem: (k: string) => stored.delete(k),
};

const { rootScale, textSize } = await import("./prefs.ts");
const { phoneScale } = await import("./app.ts");

test("the one switch there was, on, is the first larger size", () => {
  assert.equal(textSize.peek(), "big");
});

test("the text's size: the player's step times the phone's own, never past twice the usual", () => {
  assert.equal(rootScale("normal", 1), 1);
  assert.equal(rootScale("big", 1), 1.25);
  assert.equal(rootScale("bigger", 1), 1.5);
  assert.equal(rootScale("big", 1.2), 1.5);
  assert.equal(rootScale("bigger", 1.6), 2);
  assert.equal(rootScale("normal", 0.8), 0.8);
});

test("an iPhone's text size, from the body text's size it gives: 17px is the usual", () => {
  assert.equal(phoneScale(17), 1);
  assert.equal(phoneScale(23), 23 / 17); // the largest of the usual sizes
  assert.equal(phoneScale(53), 2); // the largest of Accessibility's: twice at most
  assert.equal(phoneScale(12), 0.8); // smaller than the smallest: as the smallest
});

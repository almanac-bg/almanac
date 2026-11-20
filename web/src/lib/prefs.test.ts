import assert from "node:assert/strict";
import { test } from "node:test";

// The browser's storage, stood in for: a player who had „По-едър текст“ on, before the sizes.
const stored = new Map<string, string>([["almanac.big", "on"]]);
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => stored.set(k, v),
  removeItem: (k: string) => stored.delete(k),
};

const { textSize } = await import("./prefs.ts");

test("the one switch there was, on, is the first larger size", () => {
  assert.equal(textSize.peek(), "big");
});

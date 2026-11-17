import assert from "node:assert/strict";
import { test } from "node:test";
import { type Mastery, masteryNews } from "./known.ts";

const m = (known: number, tier: number, sure: boolean, first = false): Mastery => ({
  category: "history",
  answers: sure ? 40 : first ? 12 : 4,
  known,
  tier,
  name: "",
  sure,
  first,
});

test("a topic's move is news when it's a first estimate, a tier told for the first time, or a share gone up", () => {
  assert.equal(masteryNews({ from: m(0, 0, false), to: m(31, 0, false, true) }), true, "a first estimate");
  assert.equal(masteryNews({ from: m(23, 0, false, true), to: m(13, 0, true) }), true, "its tier, first told");
  assert.equal(masteryNews({ from: m(40, 2, true), to: m(44, 2, true) }), true, "a share gone up");
  assert.equal(masteryNews({ from: m(40, 2, true), to: m(52, 3, true) }), true, "a tier up");
});

test("a share gone down, or no change, is never news", () => {
  assert.equal(masteryNews({ from: m(15, 0, true), to: m(13, 0, true) }), false, "down within a tier");
  assert.equal(masteryNews({ from: m(41, 3, true), to: m(38, 2, true) }), false, "down a tier");
  assert.equal(masteryNews({ from: m(31, 0, false, true), to: m(29, 0, false, true) }), false, "a first estimate down");
  assert.equal(masteryNews({ from: m(40, 2, true), to: m(40, 2, true) }), false, "no change");
  assert.equal(masteryNews({ from: m(0, 0, false), to: m(0, 0, false) }), false, "still too few answers");
});

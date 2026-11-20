import assert from "node:assert/strict";
import { test } from "node:test";
import { standing } from "./standing.ts";

test("no place without someone to be placed among", () => {
  assert.equal(standing(undefined, 10, false), null);
  assert.equal(standing(1, 1, false), null);
});

test("once XP is open, the place is the way to the board, whatever it is", () => {
  assert.deepEqual(standing(7, 7, false), { place: "7\u2011о място от 7", lead: undefined });
  assert.deepEqual(standing(30, 31, false), { place: "30\u2011о място от 31", lead: undefined });
});

test("a new player sees their place only in the better half", () => {
  assert.deepEqual(standing(1, 2, true), { place: "1\u2011во място от 2", lead: undefined });
  assert.deepEqual(standing(3, 8, true), { place: "3\u2011то място от 8", lead: undefined });
  assert.deepEqual(standing(7, 7, true), { place: undefined, lead: undefined }, "few: no share");
  assert.deepEqual(standing(20, 31, true), {
    place: undefined,
    lead: "По-добре от 36% от играчите днес.",
  });
  assert.deepEqual(standing(31, 31, true), { place: undefined, lead: undefined }, "last: nothing to say");
});

test("among a hundred and more, the share leads and the place stays the way to the board", () => {
  assert.deepEqual(standing(60, 215, false), {
    place: "60\u2011о място от 215",
    lead: "По-добре от 72% от играчите днес.",
  });
  assert.deepEqual(standing(1, 215, false), { place: "1\u2011во място от 215", lead: undefined }, "first is first");
  assert.deepEqual(standing(150, 215, true), {
    place: undefined,
    lead: "По-добре от 30% от играчите днес.",
  });
});

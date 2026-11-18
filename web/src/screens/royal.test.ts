// Роял's seconds, where they decide a cut between players with as many right: never shown as a tie they weren't.
import assert from "node:assert/strict";
import { test } from "node:test";
import { seconds } from "./royal.ts";

test("seconds are to a tenth, and to a hundredth where a tenth would show two different times the same", () => {
  assert.equal(seconds(41_270), "41,3 с");
  assert.equal(seconds(41_270, [38_100]), "41,3 с", "apart at a tenth already");
  // A cut decided by time: 0,61 went on, 0,64 didn't. To a tenth both read „0,6 с“.
  assert.equal(seconds(612, [612, 648]), "0,61 с");
  assert.equal(seconds(648, [612, 648]), "0,65 с");
  // The whole group the same way, one that a tenth tells apart too.
  assert.equal(seconds(700, [612, 648, 700]), "0,70 с");
  // The very same time is a tie, and reads as one.
  assert.equal(seconds(612, [612]), "0,6 с");
});

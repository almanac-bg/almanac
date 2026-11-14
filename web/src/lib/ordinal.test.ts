import assert from "node:assert/strict";
import { test } from "node:test";
import { ordinal } from "./ordinal.ts";

test("ordinals are written as Bulgarian spells them", () => {
  const m = [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 14, 20, 21, 22, 23, 24, 50, 100, 101, 111, 200, 1000];
  assert.deepEqual(
    m.map((n) => ordinal(n)),
    [
      "1-ви",
      "2-ри",
      "3-ти",
      "4-ти",
      "5-и",
      "7-и",
      "8-и",
      "10-и",
      "11-и",
      "12-и",
      "14-и",
      "20-и",
      "21-ви",
      "22-ри",
      "23-ти",
      "24-ти",
      "50-и",
      "100-тен",
      "101-ви",
      "111-и",
      "200-тен",
      "1000-ен",
    ],
  );
  assert.deepEqual(
    [1, 2, 3, 5].map((n) => ordinal(n, "n")),
    ["1-во", "2-ро", "3-то", "5-о"],
  );
  assert.deepEqual(
    [1, 4, 6].map((n) => ordinal(n, "f")),
    ["1-ва", "4-та", "6-а"],
  );
});

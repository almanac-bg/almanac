import assert from "node:assert/strict";
import { test } from "node:test";
import { withName } from "./words.ts";

test("„със“ before an с or a з, „с“ before anything else", () => {
  assert.deepEqual(["Заек 817", "Сова", "зора", "Мечка 12", "Ана", "Sasho", "Zara", "Shon", "Ivo"].map(withName), [
    "със Заек 817",
    "със Сова",
    "със зора",
    "с Мечка 12",
    "с Ана",
    "със Sasho",
    "със Zara",
    "с Shon",
    "с Ivo",
  ]);
});

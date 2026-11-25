// A question's word in the review (results.ts, verdictWord) says what the run said (ui.ts, verdictSays): a number right
// but not spot on is „Вярно“, never „Точно“; spot on, and every other kind right, „Точно“, which never reads as
// true-or-not's answer.
import assert from "node:assert/strict";
import { test } from "node:test";

// The page results.ts loads into, as little of it as it reads as it loads.
Object.assign(globalThis, {
  location: { pathname: "/", search: "", hash: "" },
  document: { addEventListener: () => {}, getElementById: () => null, documentElement: { dataset: {} } },
});
const { verdictWord } = await import("./results.ts");
const { verdictSays } = await import("../ui.ts");

const year = { type: "number", text: "Кога?", step: 1 } as const;
const tf = { type: "truefalse", text: "Вярно ли е?" } as const;

test("a number right but not spot on is „Вярно“ in the review, as in the run; spot on, „Точно“", () => {
  assert.equal(verdictWord("right", year, { value: 1876 }, 1878), "Вярно");
  assert.equal(verdictSays("right", "number"), "Вярно!");
  assert.equal(verdictWord("right", year, { value: 1878 }, 1878), "Точно");
  assert.equal(verdictWord("right", { ...year, step: 10 }, { value: 1880 }, 1878), "Точно", "within half a step");
  // A friend's right number: how near is not known, and „Вярно“ is true either way.
  assert.equal(verdictWord("right", year), "Вярно");
});

test("every other kind right is „Точно“, and the rest keep their words", () => {
  assert.equal(verdictWord("right", tf, { truth: true }), "Точно");
  assert.equal(verdictWord("close", year, { value: 1850 }, 1878), "Близо");
  assert.equal(verdictWord("wrong", tf, { truth: false }), "Грешно");
  assert.equal(verdictWord("missed", year, null, 1878), "Без отговор");
});

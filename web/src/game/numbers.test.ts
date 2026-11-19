import assert from "node:assert/strict";
import { test } from "node:test";
import { closeWords, countedWords, percent, withOwn } from "./numbers.ts";
import type { Mark } from "./types.ts";

const right: Mark = { points: 1000, right: true };
const close: Mark = { points: 400, right: false, partial: true };
const wrong: Mark = { points: 0, right: false };

test("the player's own answer is in the crowd they're shown: what they picked never reads 0%, and it adds up", () => {
  // Twenty others today, sixteen right (the answer is second), four on the third; the player picked the first.
  const day = { answers: 20, right: 0.8, picks: [0, 0.8, 0.2, 0], today: true };
  const seen = withOwn(day, 0, false);
  assert.deepEqual(seen.picks?.map(percent), ["5%", "76%", "19%", "0%"]);
  assert.equal(percent(seen.right), "76%", "the line says what the shares do");
  assert.equal(seen.answers, 21);
  assert.equal(seen.today, true);
  assert.equal(percent(withOwn(day, 1, true).right), "81%", "right, among them");
  assert.equal(
    percent(withOwn({ answers: 1000, right: 0.5, picks: [0.5, 0.5, 0, 0] }, 3, false).picks?.[3] ?? 0),
    "под 1%",
  );
  const room = { answers: 2, right: 0.5, picks: [0.5, 0.5], counts: true };
  assert.equal(withOwn(room, 0, true), room, "a game's own crowd has them already");
});

test("a score says its close answers, whose points would read as a mistake beside none right", () => {
  assert.equal(closeWords([wrong, wrong, close, wrong]), " · 1 близо");
  assert.equal(closeWords([right, close, close, { ...close, void: true }]), " · 2 близо");
  assert.equal(closeWords([right, wrong]), "");
  assert.equal(closeWords(), "");
});

test("a game's own crowd, counted, says how many of its players knew it", () => {
  assert.equal(countedWords({ answers: 12, right: 3 / 12, counts: true }, false), "Познаха 3 от 12.");
  assert.equal(countedWords({ answers: 12, right: 1 / 12, counts: true }, true), "Само ти позна.");
  assert.equal(countedWords({ answers: 2, right: 1, counts: true }, true), "Всички познаха.");
  assert.equal(countedWords({ answers: 2, right: 0, counts: true }, false), "Никой не позна.");
  assert.equal(countedWords({ answers: 1, right: 1, counts: true }, true), "", "alone: the verdict says it");
});

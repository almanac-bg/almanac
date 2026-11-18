import assert from "node:assert/strict";
import { test } from "node:test";
import { type DayDone, dayGold, nextGame } from "./gold.ts";

const day = (d: Partial<DayDone>): DayDone => ({
  rights: 4,
  streak: 1,
  rare: false,
  just: true,
  repairing: false,
  ...d,
});

test("„Сподели“ is gold for a result worth sharing, as it lands", () => {
  assert.equal(dayGold(day({ rights: 6 })), "share", "6 of 10");
  assert.equal(dayGold(day({ streak: 3 })), "share", "a streak of 3");
  assert.equal(dayGold(day({ streak: 30 })), "share", "a streak of 30");
  assert.equal(dayGold(day({ rare: true })), "share", "a right answer few got, among 4");
});

test("a later visit finds the day played: gold goes to another game", () => {
  assert.equal(dayGold(day({ rights: 9, just: false })), "next", "however good");
  assert.equal(dayGold(day({ streak: 7, just: false })), "next", "whatever the streak");
});

test("a streak between its round numbers, or one lucky answer in a poor day, is no result to push", () => {
  assert.equal(dayGold(day({ streak: 4 })), "next", "a streak of 4");
  assert.equal(dayGold(day({ streak: 12 })), "next", "a streak of 12");
  assert.equal(dayGold(day({ rights: 2, rare: true })), "next", "2 of 10 with a rare one");
});

test("otherwise gold goes to what's next: a streak to win back, or another game", () => {
  assert.equal(dayGold(day({ rights: 2 })), "next", "2 of 10");
  assert.equal(dayGold(day({ rights: 10, repairing: true })), "repair", "the repair's game first");
});

test("another game goes where an open goal of topics points, else to all the topics", () => {
  assert.equal(nextGame([]), "/play/all");
  assert.equal(
    nextGame([
      { href: "/duel", done: false },
      { href: "/play/music", done: true },
      { href: "/play/history", done: false },
    ]),
    "/play/history",
  );
  assert.equal(nextGame([{ done: false }, { href: "/royal", done: false }]), "/play/all");
});

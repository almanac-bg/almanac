import assert from "node:assert/strict";
import { test } from "node:test";
import { boardHash, readBoard } from "./hash.ts";

const topics = ["history", "music"];

test("Класации' board reads from its address, the links already out there too", () => {
  assert.deepEqual(readBoard("", topics), { by: "day", friends: false, topic: "" });
  assert.deepEqual(readBoard("#friends", topics), { by: "day", friends: true, topic: "" });
  assert.deepEqual(readBoard("#rating/friends", topics), { by: "rating", friends: true, topic: "" });
  assert.deepEqual(readBoard("#knowledge/music", topics), { by: "knowledge", friends: false, topic: "music" });
  // A topic there isn't, none; a board there isn't, the day's.
  assert.deepEqual(readBoard("#nosuch/friends", topics), { by: "day", friends: true, topic: "" });
  assert.deepEqual(readBoard("#knowledge/astrology", topics), { by: "knowledge", friends: false, topic: "" });
});

test("each board has its address, and reads back to itself", () => {
  for (const b of [
    { by: "day", friends: false, topic: "" },
    { by: "day", friends: true, topic: "" },
    { by: "rating", friends: true, topic: "" },
    { by: "knowledge", friends: true, topic: "history" },
  ] as const)
    assert.deepEqual(readBoard(boardHash(b), topics), b);
  assert.equal(boardHash({ by: "day", friends: false, topic: "" }), "");
  assert.equal(boardHash({ by: "knowledge", friends: false, topic: "music" }), "#knowledge/music");
});

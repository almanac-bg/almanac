import assert from "node:assert/strict";
import { test } from "node:test";
import { nextGame } from "./gold.ts";

test("another game goes to the topic played least, the bank's first among those level; „Микс“ without numbers", () => {
  const topics = ["history", "music", "sport"];
  assert.equal(nextGame(undefined, topics), "/play/mix");
  assert.equal(nextGame([], topics), "/play/mix");
  assert.equal(
    nextGame(
      [
        { category: "history", answers: 40 },
        { category: "music", answers: 12 },
        { category: "sport", answers: 30 },
      ],
      topics,
    ),
    "/play/music",
  );
  // A topic never played has no answers: it comes first.
  assert.equal(nextGame([{ category: "history", answers: 3 }], topics), "/play/music");
  assert.equal(
    nextGame(
      [
        { category: "history", answers: 5 },
        { category: "music", answers: 5 },
        { category: "sport", answers: 5 },
      ],
      topics,
    ),
    "/play/history",
  );
});

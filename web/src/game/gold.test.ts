import assert from "node:assert/strict";
import { test } from "node:test";
import { nextGame } from "./gold.ts";

test("another game goes where an open goal of a topic points, else to what's next otherwise", () => {
  assert.equal(nextGame([], "/play/music"), "/play/music");
  assert.equal(
    nextGame(
      [
        { href: "/duel", done: false },
        { href: "/play/music", done: true },
        { href: "/play/history", done: false },
      ],
      "/play/music",
    ),
    "/play/history",
  );
  assert.equal(nextGame([{ done: false }, { href: "/royal", done: false }], "/play/music"), "/play/music");
});

// A game under way, held by each part of the screen that shows one: a game handed from its count to its question is
// under way throughout, and stops being so once nothing holds it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { effect, scope, signal, slot } from "./lib/dom.ts";

// The page it's on, as far as state.ts reads it.
(globalThis as { location?: unknown }).location = { pathname: "/" };
const { playing, playingWhile } = await import("./state.ts");

const moment = () => new Promise((r) => setTimeout(r, 0));

test("a game is under way while any part holds it, without a gap as one hands the screen to the next", async () => {
  const seen: boolean[] = [];
  scope(() => effect(() => seen.push(playing())));
  const screen = slot();
  const [, dispose] = scope(() => effect(() => void screen()));
  screen.show(() => {
    playingWhile(); // the count
    return null;
  });
  screen.show(() => {
    playingWhile(); // its first question on its way, in its place
    return null;
  });
  await moment();
  assert.deepEqual(seen, [false, true]);
  // The start failed: what shows next isn't the game.
  screen.show(() => null);
  await moment();
  assert.deepEqual(seen, [false, true, false]);
  dispose();
});

test("a live game holds it only while its view says it's under way, and lets go with its screen", async () => {
  const phase = signal("lobby");
  const [, dispose] = scope(() => playingWhile(() => phase() === "question"));
  assert.equal(playing.peek(), false);
  phase.set("question");
  assert.equal(playing.peek(), true);
  // Two holders at once (a duel's screen and its question): both must go.
  const [, other] = scope(() => playingWhile());
  dispose();
  await moment();
  assert.equal(playing.peek(), true);
  other();
  await moment();
  assert.equal(playing.peek(), false);
});

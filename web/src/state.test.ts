// A game under way, held by each part of the screen that shows one: a game handed from its count to its question is
// under way throughout, and stops being so once nothing holds it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { effect, scope, signal, slot } from "./lib/dom.ts";

// The page it's on, as far as state.ts reads it.
(globalThis as { location?: unknown }).location = { pathname: "/" };
const { player, playing, playingWhile, user } = await import("./state.ts");

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

test("a part holds it only while it says the game is under way, and lets go with its screen", async () => {
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

test("a guest is made once, however many ask for the player while it's on its way", async () => {
  const asked: string[] = [];
  // The server answers once told to, each guest asked for a new one.
  const waiting: (() => void)[] = [];
  globalThis.fetch = ((path: string, init: RequestInit) => {
    asked.push(`${init.method} ${path}`);
    const id = 6 + asked.length;
    return new Promise<Response>((r) =>
      waiting.push(() => r(new Response(JSON.stringify({ user: { id, name: "Щъркел 402", tag: "t", drawn: true } })))),
    );
  }) as typeof fetch;
  user.set(null);
  // A double tap on a first „Започни“: two asks before the server answers.
  const both = Promise.all([player(), player()]);
  await moment();
  for (const answer of waiting) answer();
  const [a, b] = await both;
  assert.deepEqual(asked, ["POST /api/guest"]);
  assert.equal(a.id, 7);
  assert.equal(b, a);
  assert.equal(user.peek()?.id, 7);
  // Made, the player is at hand: no more asking.
  assert.equal((await player()).id, 7);
  assert.equal(asked.length, 1);
  // A guest that couldn't be made is tried again on the next ask.
  user.set(null);
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  await assert.rejects(player(), { code: "offline" });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ user: { id: 8, name: "Сврака 117", tag: "x" } }))) as typeof fetch;
  assert.equal((await player()).id, 8);
  user.set(null);
});

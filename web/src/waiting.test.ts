// What waits for the player (a friend's challenge, someone asking to be friends) is asked for while the page is in
// view and no game is under way: every half minute, less often while nothing changes, and at once as the page comes
// back into view or a game ends.
import assert from "node:assert/strict";
import { test } from "node:test";
import { scope } from "./lib/dom.ts";

let onVisible: () => void = () => {};
const page = {
  hidden: false,
  addEventListener: (_: string, f: () => void) => (onVisible = f),
  getElementById: () => null,
};
Object.assign(globalThis, { location: { pathname: "/" }, document: page });
let asked: number = 0;
let answer = { requests: 0, challenges: [] as { id: number }[] };
globalThis.fetch = async () => {
  asked++;
  return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
};
const { playingWhile, user, watchWaiting } = await import("./state.ts");

const settle = () => new Promise((r) => setImmediate(r));

test("asks less often while nothing changes, never in a game or out of view, and at once when either ends", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const after = async (ms: number) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  user.set({ id: 1, name: "Сова 123", tag: "sova123" });
  watchWaiting();
  await settle();
  assert.equal(asked, 1, "asked as the page starts");
  // Nothing new: a minute, two, four, then five at the most.
  for (const wait of [60_000, 120_000, 240_000, 300_000, 300_000]) {
    await after(wait - 1);
    const before: number = asked;
    await after(1);
    assert.equal(asked, before + 1, `asked again after ${wait / 1000} s`);
  }
  // Something new: back to every half minute.
  answer = { requests: 1, challenges: [] };
  await after(300_000);
  const news: number = asked;
  await after(30_000);
  assert.equal(asked, news + 1, "asked again half a minute after news");

  // In a game: never asked; asked at once as it ends.
  const [, end] = scope(() => playingWhile());
  await after(600_000);
  const playing: number = asked;
  await after(600_000);
  assert.equal(asked, playing, "asked in a game");
  end();
  await settle();
  await settle();
  assert.equal(asked, playing + 1, "not asked as the game ended");

  // Out of view: never asked; asked at once as the page comes back.
  page.hidden = true;
  await after(600_000);
  const hidden: number = asked;
  await after(600_000);
  assert.equal(asked, hidden, "asked out of view");
  page.hidden = false;
  onVisible();
  await settle();
  assert.equal(asked, hidden + 1, "not asked as the page came back");
});

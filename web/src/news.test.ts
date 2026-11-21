// What has come to Приятели since the player last looked (the dot on it) is asked for while the page is in view and no
// game is under way: every half minute, less often while nothing changes, and at once as the page comes back into view
// or a game ends. On Приятели itself, news is seen as it comes.
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
const seen: string[] = [];
let answer = { news: false };
globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
  if (init?.method === "POST") {
    seen.push(String(url));
    answer = { news: false };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  asked++;
  return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
};
const { friendsNews, playingWhile, sawFriends, user, watchNews } = await import("./state.ts");
const { path } = await import("./lib/router.ts");

const settle = () => new Promise((r) => setImmediate(r));

test("asks less often while nothing changes, never in a game or out of view, and at once when either ends", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const after = async (ms: number) => {
    t.mock.timers.tick(ms);
    await settle();
    await settle();
  };
  user.set({ id: 1, name: "Сова 123", tag: "sova123" });
  watchNews();
  await settle();
  await settle();
  assert.equal(asked, 1, "asked as the page starts");
  assert.equal(friendsNews(), false);
  // Nothing new: a minute, two, four, then five at the most.
  for (const wait of [60_000, 120_000, 240_000, 300_000, 300_000]) {
    await after(wait - 1);
    const before: number = asked;
    await after(1);
    assert.equal(asked, before + 1, `asked again after ${wait / 1000} s`);
  }
  // Something new: the dot, and back to every half minute.
  answer = { news: true };
  await after(300_000);
  assert.equal(friendsNews(), true, "no dot for news");
  const news: number = asked;
  await after(30_000);
  assert.equal(asked, news + 1, "asked again half a minute after news");
  assert.equal(friendsNews(), true, "the dot went by itself");

  // Приятели opened: the dot goes at once, and the server is told.
  sawFriends();
  assert.equal(friendsNews(), false, "the dot stayed on Приятели");
  await settle();
  assert.deepEqual(seen, ["/api/friends/seen"]);

  // News while on Приятели: seen as it comes, no dot.
  path.set("/friends");
  answer = { news: true };
  await after(600_000);
  assert.equal(friendsNews(), false, "a dot on Приятели itself");
  assert.equal(seen.length, 2, "news on Приятели not told seen");
  path.set("/");

  // In a game: never asked; asked at once as it ends.
  const [, end] = scope(() => playingWhile());
  await after(600_000);
  const playing: number = asked;
  await after(600_000);
  assert.equal(asked, playing, "asked in a game");
  end();
  await settle();
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
  await settle();
  assert.equal(asked, hidden + 1, "not asked as the page came back");
});

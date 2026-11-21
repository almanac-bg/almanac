// The router against a tab's history stood in for (entries, back and forward as the browser does them: a popstate a
// moment later): what back does during a game and after (one opened from outside the app too), where a way back goes,
// a page fallen behind loading anew, a link from outside the page, a screen that sends the player on as it's drawn,
// and the focus on a heading that comes late.
import assert from "node:assert/strict";
import { test } from "node:test";

type State = Record<string, unknown> | null;

const origin = "https://almanac.bg";
const entries: { url: string; state: State }[] = [{ url: "/", state: null }];
let index = 0;
const loads: string[] = []; // the page loaded anew (reload), or another loaded (assign)

const location = {
  origin,
  href: `${origin}/`,
  pathname: "/",
  search: "",
  hash: "",
  reload: () => loads.push(`reload ${location.pathname}`),
  assign: (url: string) => loads.push(`assign ${url}`),
};
const point = () => {
  const u = new URL(entries[index]?.url ?? "/", origin);
  Object.assign(location, { href: u.href, pathname: u.pathname, search: u.search, hash: u.hash });
};

const windowListeners = new Map<string, ((e: unknown) => void)[]>();
const history = {
  scrollRestoration: "auto",
  get state() {
    return entries[index]?.state ?? null;
  },
  pushState(state: State, _: string, url: string) {
    entries.splice(index + 1);
    entries.push({ url, state });
    index++;
    point();
  },
  replaceState(state: State, _: string, url?: string) {
    const e = entries[index];
    if (e) entries[index] = { url: url ?? e.url, state };
    point();
  },
  go(by: number) {
    setTimeout(() => {
      index = Math.max(0, Math.min(entries.length - 1, index + by));
      point();
      for (const fn of windowListeners.get("popstate") ?? []) fn({});
    }, 0);
  },
  back() {
    this.go(-1);
  },
};

const body = { isConnected: true };
let focused: unknown = body;
let heading: { tabIndex: number; focus: () => void; isConnected: boolean } | null = null;
let observed: (() => void) | null = null;
const sheets: { open: boolean; close: () => void }[] = [];
/** What the screen shows: the name of the page drawn last into it. */
let showing = "";
const root = {
  replaceChildren(node: { text?: string }) {
    showing = node.text ?? "";
  },
  querySelector: () => heading,
};

/** Where the page was scrolled to, each time. */
const scrolls: number[] = [];
/** The screen's size changing (what loads drawn), while the page is being put back where it was. */
let resized: (() => void) | null = null;

Object.assign(globalThis, {
  location,
  history,
  scrollY: 0,
  scrollTo(_x: number, y: number) {
    scrolls.push(y);
  },
  ResizeObserver: class {
    constructor(fn: () => void) {
      resized = fn;
    }
    observe() {}
    disconnect() {
      resized = null;
    }
  },
  addEventListener(type: string, fn: (e: unknown) => void) {
    windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]);
  },
  removeEventListener() {},
  document: {
    addEventListener() {},
    // The sheets open over the page (a game's news, the name asked for).
    querySelectorAll: (q: string) => (q === "dialog[open]" ? sheets.filter((s) => s.open) : []),
    createTextNode: (text: string) => ({ text }),
    get activeElement() {
      return focused;
    },
    body,
  },
  Node: class {},
  MutationObserver: class {
    constructor(fn: () => void) {
      observed = fn;
    }
    observe() {}
    disconnect() {
      observed = null;
    }
  },
});

const router = await import("./router.ts");

const drawn: string[] = [];
const page = (name: string) => () => {
  drawn.push(name);
  return name;
};
router.start(
  root as unknown as Element,
  [
    { path: /^\/$/, view: page("Начало") },
    { path: /^\/play\/([a-z]+)$/, view: page("topic") },
    { path: /^\/friends$/, view: page("Приятели") },
    { path: /^\/settings$/, view: page("Настройки") },
    { path: /^\/duel\/([0-9]+)$/, view: page("duel") },
    // A screen that sends the player on as it's drawn (an old link): the page sent to is what shows.
    {
      path: /^\/gone$/,
      view: () => {
        drawn.push("gone");
        router.go("/friends", true);
        return null;
      },
    },
  ],
  page("missing"),
);
const tick = () => new Promise((r) => setTimeout(r, 5));
const urls = () => entries.slice(0, index + 1).map((e) => e.url);

test("a sheet open over a page goes with it, by a link or by back", async () => {
  const sheet = () => {
    const s = { open: true, close: () => (s.open = false) };
    sheets.push(s);
    return s;
  };
  const news = sheet();
  router.go("/friends");
  assert.equal(news.open, false);
  const name = sheet();
  history.back();
  await tick();
  assert.equal(location.pathname, "/");
  assert.equal(name.open, false);
  sheets.length = 0;
});

test("a tap opens a page over the one it's tapped on; back comes to that one again", async () => {
  drawn.length = 0;
  router.go("/friends");
  assert.equal(location.pathname, "/friends");
  assert.equal(router.entry().from, "/");
  assert.equal(router.byTap(), true);
  assert.ok(router.canGoBack());
  history.back();
  await tick();
  assert.equal(location.pathname, "/");
  assert.deepEqual(drawn, ["Приятели", "Начало"]);
  assert.equal(router.byTap(), false);
});

test("a game holds an entry of its own: back mid-game asks, stays on „Остани“, and leaves on „Излез“", async () => {
  router.go("/play/history");
  router.hold(true);
  assert.equal(router.entry().game, true);
  const at = index;
  let ask: (() => void) | null = null;
  const unguard = router.beforeLeaving((proceed) => {
    ask = proceed;
    return true;
  });
  drawn.length = 0;
  history.back(); // the phone's back, mid-question
  await tick();
  await tick();
  assert.ok(ask, "the game asks first");
  assert.equal(index, at, "and its entry is put back meanwhile");
  assert.deepEqual(drawn, [], "the screen isn't drawn again");
  // „Излез“: back to where it was going.
  (ask as unknown as () => void)();
  unguard();
  await tick();
  assert.equal(index, at - 1);
  assert.deepEqual(drawn, ["topic"]);
});

test("a game over gives back its entry, and the page under it keeps its result", async () => {
  router.go("/play/science");
  router.hold(true);
  drawn.length = 0;
  router.release({ result: 42 });
  await tick();
  assert.equal(router.entry().game, undefined);
  assert.equal(router.entry().result, 42);
  assert.equal(location.pathname, "/play/science");
  assert.deepEqual(drawn, [], "the result stays on screen as it is");
});

test("a way back goes back when it's the page before, and in place of this page when not", async () => {
  router.go("/settings");
  const depth = index;
  router.leave(router.entry().from ?? "");
  await tick();
  assert.equal(index, depth - 1, "back in the history");
  router.go("/friends", true); // a page come to in place of another: nothing of the app's before it
  const before = urls();
  router.leave("/");
  assert.equal(location.pathname, "/");
  assert.equal(urls().length, before.length, "in place: no entry more");
});

test("a page fallen behind opens its next screen by loading anew, as tapped", async () => {
  let behind = true;
  router.loadAnew(() => behind);
  loads.length = 0;
  drawn.length = 0;
  router.go("/friends");
  assert.deepEqual(loads, ["reload /friends"]);
  assert.deepEqual(drawn, [], "not drawn in place");
  assert.equal(router.entry().tap, true, "the page loaded anew opens as the tap would have");
  behind = false;
});

test("a link from outside: a page of the server's own loads as a page; a game under way asks first", async () => {
  loads.length = 0;
  router.navigate("https://almanac.bg/mail/off?u=1");
  assert.deepEqual(loads, ["assign https://almanac.bg/mail/off?u=1"]);
  router.navigate("https://evil.example/friends");
  assert.equal(loads.length, 1, "another site's: nothing");
  let asked = 0;
  const unguard = router.beforeLeaving(() => {
    asked++;
    return true; // „Остани“ for now
  });
  const was = location.pathname;
  router.navigate("/settings");
  assert.equal(asked, 1);
  assert.equal(location.pathname, was, "nothing opened before „Излез“");
  unguard();
  router.navigate("/settings");
  assert.equal(location.pathname, "/settings");
});

test("a screen whose heading comes after it loads gets the focus with it, unless the player has moved it", async () => {
  heading = null;
  focused = body;
  router.go("/friends");
  assert.ok(observed, "waits for the heading");
  let got = false;
  heading = { tabIndex: 0, isConnected: true, focus: () => (got = true) };
  observed?.();
  assert.ok(got);
  assert.equal(heading.tabIndex, -1);
  // The player tapped into something meanwhile: the focus stays there.
  heading = null;
  router.go("/settings");
  focused = { isConnected: true };
  got = false;
  heading = { tabIndex: 0, isConnected: true, focus: () => (got = true) };
  observed?.();
  assert.equal(got, false);
});

/** Makes the entry shown a page opened from outside the app (a link from a chat, a notification): the tab's first. */
function fromOutside(url: string): void {
  history.replaceState({ i: router.entry().i }, "", url);
}

test("a game opened from outside has Начало under it: back asks, and „Излез“ leaves the game for Начало", async () => {
  fromOutside("/duel/7");
  const at = index;
  router.hold();
  assert.equal(router.entry().game, true);
  assert.equal(location.pathname, "/duel/7", "the game keeps its address");
  assert.equal(entries[at]?.url, "/", "Начало under it");
  let ask: (() => void) | null = null;
  const unguard = router.beforeLeaving((proceed) => {
    ask = proceed;
    return true;
  });
  drawn.length = 0;
  history.back();
  await tick();
  await tick();
  assert.ok(ask, "back asks first");
  assert.equal(index, at + 1, "the game's entry put back meanwhile");
  (ask as unknown as () => void)();
  unguard();
  await tick();
  assert.equal(index, at);
  assert.equal(location.pathname, "/");
  assert.deepEqual(drawn, ["Начало"], "out of the game, not into it again");
});

test("a game opened from outside, over: the page under it takes its address, renamed or not, and its result", async () => {
  fromOutside("/play/history");
  const at = index;
  router.hold();
  router.rename("/duel/7"); // given another address while it plays
  assert.equal(router.entry().game, true, "still the game's own entry");
  drawn.length = 0;
  router.release({ result: 9 });
  await tick();
  assert.equal(index, at);
  assert.equal(location.pathname, "/duel/7");
  assert.equal(router.entry().result, 9);
  assert.equal(router.entry().game, undefined);
  assert.equal(router.entry().from, undefined, "still the first page: back from it leaves");
  assert.deepEqual(drawn, [], "the result stays on screen as it is");
});

test("renamed as its game ends, before the way back has arrived: the page under it takes the new address", async () => {
  router.go("/play/science");
  router.hold(true);
  const at = index;
  router.release({ result: 5 });
  // An answer that comes before the browser has gone back (Safari's, after a quick one from the server).
  router.rename("/");
  assert.equal(index, at, "not yet arrived");
  await tick();
  assert.equal(index, at - 1);
  assert.equal(location.pathname, "/");
  assert.equal(router.entry().result, 5);
  assert.equal(entries[at]?.url, "/play/science", "the entry left keeps its own address");
});

test("a screen that sends the player on as it's drawn: the page it sends to shows", async () => {
  drawn.length = 0;
  router.go("/gone");
  await tick();
  assert.equal(location.pathname, "/friends");
  assert.deepEqual(drawn, ["gone", "Приятели"]);
  assert.equal(showing, "Приятели", "not the screen that sent the player on, empty");
});

test("a page put back where it was stops being held there once another screen opens, or the player clicks", async () => {
  const back = async () => {
    router.go("/settings");
    Object.assign(globalThis, { scrollY: 500 }); // scrolled down, and on to another page
    router.go("/friends");
    Object.assign(globalThis, { scrollY: 0 });
    history.back();
    await tick();
    assert.equal(location.pathname, "/settings");
    assert.ok(resized, "held where it was while what it loads comes");
    scrolls.length = 0;
    resized?.();
    assert.deepEqual(scrolls, [500]);
  };
  await back();
  // A click on a link to another screen: that screen opens at its top, and stays there as its content comes.
  router.go("/friends");
  assert.equal(resized, null, "the page before isn't held any more");
  assert.deepEqual(scrolls, [500, 0]);
  // A click anywhere (a mouse's, a finger's) ends the wait too.
  await back();
  for (const fn of windowListeners.get("pointerdown") ?? []) fn({});
  assert.equal(resized, null);
});

test("„Отказ“ on a game's count: back where it was come from; opened from outside, its start again in place", async () => {
  const from = location.pathname;
  router.go("/play/history");
  router.hold(); // come to by a tap: nothing held
  let stayed = 0;
  router.backOut("/", () => stayed++);
  await tick();
  assert.equal(location.pathname, from, "back where the tap was");
  assert.equal(stayed, 0);
  fromOutside("/play/science");
  const at = index;
  router.hold();
  assert.equal(router.entry().game, true);
  drawn.length = 0;
  router.backOut("/", () => stayed++);
  await tick();
  assert.equal(stayed, 1, "its start shown again");
  assert.equal(index, at);
  assert.equal(location.pathname, "/play/science", "not Начало");
  assert.equal(router.entry().game, undefined);
  assert.deepEqual(drawn, [], "nothing drawn over it");
});

import assert from "node:assert/strict";
import { test } from "node:test";

// The app's bridge, stood in for: it keeps each call to a plugin, and each listener, to tell it of events.
const calls: string[] = [];
const listeners = new Map<string, (data: unknown) => void>();
(globalThis as { Capacitor?: unknown }).Capacitor = {
  getPlatform: () => "ios",
  nativePromise: (plugin: string, method: string, options: Record<string, string> = {}) => {
    calls.push([plugin, method, ...Object.values(options)].join(" "));
    return Promise.resolve();
  },
  nativeCallback: (plugin: string, _method: string, options: { eventName: string }, fn: (data: unknown) => void) => {
    listeners.set(`${plugin} ${options.eventName}`, fn);
    return "";
  },
};
// The page, in the app: on Роял.
(globalThis as { location?: unknown }).location = { origin: "https://almanac.bg", pathname: "/royal", search: "" };

const { backAction, haptic, open, start } = await import("./phone.ts");

/** A Nav that keeps what it was asked to open. */
const nav = (playing = false) => {
  const opened: string[] = [];
  return {
    opened,
    navigate: (link: string) => opened.push(link),
    go: (path: string) => opened.push(path),
    home: () => false,
    playing: () => playing,
    canGoBack: () => true,
    resumed: () => opened.push("resumed"),
  };
};

test("a link that starts the app opens once, and the launch's link isn't asked for again", () => {
  calls.length = 0;
  const n = nav();
  start(n, () => {});
  // The app tells of the link it was started by when it's first listened to, and the phone may tell of it twice.
  const told = listeners.get("App appUrlOpen");
  told?.({ url: "https://almanac.bg/hand/abc" });
  told?.({ url: "https://almanac.bg/hand/abc" });
  assert.deepEqual(n.opened, ["https://almanac.bg/hand/abc"]);
  assert.ok(!calls.some((c) => c.includes("getLaunchUrl")), calls.join("\n"));
  listeners.get("App resume")?.({});
  assert.deepEqual(n.opened, ["https://almanac.bg/hand/abc", "resumed"]);
});

test("a notification for the page under way doesn't open it again; another site's link opens nothing", () => {
  const busy = nav(true);
  open("/royal", busy); // a Роял reminder tapped in Роял, mid-game
  open("https://evil.example/royal", busy);
  open("https://almanac.bg.evil.example/", busy);
  assert.deepEqual(busy.opened, []);
  open("/duel/7", busy); // another page: asked of the game first (the router's navigate)
  const idle = nav(false);
  open("/mail/off?u=1", idle); // a page of the server's own: the router's navigate loads it as a page
  assert.deepEqual(busy.opened, ["https://almanac.bg/duel/7"]);
  assert.deepEqual(idle.opened, ["https://almanac.bg/mail/off?u=1"]);
});

test("Android's back puts the app away from Начало only, never from a game under way", () => {
  const at = (home: boolean, canGoBack: boolean) => backAction({ home: () => home, canGoBack: () => canGoBack });
  assert.equal(at(true, true), "away");
  assert.equal(at(true, false), "away");
  // The day's ten under way on Начало isn't Начало: back goes back, and the game asks first.
  assert.equal(at(false, true), "back");
  // A page opened from outside the game (a notification's): to Начало.
  assert.equal(at(false, false), "home");
});

test("Android's back puts away a sheet open over the page first, wherever it is", () => {
  const nav = { home: () => true, canGoBack: () => true };
  assert.equal(backAction(nav, true), "close");
  assert.equal(backAction({ ...nav, home: () => false }, true), "close");
  assert.equal(backAction(nav, false), "away");
});

test("the back button closes the sheet it finds open, and goes nowhere", () => {
  const closed: string[] = [];
  const sheet = { close: () => closed.push("sheet") };
  (globalThis as { document?: unknown }).document = { querySelector: () => sheet };
  calls.length = 0;
  const n = nav();
  start(n, () => {});
  listeners.get("App backButton")?.({});
  assert.deepEqual(closed, ["sheet"]);
  assert.deepEqual(n.opened, []);
  // No sheet: back a page.
  (globalThis as { document?: unknown }).document = { querySelector: () => null };
  (globalThis as { history?: unknown }).history = { back: () => closed.push("back") };
  listeners.get("App backButton")?.({});
  assert.deepEqual(closed, ["sheet", "back"]);
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { history?: unknown }).history;
});
const felt = async (kind: Parameters<typeof haptic>[0]) => {
  calls.length = 0;
  haptic(kind);
  await new Promise((r) => setTimeout(r, 200));
  return [...calls];
};

test("a wrong answer is two light knocks, never the phone's error alert", async () => {
  assert.deepEqual(await felt("wrong"), ["Haptics impact LIGHT", "Haptics impact LIGHT"]);
});

test("each moment has its touch", async () => {
  assert.deepEqual(await felt("tap"), ["Haptics impact LIGHT"]);
  assert.deepEqual(await felt("select"), ["Haptics selectionStart", "Haptics selectionChanged"]);
  assert.deepEqual(await felt("right"), ["Haptics impact MEDIUM"]);
  assert.deepEqual(await felt("exact"), ["Haptics notification SUCCESS"]);
  assert.deepEqual(await felt("close"), ["Haptics impact LIGHT"]);
  assert.deepEqual(await felt("streak"), ["Haptics impact MEDIUM"]);
  assert.deepEqual(await felt("big"), ["Haptics notification SUCCESS", "Haptics impact HEAVY"]);
});

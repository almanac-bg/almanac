// The service worker (public/sw.js), run against a stand-in for its global: a new one takes over at once, and a tap
// on a notification never loads a page from the worker (#733 did, and cut a game mid-question; #735 mended it). The
// page goes where the tap points itself (lib/push.ts), through the router's guard.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

interface Win {
  url: string;
  focused: boolean;
  posted: unknown[];
  focus(): Promise<void>;
  postMessage(m: unknown): void;
  navigate?: (url: string) => never;
}

function worker(windows: Win[] = []) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const opened: string[] = [];
  let skipped = 0;
  const self = {
    location: { origin: "https://almanac.bg" },
    addEventListener: (type: string, f: (e: unknown) => void) => {
      listeners[type] = f;
    },
    skipWaiting: () => {
      skipped++;
      return Promise.resolve();
    },
    registration: { showNotification: () => Promise.resolve() },
    clients: {
      matchAll: () => Promise.resolve(windows),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      },
    },
  };
  runInNewContext(source, { self, URL });
  const fire = async (type: string, e: Record<string, unknown> = {}) => {
    let wait: Promise<unknown> = Promise.resolve();
    listeners[type]?.({ ...e, waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
  };
  return { listeners, opened, skipped: () => skipped, fire };
}

const win = (url: string): Win => ({
  url,
  focused: false,
  posted: [],
  focus() {
    this.focused = true;
    return Promise.resolve();
  },
  postMessage(m) {
    this.posted.push(m);
  },
  navigate: () => assert.fail("a window navigated from the worker"),
});

const tap = (url: string) => ({ notification: { data: { url }, close() {} } });

test("a new worker takes over at once, with windows of the game open", async () => {
  const w = worker();
  await w.fire("install");
  assert.equal(w.skipped(), 1);
});

test("a tap on a notification asks the page to go there, and never loads it from the worker", async () => {
  const game = win("https://almanac.bg/");
  const w = worker([game]);
  await w.fire("notificationclick", tap("/friends"));
  assert.ok(game.focused);
  assert.equal(JSON.stringify(game.posted), JSON.stringify([{ open: "https://almanac.bg/friends" }])); // made in the worker's realm
  assert.deepEqual(w.opened, []);
  assert.doesNotMatch(source, /\.navigate\(/);
});

test("a tap with no window of the game open opens one", async () => {
  const w = worker();
  await w.fire("notificationclick", tap("/"));
  assert.deepEqual(w.opened, ["https://almanac.bg/"]);
});

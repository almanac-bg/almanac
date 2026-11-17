import assert from "node:assert/strict";
import { test } from "node:test";

// The app's bridge, stood in for: it keeps each call to a plugin.
const calls: string[] = [];
(globalThis as { Capacitor?: unknown }).Capacitor = {
  getPlatform: () => "ios",
  nativePromise: (plugin: string, method: string, options: Record<string, string> = {}) => {
    calls.push([plugin, method, ...Object.values(options)].join(" "));
    return Promise.resolve();
  },
  nativeCallback: () => "",
};

const { backAction, haptic } = await import("./phone.ts");

test("Android's back puts the app away from Начало only, never from a game under way", () => {
  const at = (home: boolean, canGoBack: boolean) => backAction({ home: () => home, canGoBack: () => canGoBack });
  assert.equal(at(true, true), "away");
  assert.equal(at(true, false), "away");
  // The day's ten under way on Начало isn't Начало: back goes back, and the game asks first.
  assert.equal(at(false, true), "back");
  // A page opened from outside the game (a notification's): to Начало.
  assert.equal(at(false, false), "home");
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

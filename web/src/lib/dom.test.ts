// The signals and scopes the UI rests on (the DOM parts are covered by the browser tests).
import assert from "node:assert/strict";
import { test } from "node:test";
import { batch, computed, effect, onCleanup, safeURL, scope, signal } from "./dom.ts";

test("an effect runs again when what it read changes, and only then", () => {
  const a = signal(1);
  const b = signal(10);
  const seen: number[] = [];
  const [, dispose] = scope(() => effect(() => seen.push(a())));
  a.set(2);
  b.set(11);
  a.set(2); // the same value: nothing to do
  dispose();
  a.set(3); // gone with its scope
  assert.deepEqual(seen, [1, 2]);
});

test("an effect follows only what its last run read", () => {
  const which = signal(true);
  const left = signal("l");
  const right = signal("r");
  const seen: string[] = [];
  scope(() => effect(() => seen.push(which() ? left() : right())));
  which.set(false);
  left.set("L"); // no longer read
  right.set("R");
  assert.deepEqual(seen, ["l", "r", "R"]);
});

test("a batch runs each effect once", () => {
  const a = signal(1);
  const b = signal(1);
  let runs = 0;
  scope(() =>
    effect(() => {
      a();
      b();
      runs++;
    }),
  );
  batch(() => {
    a.set(2);
    b.set(2);
  });
  assert.equal(runs, 2);
});

test("cleanups run before each rerun and at the end, nested effects with them", () => {
  const a = signal(0);
  const inner = signal(0);
  const log: string[] = [];
  const [, dispose] = scope(() =>
    effect(() => {
      const n = a();
      onCleanup(() => log.push(`clean ${n}`));
      effect(() => log.push(`inner ${n}:${inner()}`));
    }),
  );
  inner.set(1);
  a.set(1);
  inner.set(2);
  dispose();
  inner.set(3);
  assert.deepEqual(log, ["inner 0:0", "inner 0:1", "clean 0", "inner 1:1", "inner 1:2", "clean 1"]);
});

test("computed values follow their sources", () => {
  const a = signal(2);
  const [double] = scope(() => computed(() => a() * 2));
  a.set(5);
  assert.equal(double(), 10);
});

test("links go to this site, the web or mail only", () => {
  for (const ok of [
    "/play/history",
    "/qimg/a.webp 600w, /qimg/b.webp 1200w",
    "https://commons.wikimedia.org/x",
    "mailto:a@b.bg",
  ]) {
    assert.ok(safeURL(ok), ok);
  }
  for (const bad of [
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html,x",
    "//evil.example",
    "/ok, javascript:x",
  ]) {
    assert.ok(!safeURL(bad), bad);
  }
});

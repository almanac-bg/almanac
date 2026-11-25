// The signals and scopes the UI rests on (the DOM parts are covered by the browser tests).
import assert from "node:assert/strict";
import { test } from "node:test";
import { computed, effect, lifetime, onCleanup, safeURL, scope, signal, slot } from "./dom.ts";

test("a scope's lifetime ends with it, so what was on its way when it ended does nothing", async () => {
  const opened: string[] = [];
  const [life, dispose] = scope(() => {
    const life = lifetime();
    Promise.resolve().then(() => {
      if (!life.aborted) opened.push("stream");
    });
    return life;
  });
  dispose(); // the screen gone before the answer came
  await Promise.resolve();
  assert.equal(life.aborted, true);
  assert.deepEqual(opened, []);
  assert.equal(lifetime().aborted, false); // outside any scope: never ends
});

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
    "https://almanac.bg/privacy",
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
    // An address only made to look like the game's (the app's web view would take it as its own on an iPhone).
    "https://almanac.bg.evil.example/",
    "https://almanac.bg@evil.example/",
    "https://user:pass@commons.wikimedia.org/x",
  ]) {
    assert.ok(!safeURL(bad), bad);
  }
});

test("a slot's views, set after an await, are undone in turn and with the screen", async () => {
  const place = slot();
  const undone: string[] = [];
  const read = signal(0);
  let built = 0;
  // As a screen puts it in the page: a child the page re-runs.
  const [, dispose] = scope(() => effect(() => void place()));
  await Promise.resolve(); // a fetch: no scope is open here
  place.show(() => {
    built++;
    read(); // what a view reads draws the view, not the slot again
    onCleanup(() => undone.push("first"));
    return null;
  });
  read.set(1);
  assert.equal(built, 1);
  place.show(() => {
    onCleanup(() => undone.push("second"));
    return null;
  });
  assert.deepEqual(undone, ["first"]);
  dispose();
  assert.deepEqual(undone, ["first", "second"]);
});

/** The errors the UI reported (an effect or a cleanup that threw), as the browser's reportError hears them. */
const reported: unknown[] = [];
(globalThis as { reportError?: (e: unknown) => void }).reportError = (e) => reported.push(e);

test("an effect that throws breaks only itself: the others a change wakes run in the same flush, and set() doesn't throw", () => {
  reported.length = 0;
  const phase = signal("lobby");
  const players = signal<string[] | null>([]);
  const seen: string[] = [];
  scope(() => {
    // A part of a live screen that a view it didn't expect breaks (a null where a list was).
    effect(() => {
      phase();
      (players() as string[]).length;
    });
    effect(() => seen.push(phase()));
  });
  players.set(null);
  phase.set("question"); // wakes both: the first throws, the second still runs
  phase.set("reveal");
  players.set([]);
  phase.set("question");
  assert.deepEqual(seen, ["lobby", "question", "reveal", "question"]);
  assert.equal(reported.length, 3); // the three flushes while players was null
  assert.ok(reported[0] instanceof TypeError);
});

test("an effect that throws undoes what it set up before it threw, and runs again when what it read changes", () => {
  reported.length = 0;
  const a = signal(0);
  const inner = signal(0);
  let live = 0;
  let runs = 0;
  scope(() =>
    effect(() => {
      const n = a();
      live++;
      onCleanup(() => live--);
      effect(() => {
        inner();
        runs++;
      });
      if (n === 1) throw new Error("a bad view");
    }),
  );
  a.set(1);
  assert.equal(live, 0); // the run that threw left nothing behind
  runs = 0;
  inner.set(1);
  assert.equal(runs, 0); // nor its nested effect
  a.set(2);
  assert.equal(live, 1);
  inner.set(2);
  assert.equal(runs, 2); // the new run's, and only it
  assert.equal(reported.length, 1);
});

test("a cleanup that throws doesn't keep the others from running", () => {
  reported.length = 0;
  const done: string[] = [];
  const [, dispose] = scope(() => {
    onCleanup(() => done.push("first"));
    onCleanup(() => {
      throw new Error("a listener gone already");
    });
    onCleanup(() => done.push("last"));
  });
  dispose();
  assert.deepEqual(done, ["last", "first"]);
  assert.equal(reported.length, 1);
});

test("a scope whose builder throws undoes what it set up, and the error goes on", () => {
  reported.length = 0;
  let undone = false;
  assert.throws(() =>
    scope(() => {
      onCleanup(() => {
        undone = true;
      });
      throw new Error("no screen");
    }),
  );
  assert.equal(undone, true);
});

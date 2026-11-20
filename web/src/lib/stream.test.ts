// A live game's stream against an EventSource stood in for: what the browser does by itself (a stream that drops is
// opened again: CONNECTING) is left to it; one it gave up on (CLOSED) is opened anew, later each time, while the
// screen lasts.
import assert from "node:assert/strict";
import { mock, test } from "node:test";

class FakeSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static all: FakeSource[] = [];
  readyState = FakeSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((e: { data: string; lastEventId: string }) => void)[]>();
  /** The last event's id, as the browser keeps it for the stream it opens again itself. */
  lastEventId = "";
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: { data: string; lastEventId: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = FakeSource.CLOSED;
  }
  /** The server says something (with an id, `id`). */
  send(type: string, data = "{}", id?: string) {
    this.readyState = FakeSource.OPEN;
    this.onopen?.();
    if (id !== undefined) this.lastEventId = id;
    for (const fn of this.listeners.get(type) ?? []) fn({ data, lastEventId: this.lastEventId });
  }
  /** The line drops: the browser opens it again itself (CONNECTING), or has given up on it (CLOSED). */
  fail(given: boolean) {
    this.readyState = given ? FakeSource.CLOSED : FakeSource.CONNECTING;
    this.onerror?.();
  }
}
Object.assign(globalThis, { EventSource: FakeSource, window: globalThis });

const { backoff, stream } = await import("./stream.ts");

const latest = () => FakeSource.all.at(-1) as FakeSource;

test("a stream given up on is opened anew, later each time, its line down until the server speaks again", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  mock.method(Math, "random", () => 0); // the waits whole: 1 s, then 2
  FakeSource.all.length = 0;
  const life = new AbortController();
  const heard: string[] = [];
  const lines: boolean[] = [];
  stream("/api/royal/events", { life: life.signal, on: { message: (d) => heard.push(d) }, down: (d) => lines.push(d) });
  latest().send("message", "a");
  // Dropped, and the browser is on it (after the server's retry:): nothing is opened here.
  latest().fail(false);
  mock.timers.tick(60_000);
  assert.equal(FakeSource.all.length, 1);
  // Given up on (a proxy's 502 page): opened anew within a second, then within two …
  latest().fail(true);
  mock.timers.tick(1_000);
  assert.equal(FakeSource.all.length, 2);
  latest().fail(true);
  mock.timers.tick(1_000);
  assert.equal(FakeSource.all.length, 2, "the second wait is longer than the first");
  mock.timers.tick(1_000);
  assert.equal(FakeSource.all.length, 3);
  latest().send("message", "b");
  // … and from a second again once the server has spoken.
  latest().fail(true);
  mock.timers.tick(1_000);
  assert.equal(FakeSource.all.length, 4);
  assert.deepEqual(heard, ["a", "b"]);
  assert.deepEqual(lines, [true, false, true]);
  assert.ok(FakeSource.all.slice(0, 3).every((s) => s.closed));
  life.abort();
  assert.equal(latest().closed, true);
  mock.timers.reset();
  mock.restoreAll();
});

test("a stream ends with its screen, and once its game says so: nothing opens it after", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  FakeSource.all.length = 0;
  const life = new AbortController();
  stream("/api/royal/events", { life: life.signal, on: {} });
  latest().fail(true);
  life.abort(); // the screen gone while it waits to open again
  mock.timers.tick(60_000);
  assert.equal(FakeSource.all.length, 1);

  const again = new AbortController();
  const t = stream("/api/royal/events", { life: again.signal, on: { closed: () => t.close() } });
  latest().send("closed");
  assert.equal(latest().closed, true);
  latest().fail(true);
  mock.timers.tick(60_000);
  assert.equal(FakeSource.all.length, 2);

  // Opened again on purpose (another player signed in): a new stream, and the old one says nothing more.
  const heard: string[] = [];
  const u = stream("/api/royal/events", { life: again.signal, on: { message: (d) => heard.push(d) } });
  const old = latest();
  u.reopen();
  assert.equal(old.closed, true);
  assert.equal(FakeSource.all.length, 4);
  old.send("message", "old");
  latest().send("message", "new");
  assert.deepEqual(heard, ["new"]);
  again.abort();
  assert.equal(latest().closed, true);
  mock.timers.reset();
});

test("a stream opened anew says the last id it heard, as the browser does when it opens one again itself", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  mock.method(Math, "random", () => 0);
  FakeSource.all.length = 0;
  const life = new AbortController();
  stream("/api/duels/live/events?rematch=4", { life: life.signal, on: { waiting: () => {}, message: () => {} } });
  latest().send("waiting");
  latest().fail(true);
  mock.timers.tick(1_000);
  assert.equal(latest().url, "/api/duels/live/events?rematch=4", "no id heard yet");
  latest().send("message", "{}", "7");
  latest().send("message", "{}"); // the id stays the last one said
  latest().fail(true);
  mock.timers.tick(1_000);
  assert.equal(latest().url, "/api/duels/live/events?rematch=4&last=7");
  life.abort();
  mock.timers.reset();
  mock.restoreAll();
});

test("the wait doubles each time, to half a minute, less a random part of up to half", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoff(n, () => 0)),
    [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000],
  );
  assert.equal(
    backoff(6, () => 0.5),
    22_500,
  );
});

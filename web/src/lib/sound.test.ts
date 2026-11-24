import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// A stand-in for the browser's audio: it keeps every tone started (its pitch and when it starts and stops); the rest
// (gains, filters, the compressor, the room) only takes its settings.
interface Tone {
  hz: number;
  at: number;
  end: number;
}
const tones: Tone[] = [];
const param = () => ({
  value: 0,
  setValueAtTime() {},
  exponentialRampToValueAtTime() {},
  linearRampToValueAtTime() {},
});
const node = () => ({ connect: <T>(n: T) => n });
class FakeAudio {
  static last: FakeAudio;
  state = "running";
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  constructor() {
    FakeAudio.last = this;
  }
  createGain() {
    return { ...node(), gain: param() };
  }
  createBiquadFilter() {
    return { ...node(), type: "", frequency: param(), Q: param() };
  }
  createDynamicsCompressor() {
    return { ...node(), threshold: param(), ratio: param(), attack: param(), release: param() };
  }
  createConvolver() {
    return { ...node(), buffer: null };
  }
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (ch: number) => data[ch] };
  }
  createBufferSource() {
    return { ...node(), buffer: null, start() {}, stop() {} };
  }
  createOscillator() {
    const tone: Tone = { hz: 0, at: 0, end: 0 };
    return {
      ...node(),
      type: "",
      frequency: {
        ...param(),
        set value(hz: number) {
          tone.hz = hz;
        },
      },
      start(t: number) {
        tone.at = t;
        tones.push(tone);
      },
      stop(t: number) {
        tone.end = t;
      },
    };
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}
(globalThis as { AudioContext?: unknown }).AudioContext = FakeAudio;
// Whether the page is being touched right now (the browser's navigator.userActivation): not yet, as a page opens.
const touch = { isActive: false };
Object.defineProperty(globalThis.navigator, "userActivation", { value: touch, configurable: true });

const { loadFeel, play, playAnswer, playCount, setSound } = await import("./sound.ts");
await loadFeel(); // in the game, the first touch sends for the voices

beforeEach(() => {
  setSound(true);
  tones.length = 0;
  // Each test starts a while after the last, so nothing of it is still sounding.
  if (FakeAudio.last) FakeAudio.last.currentTime += 60;
});

// Making the audio takes a phone a long moment: nothing is made for a sound asked for before any touch (a friend's duel
// waiting, as the page opens), when it couldn't sound anyway.
test("no audio is made before the page is touched", () => {
  play("ping");
  playCount(3);
  assert.equal(FakeAudio.last, undefined);
  touch.isActive = true; // and from here on, the player plays
  play("tap");
  assert.ok(FakeAudio.last);
});

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
// D major pentatonic, every octave: D E F♯ A B.
const inKey = (f: number) => [0, 2, 4, 7, 9].includes(((Math.round(12 * Math.log2(f / 587.33)) % 12) + 12) % 12);

test("every right answer sounds the same, D5: nothing counts a row of them", () => {
  const first = () => tones.splice(0)[0]?.hz ?? 0;
  for (const kind of ["right", "exact", "right"] as const) {
    playAnswer(kind);
    assert.ok(near(first(), 587.33), `${kind}: D5`);
  }
  playAnswer("wrong");
  assert.ok(near(first(), 196), "a wrong answer is a low thud");
});

test("every sound is in the one key (but the thud and the bells' inner wobble)", () => {
  const names = ["tap", "key", "count", "go", "tick", "hurry", "right", "exact", "partial", "end"] as const;
  for (const name of [...names, "perfect", "win", "lose", "ping", "pip"] as const)
    for (let lift = 0; lift < 6; lift++) {
      tones.length = 0;
      FakeAudio.last.currentTime += 60;
      play(name, lift);
      assert.ok(tones.length > 0, name);
      for (const t of tones) assert.ok(inKey(t.hz) || inKey(t.hz / 3.5), `${name} +${lift}: ${t.hz.toFixed(1)} Hz`);
    }
});

test("the bigger sounds take turns: a win waits for the end to finish", () => {
  play("end");
  const end = Math.max(...tones.map((t) => t.end));
  const n = tones.length;
  play("win");
  const win = tones.slice(n);
  assert.ok(win.length > 0);
  assert.ok(Math.min(...win.map((t) => t.at)) >= end, "the win starts after the end");
});

test("a big sound that would wait too long is left out, never a backlog", () => {
  play("win");
  const each = tones.length;
  tones.length = 0;
  FakeAudio.last.currentTime += 60;
  for (let i = 0; i < 10; i++) play("win");
  const wins = tones.length / each;
  assert.ok(wins > 1 && wins < 10, `${wins} of the 10 wins played`);
  const now = FakeAudio.last.currentTime;
  assert.ok(Math.max(...tones.map((t) => t.at)) - now < 3, "none is played much later");
});

test("the count before a game sounds only for its last three seconds", () => {
  for (const s of [5, 4, 3, 2, 1, 0]) playCount(s);
  assert.equal(tones.filter((t) => near(t.hz, 880)).length, 3);
});

test("the answers' sounds are short, the moments' longer but under a second and a half", async () => {
  const { length } = await loadFeel();
  for (const name of ["tap", "key", "tick", "hurry", "right", "exact", "partial", "wrong", "time", "pip"] as const)
    assert.ok(length(name) < 0.5, `${name}: ${length(name)} s`);
  for (const name of ["end", "perfect", "win"] as const) assert.ok(length(name) <= 1.4, `${name}: ${length(name)} s`);
});

test("nothing plays with sounds off, or before the page is touched", () => {
  setSound(false);
  play("tap");
  assert.equal(tones.length, 0);
  setSound(true);
  tones.length = 0;
  FakeAudio.last.state = "suspended";
  touch.isActive = false;
  play("tap");
  assert.equal(tones.length, 0, "the audio waits for a touch");
  touch.isActive = true;
  FakeAudio.last.state = "running";
});

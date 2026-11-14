import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// A stand-in for the browser's audio: it keeps every tone started (its pitch and when it starts and stops).
interface Tone {
  hz: number;
  at: number;
  end: number;
}
const tones: Tone[] = [];
const node = () => ({ connect: <T>(n: T) => n });
const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
class FakeAudio {
  static last: FakeAudio;
  state = "running";
  currentTime = 0;
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
  createOscillator() {
    const tone: Tone = { hz: 0, at: 0, end: 0 };
    return {
      ...node(),
      type: "",
      frequency: {
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

const { play, playAnswer, playCount, setSound } = await import("./sound.ts");

beforeEach(() => {
  setSound(true);
  tones.length = 0;
  // Each test starts a while after the last, so nothing of it is still sounding.
  if (FakeAudio.last) FakeAudio.last.currentTime += 60;
});

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

test("a right answer rises a semitone for each before it in a row, up to a fifth", () => {
  const first = () => tones.splice(0)[0]?.hz ?? 0;
  playAnswer("right", 0);
  const base = first();
  assert.ok(near(base, 784));
  playAnswer("right", 3);
  assert.ok(near(first(), base * 2 ** (2 / 12)));
  playAnswer("exact", 30);
  assert.ok(near(first(), base * 2 ** (7 / 12)));
  playAnswer("wrong", 5);
  assert.ok(near(first(), 294), "a wrong answer isn't lifted");
});

test("the bigger sounds take turns: a level waits for the end to finish", () => {
  play("end");
  const end = Math.max(...tones.map((t) => t.end));
  const n = tones.length;
  play("level");
  const level = tones.slice(n);
  assert.ok(level.length > 0);
  assert.ok(Math.min(...level.map((t) => t.at)) >= end, "the level starts after the end");
});

test("a big sound that would wait too long is left out, never a backlog", () => {
  for (let i = 0; i < 10; i++) play("win");
  const wins = tones.length / 6; // a win is six tones
  assert.ok(wins > 1 && wins < 10, `${wins} of the 10 wins played`);
  const now = FakeAudio.last.currentTime;
  assert.ok(Math.max(...tones.map((t) => t.at)) - now < 3, "none is played much later");
});

test("the count before a game beeps only for its last three seconds", () => {
  for (const s of [5, 4, 3, 2, 1, 0]) playCount(s);
  assert.equal(tones.length, 3);
});

test("nothing plays with sounds off, or before the page is touched", () => {
  setSound(false);
  play("tap");
  assert.equal(tones.length, 0);
  setSound(true);
  tones.length = 0;
  FakeAudio.last.state = "suspended";
  play("tap");
  assert.equal(tones.length, 0, "the audio waits for a touch");
  FakeAudio.last.state = "running";
});

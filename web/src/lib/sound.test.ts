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
const panners: { pan: { value: number } }[] = [];
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
  createStereoPanner() {
    const p = { ...node(), pan: param() };
    panners.push(p);
    return p;
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

const { loadFeel, play, playAnswer, playCount, setSound } = await import("./sound.ts");
await loadFeel(); // in the game, the first touch sends for the voices

beforeEach(() => {
  setSound(true);
  tones.length = 0;
  // Each test starts a while after the last, so nothing of it is still sounding.
  if (FakeAudio.last) FakeAudio.last.currentTime += 60;
});

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
// D major pentatonic, every octave: D E F♯ A B.
const inKey = (f: number) => [0, 2, 4, 7, 9].includes(((Math.round(12 * Math.log2(f / 587.33)) % 12) + 12) % 12);

test("a right answer rises a step of the scale for each before it in a row, up to an octave", () => {
  const first = () => tones.splice(0)[0]?.hz ?? 0;
  playAnswer("right", 0);
  assert.ok(near(first(), 587.33), "D5");
  playAnswer("right", 3);
  assert.ok(near(first(), 739.99), "F♯5, two steps up");
  playAnswer("exact", 30);
  assert.ok(near(first(), 1174.66), "D6, and no higher");
  playAnswer("wrong", 5);
  assert.ok(near(first(), 196), "a wrong answer is a low thud, never lifted");
});

test("every sound is in the one key (but the thud and the bells' inner wobble)", () => {
  const names = ["tap", "key", "them", "count", "go", "tick", "hurry", "right", "exact", "partial", "end"] as const;
  for (const name of [...names, "perfect", "win", "lose", "note", "ping", "pip"] as const)
    for (let lift = 0; lift < 6; lift++) {
      tones.length = 0;
      FakeAudio.last.currentTime += 60;
      play(name, lift);
      assert.ok(tones.length > 0, name);
      for (const t of tones) assert.ok(inKey(t.hz) || inKey(t.hz / 3.5), `${name} +${lift}: ${t.hz.toFixed(1)} Hz`);
    }
});

test("the other side answering is two low plucks, A4 then F♯4, off to the right: no bell, which is for what's earned", () => {
  panners.length = 0;
  play("them");
  assert.equal(tones.length, 2, "two plucks, and no bell's wobble");
  assert.ok(near(tones[0]?.hz ?? 0, 440) && near(tones[1]?.hz ?? 0, 369.99), "A4, then F♯4");
  assert.ok(near((tones[1]?.at ?? 0) - (tones[0]?.at ?? 0), 0.06), "60 ms apart");
  assert.equal(panners.length, 1);
  assert.equal(panners[0]?.pan.value, 0.3);
});

test("the bigger sounds take turns: a note waits for the end to finish", () => {
  play("end");
  const end = Math.max(...tones.map((t) => t.end));
  const n = tones.length;
  play("note");
  const note = tones.slice(n);
  assert.ok(note.length > 0);
  assert.ok(Math.min(...note.map((t) => t.at)) >= end, "the note starts after the end");
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
  for (const name of ["end", "perfect", "note", "win", "streak"] as const)
    assert.ok(length(name) <= 1.4, `${name}: ${length(name)} s`);
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

// The game's feel, in a file of its own: the sounds' voices. It loads after the player's first touch (lib/sound.ts
// starts it), since nothing sounds before one, and the first screen doesn't wait for it; until it's in, the game is
// whole and only quieter. Like a screen that loads on its own (kit.ts), it imports nothing of the app but types: what
// it needs comes as arguments, so nothing is split into a file every page would load first.
//
// The sounds are made here, in code (no files): every note is in one key, D major pentatonic (D E F♯ A B), so sounds
// that follow each other sound like one piece. Four voices: a bell (two-operator FM) for what's earned, a wooden pluck
// for the player's own touches, a soft thud for a wrong answer or none (same meaning as a buzzer, no punishment), and a
// plain short beep for the clock. The game's motif, D–A–F♯–D (four petals, the last one gold, as in the logo), is its
// audio logo: the end of a game, a perfect day, a level, a win. The big ones get a little room (a reverb made of
// noise), and everything goes through a compressor, so sounds that meet can't clip.

import type { SoundName } from "./lib/sound.ts";

/** A note: its voice (bell, pluck, thud, beep, noise swell), its pitch in steps of the scale from D5 (−5 is D4,
 * 5 is D6), when it starts (s), how long it rings (s), and how loud (0–1). */
type Note = [voice: "b" | "p" | "t" | "s" | "w", step: number, at: number, ring: number, loud: number];

/** A sound: its notes, and whether it has the room (the reverb): only the big moments do. */
type Cue = { notes: Note[]; room?: boolean };

/** The motif's steps: D5, A5, F♯5, D6. */
const motif = [0, 3, 2, 5];

/** The motif as bells, 110 ms a note, the last held; `harmony` adds a voice a step of the scale above each. */
function motifNotes(loud: number, harmony = false): Note[] {
  const notes: Note[] = motif.map((s, i) => ["b", s, i * 0.11, i === 3 ? 0.9 : 0.4, loud]);
  if (harmony) for (const [i, s] of motif.entries()) notes.push(["b", s + 2, i * 0.11, i === 3 ? 0.9 : 0.4, loud * 0.45]);
  return notes;
}

const cues: Record<SoundName, Cue> = {
  // The player's own touch: a pick, a digit, a move.
  tap: { notes: [["p", 5, 0, 0.04, 0.55]] },
  key: { notes: [["p", 7, 0, 0.03, 0.4]] },
  // Someone else: the other side answering, a player coming into the room. Soft and falling, unlike a tap.
  them: {
    notes: [
      ["b", 3, 0, 0.18, 0.22],
      ["b", 2, 0.07, 0.25, 0.18],
    ],
  },
  // Before a game: a soft bell for each of the last seconds, then the start an octave up over the root.
  count: { notes: [["b", 3, 0, 0.2, 0.35]] },
  go: {
    notes: [
      ["b", 5, 0, 0.45, 0.45],
      ["b", 0, 0, 0.45, 0.3],
    ],
  },
  // The clock, only near the end: a soft tick for each of the last ten seconds but five, then a beep a second for the
  // last five, a step higher each.
  tick: { notes: [["p", 12, 0, 0.012, 0.15]] },
  hurry: { notes: [["s", 3, 0, 0.07, 0.3]] },
  // A right answer: two bells, a step of the scale higher for each right one before it in a row.
  right: {
    notes: [
      ["b", 0, 0, 0.3, 0.6],
      ["b", 2, 0.08, 0.4, 0.55],
    ],
  },
  exact: {
    notes: [
      ["b", 0, 0, 0.25, 0.55],
      ["b", 2, 0.07, 0.25, 0.5],
      ["b", 5, 0.14, 0.45, 0.55],
    ],
  },
  partial: { notes: [["b", 2, 0, 0.3, 0.45]] },
  // A wrong answer and none: a soft thud.
  wrong: { notes: [["t", 0, 0, 0.2, 0.5]] },
  time: { notes: [["t", 0, 0, 0.2, 0.5]] },
  // The end of a game: the motif. A perfect day and a new level: with a harmony, in the room.
  end: { notes: motifNotes(0.55) },
  perfect: { notes: motifNotes(0.55, true), room: true },
  level: { notes: motifNotes(0.55, true), room: true },
  // Won (a duel, Роял): the motif over a low D.
  win: { notes: [...motifNotes(0.55, true), ["b", -10, 0, 1.3, 0.4]], room: true },
  lose: {
    notes: [
      ["b", 2, 0, 0.3, 0.4],
      ["b", 1, 0.13, 0.3, 0.35],
      ["b", 0, 0.26, 0.55, 0.35],
    ],
  },
  // A day's goal done: two bells, up a fourth.
  goal: {
    notes: [
      ["b", 3, 0, 0.3, 0.5],
      ["b", 5, 0.1, 0.5, 0.5],
    ],
  },
  achievement: {
    notes: [
      ["b", 5, 0, 0.3, 0.45],
      ["b", 7, 0.08, 0.3, 0.45],
      ["b", 8, 0.16, 0.7, 0.5],
    ],
    room: true,
  },
  // Something new: an opponent found, a friend's challenge or request.
  ping: {
    notes: [
      ["b", 7, 0, 0.2, 0.35],
      ["b", 5, 0.09, 0.3, 0.3],
    ],
  },
  // The result's pips filling: a pluck on the scale for each right one (lifted to its place), a quieter thud for
  // each that wasn't.
  pip: { notes: [["p", 0, 0, 0.05, 0.4]] },
  dud: { notes: [["t", 0, 0, 0.12, 0.15]] },
  // The streak one day longer: a warm rising fifth over a swell of air.
  streak: {
    notes: [
      ["w", 0, 0, 0.4, 0.12],
      ["b", -5, 0, 0.35, 0.45],
      ["b", -2, 0.12, 0.5, 0.5],
    ],
  },
  // Роял's cut: through (two bells up a fifth, then the octave shimmering), or out (a soft fall).
  through: {
    notes: [
      ["b", 0, 0, 0.3, 0.55],
      ["b", 3, 0.12, 0.3, 0.55],
      ["b", 5, 0.26, 0.45, 0.45],
      ["b", 5.04, 0.26, 0.45, 0.3],
    ],
    room: true,
  },
  out: {
    notes: [
      ["b", -2, 0, 0.3, 0.4],
      ["b", -3, 0.15, 0.35, 0.35],
    ],
  },
};

/** A step of the scale from D5 as a pitch (Hz): D E F♯ A B in each octave. A fraction of a step detunes. */
function hz(step: number): number {
  const s = Math.floor(step);
  const octave = Math.floor(s / 5);
  const semis = 12 * octave + ([0, 2, 4, 7, 9][s - 5 * octave] ?? 0) + (step - s);
  return 587.33 * 2 ** (semis / 12);
}

/** How long a sound lasts (s). */
export function length(name: SoundName): number {
  return Math.max(...cues[name].notes.map(([, , at, ring]) => at + ring));
}

/** The sounds' way out, made once for each audio: the level, then a compressor before the speakers, and the room
 * (a short reverb of decaying noise) beside it for the big sounds. */
const buses = new WeakMap<BaseAudioContext, { dry: AudioNode; room: AudioNode; noise: AudioBuffer }>();

function bus(c: BaseAudioContext) {
  let b = buses.get(c);
  if (b) return b;
  const squeeze = c.createDynamicsCompressor();
  squeeze.threshold.value = -18;
  squeeze.ratio.value = 4;
  squeeze.attack.value = 0.003;
  squeeze.release.value = 0.12;
  squeeze.connect(c.destination);
  const dry = c.createGain();
  dry.gain.value = 0.3; // quiet: the game is often played among people
  dry.connect(squeeze);
  // The room: 0.8 s of stereo noise fading fast, mixed in at an eighth.
  const rate = c.sampleRate;
  const impulse = c.createBuffer(2, Math.round(0.8 * rate), rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / rate / 0.18);
  }
  const verb = c.createConvolver();
  verb.buffer = impulse;
  const wet = c.createGain();
  wet.gain.value = 0.12;
  verb.connect(wet).connect(dry);
  // White noise, for the pluck's click, the thud's knock and the swell.
  const noise = c.createBuffer(1, Math.round(0.5 * rate), rate);
  const n = noise.getChannelData(0);
  for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
  b = { dry, room: verb, noise };
  buses.set(c, b);
  return b;
}

/** A gain that rises in `attack` s from silence to `loud` at `at`, then fades away over `ring` s. */
function envelope(c: BaseAudioContext, at: number, attack: number, ring: number, loud: number): GainNode {
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(loud, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + attack + ring);
  return env;
}

function osc(c: BaseAudioContext, f: number, at: number, end: number, to: AudioNode, wave: OscillatorType = "sine") {
  const o = c.createOscillator();
  o.type = wave;
  o.frequency.value = f;
  o.connect(to);
  o.start(at);
  o.stop(end);
  return o;
}

/** A burst of noise through a filter. */
function noise(c: BaseAudioContext, buffer: AudioBuffer, at: number, ring: number, filter: BiquadFilterType, f: number, q: number, env: AudioNode) {
  const src = c.createBufferSource();
  src.buffer = buffer;
  const shape = c.createBiquadFilter();
  shape.type = filter;
  shape.frequency.value = f;
  shape.Q.value = q;
  src.connect(shape).connect(env);
  src.start(at);
  src.stop(at + ring + 0.02);
  return shape;
}

/** Plays a sound from `t0` (in the audio's time), `lift` steps of the scale higher. */
export function sound(c: BaseAudioContext, name: SoundName, lift: number, t0: number): void {
  const { dry, room, noise: white } = bus(c);
  const cue = cues[name];
  for (const [voice, step, at, ring, loud] of cue.notes) {
    const t = t0 + at;
    const f = hz(step + lift);
    const end = t + ring + 0.05;
    if (voice === "b") {
      // The bell: a sine whose pitch a second sine, 3.5 times higher, wobbles: hard at first (index 3), gone by 250 ms.
      const env = envelope(c, t, 0.004, ring, loud);
      env.connect(dry);
      if (cue.room) env.connect(room);
      const carrier = osc(c, f, t, end, env);
      const depth = c.createGain();
      depth.gain.setValueAtTime(3 * 3.5 * f, t);
      depth.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
      osc(c, 3.5 * f, t, end, depth);
      depth.connect(carrier.frequency);
    } else if (voice === "p") {
      // The pluck: a click of band-passed noise and the note, both gone at once, like a pencil's tick.
      const click = envelope(c, t, 0.001, 0.006, loud * 0.8);
      click.connect(dry);
      noise(c, white, t, 0.008, "bandpass", 3000, 1.2, click);
      const body = envelope(c, t, 0.002, ring, loud);
      body.connect(dry);
      osc(c, f, t, end, body);
    } else if (voice === "t") {
      // The thud: a low sine bending down (G3 to D3), its octave above for a phone's small speaker, and a knock of
      // low noise.
      const env = envelope(c, t, 0.006, ring, loud);
      env.connect(dry);
      for (const [from, to, share] of [
        [196, 147, 1],
        [392, 294, 0.5],
      ] as const) {
        const level = c.createGain();
        level.gain.value = share;
        level.connect(env);
        const o = osc(c, from, t, end, level);
        o.frequency.setValueAtTime(from, t);
        o.frequency.exponentialRampToValueAtTime(to, t + 0.12);
      }
      const knock = envelope(c, t, 0.002, 0.04, loud * 0.6);
      knock.connect(dry);
      noise(c, white, t, 0.04, "lowpass", 800, 0.7, knock);
    } else if (voice === "s") {
      // The beep: a plain short sine, for the clock.
      const env = envelope(c, t, 0.005, ring, loud);
      env.connect(dry);
      osc(c, f, t, end, env);
    } else {
      // The swell: air rising and falling under a sound, through a filter that opens.
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(loud, t + ring * 0.6);
      env.gain.exponentialRampToValueAtTime(0.0001, t + ring);
      env.connect(dry);
      const shape = noise(c, white, t, ring, "bandpass", 600, 0.8, env);
      shape.frequency.exponentialRampToValueAtTime(2400, t + ring);
    }
  }
}

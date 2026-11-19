// The game's feel, in a file of its own: the sounds' voices, the result's moment (a game's end as a short sequence),
// the streak and the level growing in place, and the sheet for big news. It loads after the player's first touch
// (lib/sound.ts starts it), since nothing sounds or ends before one, and the first screen doesn't wait for it; until
// it's in, the game is whole and only plainer: the screens always draw the end state, and this only moves them there.
// Like a screen that loads on its own (kit.ts), it imports nothing of the app but types: what it needs comes as
// arguments, so nothing is split into a file every page would load first. Its motion is in the Web Animations API and
// its few styles through the CSSOM (the page's CSP allows no style element), so it needs no stylesheet of its own.
//
// Motion is quiet and once: no confetti, no particles, nothing that loops. With less motion („По-малко движение“) every
// moment shows its end state at once, with its sound.
//
// The sounds are made here, in code (no files): every note is in one key, D major pentatonic (D E F♯ A B), so sounds
// that follow each other sound like one piece. Four voices: a bell (two-operator FM) for what's earned, a wooden pluck
// for the player's own touches, a soft thud for a wrong answer or none (same meaning as a buzzer, no punishment), and a
// plain short beep for the clock. The game's motif, D–A–F♯–D (four petals, the last one gold, as in the logo), is its
// audio logo: the end of a game, a perfect day, a level, a win. The big ones get a little room (a reverb made of
// noise), and everything goes through a compressor, so sounds that meet can't clip. The game's only music is here too:
// a quiet bed for Роял's lobby (bed).

import type { SoundName } from "./lib/sound.ts";

/** A note: its voice (bell, pluck, thud, beep, noise swell), its pitch in steps of the scale from D5 (−5 is D4,
 * 5 is D6), when it starts (s), how long it rings (s), and how loud (0–1). */
type Note = [voice: "b" | "p" | "t" | "s" | "w", step: number, at: number, ring: number, loud: number];

/** A sound: its notes, whether it has the room (the reverb): only the big moments do; and where it stands, left (−1)
 * to right (1), if not in the middle. */
type Cue = { notes: Note[]; room?: boolean; pan?: number };

/** The motif's steps: D5, A5, F♯5, D6. */
const motif = [0, 3, 2, 5];

/** The motif as bells, 110 ms a note, the last held; `harmony` adds a voice a step of the scale above each. */
function motifNotes(loud: number, harmony = false): Note[] {
  const notes: Note[] = motif.map((s, i) => ["b", s, i * 0.11, i === 3 ? 0.9 : 0.4, loud]);
  if (harmony)
    for (const [i, s] of motif.entries()) notes.push(["b", s + 2, i * 0.11, i === 3 ? 0.9 : 0.4, loud * 0.45]);
  return notes;
}

const cues: Record<SoundName, Cue> = {
  // The player's own touch: a pick, a digit, a move.
  tap: { notes: [["p", 5, 0, 0.04, 0.55]] },
  key: { notes: [["p", 7, 0, 0.03, 0.4]] },
  // Someone else: the other side answering, a player coming into the room. Two soft low plucks, falling (A4, F♯4),
  // off to one side: not a bell, which is for what's earned, and never the player's own tap.
  them: {
    notes: [
      ["p", -2, 0, 0.1, 0.4],
      ["p", -3, 0.06, 0.14, 0.32],
    ],
    pan: 0.3,
  },
  // Before a game: a soft bell for each of the last seconds, then the start an octave up over the root.
  count: { notes: [["b", 3, 0, 0.2, 0.55]] },
  go: {
    notes: [
      ["b", 5, 0, 0.45, 0.45],
      ["b", 0, 0, 0.45, 0.3],
    ],
  },
  // The clock, only near the end: a soft tick for each of the last ten seconds but five, then a beep a second for the
  // last five, a step higher each.
  tick: { notes: [["p", 12, 0, 0.012, 0.45]] },
  hurry: { notes: [["s", 3, 0, 0.07, 0.5]] },
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
      ["b", 5, 0.14, 0.34, 0.55],
    ],
  },
  partial: { notes: [["b", 2, 0, 0.3, 0.45]] },
  // A wrong answer and none: a soft thud.
  wrong: { notes: [["t", 0, 0, 0.2, 0.9]] },
  time: { notes: [["t", 0, 0, 0.2, 0.9]] },
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
  dud: { notes: [["t", 0, 0, 0.12, 0.3]] },
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
function noise(
  c: BaseAudioContext,
  buffer: AudioBuffer,
  at: number,
  ring: number,
  filter: BiquadFilterType,
  f: number,
  q: number,
  env: AudioNode,
) {
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

/** The bell: a sine whose pitch a second sine, 3.5 times higher, wobbles: hard at first (index 3), gone by 250 ms. */
function bell(c: BaseAudioContext, f: number, t: number, ring: number, loud: number, to: AudioNode[]): void {
  const env = envelope(c, t, 0.004, ring, loud);
  for (const out of to) env.connect(out);
  const end = t + ring + 0.05;
  const carrier = osc(c, f, t, end, env);
  const depth = c.createGain();
  depth.gain.setValueAtTime(3 * 3.5 * f, t);
  depth.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
  osc(c, 3.5 * f, t, end, depth);
  depth.connect(carrier.frequency);
}

/** Plays a sound from `t0` (in the audio's time), `lift` steps of the scale higher. */
export function sound(c: BaseAudioContext, name: SoundName, lift: number, t0: number): void {
  const { dry: middle, room, noise: white } = bus(c);
  const cue = cues[name];
  let dry: AudioNode = middle;
  if (cue.pan && typeof c.createStereoPanner === "function") {
    const side = c.createStereoPanner();
    side.pan.value = cue.pan;
    side.connect(middle);
    dry = side;
  }
  for (const [voice, step, at, ring, loud] of cue.notes) {
    const t = t0 + at;
    const f = hz(step + lift);
    const end = t + ring + 0.05;
    if (voice === "b") bell(c, f, t, ring, loud, cue.room ? [dry, room] : [dry]);
    else if (voice === "p") {
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
        [392, 294, 0.7],
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

// ---- Music ----

/** Роял's lobby music while it plays: `until` is when the games start (in the audio's time), for the build in their
 * last ten seconds; `stop` ends it, with the motif's first two notes as the games begin (`begin`), or else fading. */
export interface Bed {
  until(at: number): void;
  stop(begin: boolean): void;
}

/** The bed's bar (s): four beats at 64 a minute. */
const bar = (4 * 60) / 64;
/** Its four bars' chords, a root and a fifth of the scale in steps from D5: D3–A3, B2–F♯3, E3–B3, A2–E3. */
const chords = [
  [-10, -7],
  [-11, -8],
  [-9, -6],
  [-12, -9],
];

/** The music in Роял's lobby, the only music in the game: a quiet bed in the game's key, four bars at 64 a minute
 * going round. A pad of two detuned saws for each note of a chord, and a softer triangle an octave up (what a phone's
 * small speaker can play: the saws' roots are under it), low-passed at 1.6 kHz with the filter slowly breathing; a
 * soft bell of the scale (D5 to D6) every two bars, picked at random; all in the room, 24 dB under the sounds
 * (at a third of this level it sat 31 dB and more under them, lost on a phone). In its last ten seconds the
 * filter opens to 3 kHz and a rush of noise rises into the start. */
export function bed(c: BaseAudioContext): Bed {
  const { dry, room, noise: white } = bus(c);
  const t0 = c.currentTime + 0.05;
  const level = c.createGain();
  level.gain.setValueAtTime(0.0001, t0);
  level.gain.exponentialRampToValueAtTime(0.1, t0 + 3); // 24 dB under a cue (rms): fades in over three seconds
  level.connect(dry);
  level.connect(room);
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1600;
  filter.Q.value = 0.7;
  filter.connect(level);
  const sway = c.createGain(); // the filter breathing: ±250 Hz, once in 14 s
  sway.gain.value = 250;
  sway.connect(filter.frequency);
  const lfo = osc(c, 0.07, t0, t0 + 3600, sway);
  const saws = [0, 1, 2, 3].map((i) => {
    const voice = c.createGain();
    voice.gain.value = 0.2;
    voice.connect(filter);
    const o = osc(c, hz(chords[0]?.[i >> 1] ?? 0), t0, t0 + 3600, voice, "sawtooth");
    o.detune.value = i % 2 ? 7 : -7;
    return o;
  });
  // The octave up: the chord's two notes again, as triangles, under the saws' level.
  const highs = [0, 1].map((i) => {
    const voice = c.createGain();
    voice.gain.value = 0.12;
    voice.connect(filter);
    return osc(c, 2 * hz(chords[0]?.[i] ?? 0), t0, t0 + 3600, voice, "triangle");
  });
  // The bars, laid a little ahead as they come.
  let next = t0;
  let n = 0;
  const lay = () => {
    while (next < c.currentTime + 1.5 * bar) {
      const chord = chords[n % chords.length] ?? [0, 0];
      for (const [i, o] of saws.entries()) o.frequency.setTargetAtTime(hz(chord[i >> 1] ?? 0), next, 0.3);
      for (const [i, o] of highs.entries()) o.frequency.setTargetAtTime(2 * hz(chord[i] ?? 0), next, 0.3);
      if (n % 2 === 0) bell(c, hz(Math.floor(Math.random() * 6)), next + bar / 4, 2.5, 0.35, [level]);
      next += bar;
      n++;
    }
  };
  lay();
  const laying = setInterval(lay, 1000);
  let rush: AudioBufferSourceNode | null = null;
  return {
    until(at) {
      const from = Math.max(c.currentTime + 0.05, at - 10);
      if (at <= from) return;
      filter.frequency.setValueAtTime(1600, from);
      filter.frequency.exponentialRampToValueAtTime(3000, at);
      rush?.stop();
      rush = c.createBufferSource();
      rush.buffer = white;
      rush.loop = true;
      const band = c.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 1.5;
      band.frequency.setValueAtTime(400, from);
      band.frequency.exponentialRampToValueAtTime(5000, at);
      const swell = c.createGain();
      swell.gain.setValueAtTime(0.0001, from);
      swell.gain.exponentialRampToValueAtTime(0.6, at);
      rush.connect(band).connect(swell).connect(level);
      rush.start(from);
    },
    stop(begin) {
      clearInterval(laying);
      const t = c.currentTime + 0.02;
      const end = t + (begin ? 0.5 : 1.2);
      level.gain.cancelScheduledValues(t);
      level.gain.setValueAtTime(Math.max(level.gain.value, 0.0001), t);
      level.gain.exponentialRampToValueAtTime(0.0001, end);
      for (const o of [...saws, ...highs, lfo]) o.stop(end + 0.1);
      rush?.stop(end + 0.1);
      if (begin)
        for (const [i, s] of motif.slice(0, 2).entries()) bell(c, hz(s), t + i * 0.11, 0.4 + i * 0.3, 0.55, [dry]);
    },
  };
}

// ---- Motion ----

/** What the motion needs of the app: whether there's to be less of it, the sounds, and numbers written the Bulgarian
 * way. */
export interface Hands {
  calm: boolean;
  play: (name: SoundName, lift?: number) => void;
  format: (n: number) => string;
}

/** A spring that overshoots a little, for things that land. */
const spring = "cubic-bezier(0.2, 1.4, 0.4, 1)";
const settleIn = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** A token's value from the stylesheet (the theme's own colour, for a keyframe). */
const token = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim();

/** A number counting up from `from` to `to` in an element, over `ms` from `delay`. */
function count(el: Element, from: number, to: number, delay: number, ms: number, format: (n: number) => string) {
  el.textContent = format(from);
  const start = performance.now() + delay;
  const step = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - start) / ms));
    el.textContent = format(Math.round((from + (to - from) * easeOut(t)) / 10) * 10);
    if (t < 1 && el.isConnected) requestAnimationFrame(step);
    else el.textContent = format(to);
  };
  requestAnimationFrame(step);
}

/**
 * A game's result as a moment, once, as it opens (at most 1.6 s; a tap anywhere jumps to the end): the pips fill one
 * by one with a pluck on the scale for each right one, the score lands with the game's motif, the points count up;
 * ten of ten sweeps the pips in gold and draws the seal petal by petal. Resolves once it's over. `gap` is the time
 * between two pips (the day's ten take it slower, 85 ms: it's the game of the day).
 */
export function result(hero: HTMLElement, perfect: boolean, hands: Hands, gap = 60): Promise<void> {
  const { play } = hands;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    play(perfect ? "perfect" : "end");
  };
  const points = hero.querySelector(".points-n");
  const total = Number(points?.getAttribute("data-n") ?? 0);
  if (hands.calm) {
    end();
    return Promise.resolve();
  }
  const moving: Animation[] = [];
  const timers: number[] = [];
  const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const pips = [...hero.querySelectorAll<HTMLElement>(".trail li")];
  // Each pluck a step up the scale for each right answer before it, as the bell in a run: a good game climbs, a
  // wrong one thuds where the climb stands. The score lands as the last pip fills.
  let rights = 0;
  pips.forEach((li, i) => {
    moving.push(
      li.animate(
        [
          { transform: "scale(0.6)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        {
          duration: 180,
          delay: i * gap,
          easing: spring,
          fill: "backwards",
        },
      ),
    );
    const lift = rights;
    if (li.classList.contains("right")) rights++;
    at(i * gap, () => play(li.classList.contains("wrong") ? "dud" : "pip", lift));
  });
  const lands = Math.max(700, (pips.length - 1) * gap + 160);
  const score = hero.querySelector(".score");
  if (score)
    moving.push(
      score.animate(
        [
          { transform: "scale(1.15)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        {
          duration: 260,
          delay: lands,
          easing: spring,
          fill: "backwards",
        },
      ),
    );
  at(lands, end);
  if (points) count(points, 0, total, lands, Math.min(800, 1550 - lands), hands.format);
  if (perfect) {
    const gold = token(hero, "--gold");
    for (const [i, li] of pips.entries())
      moving.push(
        li.animate([{}, { background: gold, boxShadow: `0 0 14px ${gold}` }, {}], {
          duration: 420,
          delay: lands + 200 + i * 40,
        }),
      );
    const head = hero.querySelector(".perfect-head .kicker");
    if (head)
      moving.push(
        head.animate([{ opacity: 0, transform: "translateY(6px)" }, {}], {
          duration: 260,
          delay: lands + 200,
          fill: "backwards",
        }),
      );
    for (const [k, petal] of [...hero.querySelectorAll(".seal path")].entries())
      moving.push(
        petal.animate(
          [
            { transform: "scale(0)", opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 240, delay: lands + 200 + k * 90, easing: spring, fill: "backwards" },
        ),
      );
  }
  return new Promise((resolve) => {
    const done = () => {
      for (const t of timers) clearTimeout(t);
      for (const a of moving) a.finish();
      removeEventListener("pointerdown", done, true);
      removeEventListener("keydown", done, true);
      if (points) points.textContent = hands.format(total);
      end();
      resolve();
    };
    addEventListener("pointerdown", done, true);
    addEventListener("keydown", done, true);
    at(1600, done);
  });
}

/** What a duel's moment needs besides its card (screens/outcome.ts): each side's points question by question (the
 * other's none while the duel waits for them), the end's sound, and the question that decided it (from 1; 0: none). */
export interface DuelPlan {
  mine: number[];
  theirs: number[];
  end: SoundName;
  decided: number;
}

/**
 * A duel's result as a moment, once (at most 1.6 s; a tap anywhere jumps to the end). The verdict waits while the
 * marks fill pair by pair, 75 ms apart, a pluck on the scale for each of the player's right ones and a muted thud for
 * each that wasn't; the two scores count up with them, so the lead changes hands as it did, and the band behind the
 * question that decided it lights as it's reached. Then the verdict and the scores land, the winner's turning gold,
 * with the end's sound (the motif over a low D for a win, a soft fall for a loss); and what it meant fades in, the
 * rating's bar filling from where it was. Resolves once it's over.
 */
export function duel(card: HTMLElement, plan: DuelPlan, hands: Hands): Promise<void> {
  const { play, format } = hands;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    play(plan.end);
  };
  if (hands.calm) {
    end();
    return Promise.resolve();
  }
  const moving: Animation[] = [];
  const timers: number[] = [];
  const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const rise = (el: Element | null, delay: number, from: Keyframe = { opacity: 0, transform: "translateY(6px)" }) => {
    if (el) moving.push(el.animate([from, {}], { duration: 240, delay, easing: settleIn, fill: "backwards" }));
  };
  const pips = [...card.querySelectorAll<HTMLElement>(".duel-pip")];
  const n = pips.length / 2;
  const rows = [pips.slice(0, n), pips.slice(n)];
  const points = [...card.querySelectorAll<HTMLElement>(".duel-points[data-n]")];
  const finals = points.map((p) => Number(p.dataset.n ?? 0));
  const sums = [0, 0];
  for (const p of points) p.textContent = format(0);
  const first = 100;
  const step = 75;
  for (let i = 0; i < n; i++) {
    const t = first + i * step;
    for (const row of rows) {
      const pip = row[i];
      if (pip)
        moving.push(
          pip.animate(
            [
              { transform: "scale(0.6)", opacity: 0 },
              { transform: "none", opacity: 1 },
            ],
            { duration: 180, delay: t, easing: spring, fill: "backwards" },
          ),
        );
    }
    at(t, () => {
      const mine = rows[0]?.[i];
      if (mine && i < plan.mine.length) play(mine.classList.contains("wrong") ? "dud" : "pip", i);
      sums[0] = (sums[0] ?? 0) + (plan.mine[i] ?? 0);
      sums[1] = (sums[1] ?? 0) + (plan.theirs[i] ?? 0);
      points.forEach((p, k) => {
        p.textContent = format(sums[k] ?? 0);
      });
    });
  }
  if (plan.decided > 1) rise(card.querySelector(".duel-band"), first + (plan.decided - 1) * step, { opacity: 0 });
  const landAt = first + n * step + 50;
  for (const el of card.querySelectorAll(".duel-head h1, .duel-line, .duel-key")) rise(el, landAt);
  for (const p of points)
    moving.push(
      p.animate(
        [
          { transform: "scale(1.15)", opacity: 0.6 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 260, delay: landAt, easing: spring, fill: "backwards" },
      ),
    );
  // The winner is gold only once it's landed.
  const winner = card.querySelector(".duel-face.win");
  winner?.classList.remove("win");
  const settle = () => {
    winner?.classList.add("win");
    points.forEach((p, k) => {
      p.textContent = format(finals[k] ?? 0);
    });
    end();
  };
  at(landAt, settle);
  rise(card.querySelector(".duel-meant"), landAt + 150);
  const fill = card.querySelector(".duel-rating .meter-fill");
  const shares = card.querySelector<HTMLElement>(".duel-rating-line")?.dataset;
  if (fill && shares)
    moving.push(
      fill.animate([{ width: `${shares.from}%` }, { width: `${shares.to}%` }], {
        duration: 450,
        delay: landAt + 200,
        easing: settleIn,
        fill: "backwards",
      }),
    );
  return new Promise((resolve) => {
    const done = () => {
      for (const t of timers) clearTimeout(t);
      for (const a of moving) a.finish();
      removeEventListener("pointerdown", done, true);
      removeEventListener("keydown", done, true);
      settle();
      resolve();
    };
    addEventListener("pointerdown", done, true);
    addEventListener("keydown", done, true);
    at(1600, done);
  });
}

/** A number in place rolling from what it was to what it is: the old one slides up and out, the new one in from
 * below. */
function roll(el: HTMLElement, from: string, to: string): Promise<void> {
  const box = document.createElement("span");
  box.style.cssText = "display:inline-grid;overflow:hidden;vertical-align:bottom";
  const was = document.createElement("span");
  const now = document.createElement("span");
  was.textContent = from;
  now.textContent = to;
  for (const s of [was, now]) s.style.gridArea = "1/1";
  box.append(was, now);
  el.replaceChildren(box);
  const options = { duration: 300, easing: settleIn, fill: "both" as const };
  was.animate([{ transform: "none" }, { transform: "translateY(-100%)", opacity: 0 }], options);
  const put = () => el.replaceChildren(to);
  return now
    .animate(
      [
        { transform: "translateY(100%)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      options,
    )
    .finished.then(put, put);
}

/** The streak one day longer, in its chip (drawn with the new number): once `after` has come (the result has landed),
 * the number rolls up from the day before (a first streak's words come in with it: never „0 ден поред“), its words
 * (`label`, of a number) following the number shown, as the level's do: never „1 дни поред“. The flame swells once
 * with a gold glow, and the streak's sound. Resolves once it's over. */
export async function streak(
  chip: HTMLElement,
  days: number,
  label: (n: number) => string,
  after: Promise<void>,
  hands: Hands,
): Promise<void> {
  const n = chip.querySelector<HTMLElement>(".status-n");
  const words = chip.querySelector<HTMLElement>(".status-text");
  const said = chip.querySelector<HTMLElement>(".status-label");
  const first = days === 1 && !!words;
  const was = first ? "" : String(days - 1);
  if (!hands.calm && n) {
    n.textContent = was;
    if (first) words.style.opacity = "0";
    else if (said) said.textContent = label(days - 1);
  }
  await after;
  hands.play("streak");
  if (said) said.textContent = label(days);
  if (hands.calm || !n) return;
  if (first) {
    words.style.opacity = "";
    words.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: settleIn });
  }
  const gold = token(chip, "--gold");
  const swell = chip.querySelector(".status-flame")?.animate(
    [
      { transform: "none", filter: "none" },
      { transform: "scale(1.25)", filter: `drop-shadow(0 0 10px ${gold})` },
      { transform: "none", filter: "none" },
    ],
    { duration: 600, easing: "ease-in-out" },
  );
  await Promise.all([roll(n, was, String(days)), swell?.finished.catch(() => {})]);
}

/** The level growing in its chip (drawn as it is now): once `after` has come, the bar fills from where it was; a new
 * level fills it to the end, flashes in its lilac, rolls the number and fills again from nothing. Resolves once it's
 * over. */
export async function level(
  chip: HTMLElement,
  from: { level: number; share: number; left: string },
  to: { level: number; share: number; left: string },
  after: Promise<void>,
  hands: Hands,
): Promise<void> {
  const fill = chip.querySelector<HTMLElement>(".meter-fill");
  const n = chip.querySelector<HTMLElement>(".level-num");
  const left = chip.querySelector<HTMLElement>(".status-label");
  if (hands.calm || !fill || !n || (from.level === to.level && from.share >= to.share)) return;
  const width = (p: number) => `${Math.max(0, Math.min(100, p))}%`;
  const grow = (a: number, b: number, ms: number) =>
    fill.animate([{ width: width(a) }, { width: width(b) }], { duration: ms, easing: settleIn, fill: "both" }).finished;
  // As it was before the game, until its moment comes.
  if (left) left.textContent = from.left;
  n.textContent = String(from.level);
  fill.style.width = width(from.share);
  try {
    await after;
    if (to.level === from.level) await grow(from.share, to.share, 700);
    else {
      const lilac = token(chip, "--lilac");
      await grow(from.share, 100, 700);
      await fill.animate([{ background: lilac, boxShadow: `0 0 10px ${lilac}` }, {}], { duration: 200 }).finished;
      if (left) left.textContent = to.left;
      await roll(n, String(from.level), String(to.level));
      await grow(0, to.share, 500);
    }
  } catch {
    // an animation cancelled on its way (the screen gone): straight to the end
  } finally {
    for (const a of fill.getAnimations()) a.cancel();
    fill.style.width = width(to.share);
    n.textContent = String(to.level);
    if (left) left.textContent = to.left;
  }
}

/**
 * The sheet for the one big thing a game brought, over the result (at most one a game): it slides up from the bottom,
 * opaque, over the screen dimming behind it, its picture lands (and, `glow`, glows once), and its sound plays as it
 * opens. „Продължи“, a tap beside it or Esc puts it away, sliding back down; it never goes by itself. `parts` are its
 * picture, kicker, name and lines, drawn by the app (the name with the id "moment-name"). `actions`, if given, are its
 * own buttons in place of „Продължи“ (the first focused), each told how to put the sheet away. Resolves once it's put
 * away.
 */
export function sheet(
  parts: Element[],
  sound: SoundName,
  glow: boolean,
  hands: Hands,
  actions?: (close: () => void) => HTMLElement[],
): Promise<void> {
  // The name's sheet's look (app.css, .sheet), its words centred.
  const box = document.createElement("dialog");
  box.className = "sheet";
  box.setAttribute("aria-labelledby", "moment-name");
  const panel = document.createElement("section");
  panel.className = "card sheet-panel";
  panel.style.cssText = "justify-items:center;gap:var(--space-3);text-align:center";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "btn primary big";
  go.style.cssText = "width:100%;margin-top:var(--space-3)";
  go.textContent = "Продължи";
  // Put away, it slides back down as the screen under it brightens again; with less motion, at once.
  let going = false;
  const close = () => {
    if (!box.open || going) return;
    going = true;
    if (hands.calm) return box.close();
    const away = { duration: 200, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" } as const;
    box.animate([{}, { backgroundColor: "transparent" }], away);
    const shut = () => box.close();
    panel.animate([{ transform: "none" }, { transform: "translateY(100%)" }], away).finished.then(shut, shut);
  };
  const own = actions?.(close);
  const buttons = own?.length ? own : [go];
  panel.append(...parts, ...buttons);
  box.append(panel);
  document.body.append(box);
  box.showModal();
  buttons[0]?.focus();
  hands.play(sound);
  const [picture] = parts;
  if (!hands.calm) {
    // Only what's behind it dims in: the sheet is opaque all the way up, nothing shows through it.
    box.animate([{ backgroundColor: "transparent" }, {}], { duration: 200 });
    panel.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 320, easing: settleIn });
    picture?.animate([{ transform: "scale(0.6)" }, { transform: "none" }], {
      duration: 420,
      delay: 120,
      easing: spring,
    });
    if (glow && picture) {
      const gold = token(panel, "--gold");
      picture.animate([{ filter: "none" }, { filter: `drop-shadow(0 0 24px ${gold})` }, { filter: "none" }], {
        duration: 900,
        delay: 300,
      });
    }
  }
  return new Promise((resolve) => {
    box.addEventListener("close", () => {
      box.remove();
      resolve();
    });
    // Esc puts it away the same way (a second Esc meanwhile is the browser's: at once).
    box.addEventListener("cancel", (e) => {
      e.preventDefault();
      close();
    });
    go.addEventListener("click", close);
    box.addEventListener("click", (e) => {
      if (e.target === box) close();
    });
  });
}

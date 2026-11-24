// The game's feel, in a file of its own: the sounds' voices, the result's moment (a game's end as a short sequence),
// a duel's. It loads after the player's first touch
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
// audio logo: the end of a game, a perfect day, a win. The big ones get a little room (a reverb made of noise), and
// everything goes through a compressor, so sounds that meet can't clip.

import type { SoundName } from "./lib/sound.ts";

/** A note: its voice (bell, pluck, thud, beep), its pitch in steps of the scale from D5 (−5 is D4,
 * 5 is D6), when it starts (s), how long it rings (s), and how loud (0–1). */
type Note = [voice: "b" | "p" | "t" | "s", step: number, at: number, ring: number, loud: number];

/** A sound: its notes, and whether it has the room (the reverb): only the big moments do. */
type Cue = { notes: Note[]; room?: boolean };

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
  // A right answer: two bells, the same for every one (nothing counts a row of them).
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
  // The end of a game: the motif. A perfect day: with a harmony, in the room.
  end: { notes: motifNotes(0.55) },
  perfect: { notes: motifNotes(0.55, true), room: true },
  // Won (a duel): the motif over a low D.
  win: { notes: [...motifNotes(0.55, true), ["b", -10, 0, 1.3, 0.4]], room: true },
  lose: {
    notes: [
      ["b", 2, 0, 0.3, 0.4],
      ["b", 1, 0.13, 0.3, 0.35],
      ["b", 0, 0.26, 0.55, 0.35],
    ],
  },
  // Something new: an opponent found, a friend's request.
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
  // White noise, for the pluck's click and the thud's knock.
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
  const { dry, room, noise: white } = bus(c);
  const cue = cues[name];
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
    } else {
      // The beep: a plain short sine, for the clock.
      const env = envelope(c, t, 0.005, ring, loud);
      env.connect(dry);
      osc(c, f, t, end, env);
    }
  }
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

/** A token's value from the stylesheet (the theme's own colour, for a keyframe). */
const token = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim();

/**
 * A game's result as a moment, once, as it opens (at most 1.6 s; a tap anywhere jumps to the end): the pips fill one
 * by one with a pluck on the scale for each right one, the score lands with the game's motif;
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

  if (hands.calm) {
    end();
    return Promise.resolve();
  }
  const moving: Animation[] = [];
  const timers: number[] = [];
  const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const pips = [...hero.querySelectorAll<HTMLElement>(".trail li, .tiles .tile")];
  // Each pluck a step up the scale for each right answer before it: a good game climbs as its score does, a
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
  // The numeral alone lands: „от 10“ beside it is there from the start, the place it fills (the whole score hidden
  // left a hole the size of the screen's biggest number for most of a second).
  const score = hero.querySelector(".score-n");
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

  if (perfect) {
    const gold = token(hero, "--gold");
    for (const [i, li] of pips.entries())
      moving.push(
        li.animate([{}, { background: gold, boxShadow: `0 0 14px ${gold}` }, {}], {
          duration: 420,
          delay: lands + 200 + i * 40,
        }),
      );
    const head = hero.querySelector(".perfect-words");
    if (head)
      moving.push(
        head.animate([{ opacity: 0, transform: "translateY(6px)" }, {}], {
          duration: 260,
          delay: lands + 200,
          fill: "backwards",
        }),
      );
    for (const [k, petal] of [...hero.querySelectorAll(".perfect-mark path")].entries())
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

      end();
      resolve();
    };
    addEventListener("pointerdown", done, true);
    addEventListener("keydown", done, true);
    at(1600, done);
  });
}

/** What a duel's moment needs besides its card (screens/duelcards.ts): each side's right answers question by question (the
 * other's none while the duel waits for them), and the end's sound. */
export interface DuelPlan {
  mine: number[];
  theirs: number[];
  end: SoundName;
}

/**
 * A duel's result as a moment on its card, once (at most 1.6 s; a tap anywhere jumps to the end). The verdict waits
 * while the duel is gone through question by question, 75 ms apart, a pluck on the scale for each of the player's
 * right ones and a muted thud for each that wasn't; the two scores count up with them, so the lead changes hands as it
 * did, and the card's rows of marks fill pair by pair. Then the verdict (the chip, and the line under the marks) and
 * the scores land, with the end's sound (the motif over a low D for a win, a soft fall for a loss). Resolves once
 * it's over.
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
  const n = Math.max(plan.mine.length, plan.theirs.length);
  const rows = [...card.querySelectorAll(".duel-card-row .mini")].map((row) => [...row.children]);
  const scores = [...card.querySelectorAll<HTMLElement>(".duel-score[data-n]")];
  const finals = scores.map((p) => Number(p.dataset.n ?? 0));
  const sums = [0, 0];
  for (const p of scores) p.textContent = format(0);
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
      if (i < plan.mine.length) play(plan.mine[i] ? "pip" : "dud", i);
      sums[0] = (sums[0] ?? 0) + (plan.mine[i] ?? 0);
      sums[1] = (sums[1] ?? 0) + (plan.theirs[i] ?? 0);
      scores.forEach((p, k) => {
        p.textContent = format(sums[k] ?? 0);
      });
    });
  }
  const landAt = first + n * step + 50;
  for (const el of card.querySelectorAll(".duel-chip, .duel-card-note")) rise(el, landAt);
  for (const p of scores)
    moving.push(
      p.animate(
        [
          { transform: "scale(1.15)", opacity: 0.6 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 260, delay: landAt, easing: spring, fill: "backwards" },
      ),
    );
  const settle = () => {
    scores.forEach((p, k) => {
      p.textContent = format(finals[k] ?? 0);
    });
    end();
  };
  at(landAt, settle);
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

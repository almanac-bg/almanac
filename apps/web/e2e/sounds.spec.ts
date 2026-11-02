// The game's sounds, measured (the 31 October review, VD-7): each rendered offline through the game's own master bus
// (renderOffline in src/lib/sound.ts), then its peak, its loudness (ITU-R BS.1770's K-weighting, the loudest 400 ms)
// and its loudness on a phone — what's left past a 300 Hz high-pass (24 dB an octave), as a phone's speaker plays it.
// Peaks alone said a miss was as loud as a right answer; on a phone it was 8–14 LU quieter, "nothing much happened".
import { build } from 'esbuild';
import { expect, test } from './support';

const RATE = 48_000;
type Biquad = { b: [number, number, number]; a: [number, number, number] };

/** A biquad filter run over the samples (direct form I), coefficients normalised (a0 = 1). */
function filter(x: Float64Array, { b, a }: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  for (let i = 0; i < x.length; i++) {
    y[i] = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    [x2, x1, y2, y1] = [x1, x[i], y1, y[i]];
  }
  return y;
}

/** A second-order high-pass (the Audio EQ Cookbook's), at `f` Hz with quality `q`. */
function highpass(f: number, q: number): Biquad {
  const w = (2 * Math.PI * f) / RATE;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    b: [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0],
    a: [1, (-2 * c) / a0, (1 - alpha) / a0],
  };
}

// BS.1770's K-weighting at 48 kHz: the head's shelf, then the low cut.
const K: Biquad[] = [
  { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] },
  { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] },
];
// A phone's speaker: a fourth-order Butterworth high-pass at 300 Hz.
const PHONE: Biquad[] = [highpass(300, 0.5412), highpass(300, 1.3066)];

/** The loudest 400 ms (momentary loudness, LUFS), every 100 ms. */
function loudness(samples: Float64Array): number {
  const y = K.reduce(filter, samples);
  const window = 0.4 * RATE;
  let loudest = 0;
  for (let start = 0; start + window <= y.length; start += 0.1 * RATE) {
    let sum = 0;
    for (let i = start; i < start + window; i++) sum += y[i] * y[i];
    loudest = Math.max(loudest, sum / window);
  }
  return -0.691 + 10 * Math.log10(loudest);
}

type Measure = { peak: number; lufs: number; phone: number };

/** Every sound the game makes, by name, as sfx plays it. */
const CUES = [
  'correct',
  'wrong',
  'timeUp',
  'knockedOut',
  'eliminated',
  'win',
  'lose',
  'levelUp',
  'achievement',
  'question',
  'tick',
  'lock',
  'pop',
] as const;

test.describe.configure({ mode: 'serial' });

/** A blank page with the sounds alone, bundled: no app, no server. */
async function soundsPage(page: import('@playwright/test').Page) {
  const bundle = await build({
    entryPoints: [new URL('../src/lib/sound.ts', import.meta.url).pathname],
    bundle: true,
    format: 'iife',
    globalName: 'almanacSound',
    write: false,
    logLevel: 'silent',
  });
  await page.setContent('<!doctype html><title>sounds</title><button>Тап</button>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}
type Sound = typeof import('../src/lib/sound');

test('each sound sits at its role’s loudness, and a miss is as clear as a hit on a phone @desktop', async ({
  page,
}) => {
  await soundsPage(page);

  const measured: Record<string, Measure> = {};
  for (const cue of CUES) {
    const samples = Float64Array.from(
      await page.evaluate(async (name) => {
        const { renderOffline } = (window as unknown as { almanacSound: Sound }).almanacSound;
        return Array.from(await renderOffline((sfx) => (sfx[name as keyof typeof sfx] as () => void)()));
      }, cue),
    );
    const peak = 20 * Math.log10(samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0));
    measured[cue] = { peak, lufs: loudness(samples), phone: loudness(PHONE.reduce(filter, samples)) };
  }
  console.log(
    Object.entries(measured)
      .map(
        ([cue, m]) =>
          `${cue.padEnd(12)} peak ${m.peak.toFixed(1)}  LUFS ${m.lufs.toFixed(1)}  phone ${m.phone.toFixed(1)}`,
      )
      .join('\n'),
  );

  // Nothing clips.
  for (const [cue, m] of Object.entries(measured)) expect(m.peak, `${cue}'s peak`).toBeLessThan(-1);
  // An answer's feedback reads the same either way, on a phone too: within ±3 LU of a right answer.
  for (const cue of ['wrong', 'timeUp'] as const) {
    expect(Math.abs(measured[cue].lufs - measured.correct.lufs), `${cue} beside correct`).toBeLessThanOrEqual(3);
    expect(
      Math.abs(measured[cue].phone - measured.correct.phone),
      `${cue} beside correct, on a phone`,
    ).toBeLessThanOrEqual(3);
  }
  // Being knocked out is a big moment, on a phone as well: not quieter than a right answer there.
  expect(measured.knockedOut.phone, 'knockedOut on a phone').toBeGreaterThanOrEqual(measured.correct.phone);
  // A question coming in is soft, but there on a phone.
  expect(measured.question.phone, 'question on a phone').toBeGreaterThan(-40);
});

test('the audio engine sleeps in the background and stays asleep when the tab comes back, until a sound (WEB-4) @desktop', async ({
  page,
}) => {
  await soundsPage(page);
  await page.evaluate(() => (window as unknown as { almanacSound: Sound }).almanacSound.unlockAudioOnFirstTap());
  await page.getByRole('button', { name: 'Тап' }).click();
  const state = () => page.evaluate(() => (window as unknown as { almanacSound: Sound }).almanacSound.audioState());
  // A browser with no audio output to run (headless Firefox in CI) keeps every engine suspended: nothing to tell here.
  const ran = await expect
    .poll(state, { timeout: 3_000 })
    .toBe('running')
    .then(
      () => true,
      () => false,
    );
  test.skip(!ran, 'this browser runs no audio here');
  const show = (visible: boolean) =>
    page.evaluate((v) => {
      Object.defineProperty(document, 'visibilityState', { value: v ? 'visible' : 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, visible);
  await show(false);
  await expect.poll(state).toBe('suspended');
  await show(true);
  await page.waitForTimeout(500);
  expect(await state(), 'not woken by the tab alone').toBe('suspended');
  // The next sound wakes it.
  await page.evaluate(() => (window as unknown as { almanacSound: Sound }).almanacSound.sfx.pop());
  await expect.poll(state).toBe('running');
});

test('a room’s big screen plays the quiet cues about 8 LU louder than a phone, and none clips (VD-17) @desktop', async ({
  page,
}) => {
  await soundsPage(page);
  const measure = async (name: 'tick' | 'lock' | 'countdown', loud: boolean) => {
    const samples = Float64Array.from(
      await page.evaluate(
        async ([cue, big]) => {
          const { renderOffline, louder } = (window as unknown as { almanacSound: Sound }).almanacSound;
          const play = (sfx: Sound['sfx']) => (sfx[cue as 'tick'] as () => void)();
          return Array.from(await renderOffline((sfx) => (big ? louder(() => play(sfx)) : play(sfx))));
        },
        [name, loud] as const,
      ),
    );
    return { lufs: loudness(samples), peak: 20 * Math.log10(samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0)) };
  };
  for (const cue of ['tick', 'lock', 'countdown'] as const) {
    const [phone, room] = [await measure(cue, false), await measure(cue, true)];
    expect(room.lufs - phone.lufs, `${cue}: louder in a room`).toBeGreaterThan(6);
    expect(room.peak, `${cue}: no clipping`).toBeLessThan(-1);
  }
});

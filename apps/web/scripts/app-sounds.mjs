// The native app's sounds (apps/mobile/assets/sounds), from the web's own: src/lib/sound.ts synthesises each cue with
// WebAudio, which React Native doesn't have — so each is rendered here, offline in Chromium through the same master
// bus (renderOffline), trimmed of its silent tail and written as a 16-bit mono WAV the app plays. One synthesis for
// both: a cue changed on the web is the app's too once this is run again (`npm run app-sounds -w @almanac/web`).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

const RATE = 48_000;
const out = path.join(import.meta.dirname, '../../mobile/assets/sounds');

/** Every cue the app plays: its file's name, and how sfx makes it. */
const CUES = {
  lock: 'sfx.lock()',
  question: 'sfx.question()',
  correct: 'sfx.correct()',
  wrong: 'sfx.wrong()',
  'time-up': 'sfx.timeUp()',
  powerup: 'sfx.powerup()',
  eliminated: 'sfx.eliminated()',
  'knocked-out': 'sfx.knockedOut()',
  achievement: 'sfx.achievement()',
  invite: 'sfx.invite()',
  go: 'sfx.go()',
  countdown: 'sfx.countdown()',
  pop: 'sfx.pop()',
  tick: 'sfx.tick(5)',
  'tick-3': 'sfx.tick(3)',
  'tick-2': 'sfx.tick(2)',
  'tick-1': 'sfx.tick(1)',
  'streak-3': 'sfx.streak(3)',
  'streak-5': 'sfx.streak(5)',
  'streak-10': 'sfx.streak(10)',
  'lead-taken': 'sfx.lead(true)',
  'lead-lost': 'sfx.lead(false)',
  win: 'sfx.win()',
  lose: 'sfx.lose()',
  'level-up': 'sfx.levelUp()',
};

/** The samples up to where the sound has faded under -60 dB, and a few milliseconds more. */
function trim(samples) {
  const floor = 10 ** (-60 / 20);
  let end = samples.length;
  while (end > 0 && Math.abs(samples[end - 1]) < floor) end--;
  return samples.subarray(0, Math.min(samples.length, end + Math.round(RATE * 0.02)));
}

/** A 16-bit PCM mono WAV of the samples. */
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const bundle = await build({
  entryPoints: [path.join(import.meta.dirname, '../src/lib/sound.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'almanacSound',
  write: false,
  logLevel: 'silent',
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>sounds</title>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await mkdir(out, { recursive: true });
  for (const [name, play] of Object.entries(CUES)) {
    const samples = Float32Array.from(
      await page.evaluate(async (play) => {
        const { renderOffline } = window.almanacSound;
        return Array.from(await renderOffline((sfx) => new Function('sfx', play)(sfx)));
      }, play),
    );
    await writeFile(path.join(out, `${name}.wav`), wav(trim(samples)));
    console.log(`apps/mobile/assets/sounds/${name}.wav`);
  }
} finally {
  await browser.close();
}

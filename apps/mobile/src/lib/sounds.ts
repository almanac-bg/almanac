import type { Effect } from '@almanac/client';
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { usePrefs } from './prefs';

/**
 * The game's sounds: the web's own (src/lib/sound.ts), rendered to files by `npm run app-sounds -w @almanac/web`. Each
 * file is loaded once, when first played, and played again from its start.
 */
const FILES = {
  lock: require('../../assets/sounds/lock.wav'),
  question: require('../../assets/sounds/question.wav'),
  correct: require('../../assets/sounds/correct.wav'),
  wrong: require('../../assets/sounds/wrong.wav'),
  timeUp: require('../../assets/sounds/time-up.wav'),
  powerup: require('../../assets/sounds/powerup.wav'),
  eliminated: require('../../assets/sounds/eliminated.wav'),
  knockedOut: require('../../assets/sounds/knocked-out.wav'),
  achievement: require('../../assets/sounds/achievement.wav'),
  invite: require('../../assets/sounds/invite.wav'),
  go: require('../../assets/sounds/go.wav'),
  countdown: require('../../assets/sounds/countdown.wav'),
  pop: require('../../assets/sounds/pop.wav'),
  tick: require('../../assets/sounds/tick.wav'),
  tick3: require('../../assets/sounds/tick-3.wav'),
  tick2: require('../../assets/sounds/tick-2.wav'),
  tick1: require('../../assets/sounds/tick-1.wav'),
  streak3: require('../../assets/sounds/streak-3.wav'),
  streak5: require('../../assets/sounds/streak-5.wav'),
  streak10: require('../../assets/sounds/streak-10.wav'),
  leadTaken: require('../../assets/sounds/lead-taken.wav'),
  leadLost: require('../../assets/sounds/lead-lost.wav'),
  win: require('../../assets/sounds/win.wav'),
  lose: require('../../assets/sounds/lose.wav'),
  levelUp: require('../../assets/sounds/level-up.wav'),
} as const;

export type Cue = keyof typeof FILES;

const players = new Map<Cue, AudioPlayer>();
let modeSet = false;

/** A cue, unless the sounds are off here. Under music the game mixes in; the silent switch silences it (iOS). */
export function play(cue: Cue) {
  if (!usePrefs.getState().sound) return;
  try {
    if (!modeSet) {
      modeSet = true;
      void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    }
    let player = players.get(cue);
    if (!player) {
      player = createAudioPlayer(FILES[cue]);
      players.set(cue, player);
    }
    const ready = player;
    void ready.seekTo(0).then(
      () => ready.play(),
      () => ready.play(),
    );
  } catch {
    /* no sound this time: the game goes on */
  }
}

/** The client's moments with a sound of their own (the web's SOUNDS map, main.tsx). */
const EFFECTS: Partial<Record<Effect, Cue>> = {
  lock: 'lock',
  question: 'question',
  correct: 'correct',
  wrong: 'wrong',
  timeUp: 'timeUp',
  powerup: 'powerup',
  eliminated: 'eliminated',
  knockedOut: 'knockedOut',
  achievement: 'achievement',
  invite: 'invite',
  round: 'go',
  leadTaken: 'leadTaken',
  leadLost: 'leadLost',
};

/** The client's moment as a sound, where it has one. */
export const sound = (name: Effect) => {
  const cue = EFFECTS[name];
  if (cue) play(cue);
};

/** The last seconds' tick: higher with each of the last three (`left`: seconds to go). */
export const tick = (left: number) => play(left === 1 ? 'tick1' : left === 2 ? 'tick2' : left === 3 ? 'tick3' : 'tick');

/** A streak of right answers: a rising run, higher the longer it gets. */
export const streak = (length: number) => play(length >= 10 ? 'streak10' : length >= 5 ? 'streak5' : 'streak3');

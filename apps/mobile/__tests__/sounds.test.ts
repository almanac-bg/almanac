// The game's sounds: each moment the client marks has the web's cue, the last seconds tick higher, a streak's run grows
// — and with „Звуци“ off, nothing plays.
import { createAudioPlayer } from 'expo-audio';
import { setSound } from '@/lib/prefs';
import { play, sound, streak, tick } from '@/lib/sounds';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

/** Which files were loaded to be played, by the asset each was made from. */
const played = () => jest.mocked(createAudioPlayer).mock.calls.map(([source]) => source);

beforeEach(async () => {
  jest.mocked(createAudioPlayer).mockClear();
  await setSound(true);
});

test('a moment with a cue plays it; one without plays nothing', () => {
  sound('correct');
  sound('reaction');
  expect(played()).toEqual([require('../assets/sounds/correct.wav')]);
});

test('the last seconds and the streaks pick their own cue', () => {
  tick(5);
  tick(3);
  tick(1);
  streak(4);
  streak(12);
  expect(played()).toEqual([
    require('../assets/sounds/tick.wav'),
    require('../assets/sounds/tick-3.wav'),
    require('../assets/sounds/tick-1.wav'),
    require('../assets/sounds/streak-3.wav'),
    require('../assets/sounds/streak-10.wav'),
  ]);
});

test('a cue loaded once is played again from its start, not loaded again', () => {
  play('pop');
  play('pop');
  // Its file loaded the first time only: the second plays the same player again.
  expect(played()).toEqual([require('../assets/sounds/pop.wav')]);
});

test('with „Звуци“ off, nothing plays', async () => {
  await setSound(false);
  play('win');
  sound('wrong');
  expect(played()).toEqual([]);
});

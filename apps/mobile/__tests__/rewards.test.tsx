// The reward moment before the results: the new level, the milestone's reward (one of two, or later), a new avatar to
// wear — then the results, the new avatar not offered a second time.
import { api, type LiveGame, setState, useStore } from '@almanac/client';
import type { GameEndPayload, MatchRewards } from '@almanac/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Results } from '@/game/Results';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() } }));

const me = {
  id: 1,
  username: 'Ана',
  avatar: 'fox',
  frame: 'classic',
  title: 'spark',
  isGuest: false,
  knowledge: { due: 0 },
  choices: [
    {
      level: 5,
      options: [
        { kind: 'avatar', id: 'hedgehog' },
        { kind: 'avatar', id: 'otter' },
      ],
      earlier: [],
    },
  ],
};

const game = (rewards: Partial<MatchRewards>): LiveGame =>
  ({
    start: {
      gameId: 'g1',
      mode: 'solo',
      pace: 'normal',
      category: 'history',
      youId: 'u1',
      players: [{ id: 'u1', name: 'Ана' }],
      totalQuestions: 10,
    },
    players: {},
    history: [],
    phase: 'ended',
    end: {
      gameId: 'g1',
      mode: 'solo',
      ranked: false,
      roomCode: null,
      standings: [{ id: 'u1', score: 1500, streak: 0, correct: 8, placement: 1, eliminatedAt: null, left: false }],
      teamScores: null,
      noContest: false,
      rewards: {
        xpGained: 400,
        breakdown: [{ label: 'Верни отговори', amount: 400 }],
        xpBefore: 2000,
        xpAfter: 2400,
        levelBefore: 4,
        levelAfter: 5,
        achievements: [],
        unlocks: [],
        rating: null,
        unrated: null,
        daily: null,
        challenge: null,
        soloBest: null,
        knowledge: { added: 0 },
        mastery: [],
        ...rewards,
      },
    } as unknown as GameEndPayload,
  }) as unknown as LiveGame;

const show = (g: LiveGame) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Results game={g} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  setState({ me: me as never, room: null, friendsVersion: 0 });
});

test('the level, then one of two rewards picked, then the results', async () => {
  const choose = jest.spyOn(api, 'chooseReward').mockResolvedValue({ user: { ...me, choices: [] } as never });
  await show(game({}));
  expect(screen.getByLabelText('Ниво 5')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Нататък' }));
  expect(screen.getByText('Ниво 5: избери награда')).toBeTruthy();
  // Not picked: going on leaves it for later.
  expect(screen.getByRole('button', { name: 'Избери по-късно' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: 'Видра, аватар' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Вземи „Видра“' }));
  expect(choose).toHaveBeenCalledWith(5, { kind: 'avatar', id: 'otter' });
  await waitFor(() => expect(screen.getByText('✓ Взе „Видра“ — вече е в „Колекция“')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Към резултата' }));
  expect(screen.queryByText('Ниво 5: избери награда')).toBeNull();
  expect(screen.getByText('Готово!')).toBeTruthy();
});

test('a new avatar: worn from the moment, and not offered again in the results', async () => {
  const loadout = jest.spyOn(api, 'loadout').mockResolvedValue({ user: { ...me, avatar: 'owl' } as never });
  await show(game({ levelBefore: 5, levelAfter: 5, unlocks: [{ kind: 'avatar', id: 'owl' }] }));
  expect(screen.getByText('Ново за теб')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Сложи го' }));
  expect(loadout).toHaveBeenCalledWith({ avatar: 'owl' });
  await waitFor(() => expect(screen.getByText('✓ Носиш го')).toBeTruthy());
  expect(useStore.getState().me?.avatar).toBe('owl');
  await fireEvent.press(screen.getByRole('button', { name: 'Към резултата' }));
  expect(screen.queryByText('Ново за теб')).toBeNull();
  await act(async () => {});
});

test('an ordinary match goes straight to its results', async () => {
  await show(game({ levelBefore: 5, levelAfter: 5 }));
  expect(screen.queryByRole('button', { name: 'Нататък' })).toBeNull();
  expect(screen.getByText('Готово!')).toBeTruthy();
});

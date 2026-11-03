// The match screen, as a player plays it: a question's answers, the reveal, a number on the keypad, „Подреди“, and the
// fact after an answer in a run alone. The game's state is the shared client's (LiveGame); the moves go out through
// its actions, watched here.
import { actions, type LiveGame } from '@almanac/client';
import type { QuestionPayload, RevealPayload } from '@almanac/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QuestionScreen } from '@/game/QuestionScreen';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

const answer = jest.spyOn(actions, 'answer').mockImplementation(() => {});
const guess = jest.spyOn(actions, 'guess').mockImplementation(() => {});
const arrange = jest.spyOn(actions, 'arrange').mockImplementation(() => {});
beforeEach(() => jest.clearAllMocks());

const base: QuestionPayload = {
  id: 'q1',
  index: 0,
  total: 10,
  category: 'history',
  difficulty: 'easy',
  q: 'Коя година е Освобождението?',
  kind: 'choice',
  options: ['1876', '1877', '1878', '1879'],
  number: null,
  order: null,
  image: null,
  final: false,
  times: 1,
  author: null,
  durationMs: 15_000,
  remainingMs: 15_000,
  speedMs: 15_000,
  readMs: 2_000,
  elimination: false,
} as QuestionPayload;

/** A run alone, on this question, nothing picked yet. */
function game(question: Partial<QuestionPayload> = {}, more: Partial<LiveGame> = {}): LiveGame {
  return {
    start: {
      gameId: 'g1',
      mode: 'solo',
      pace: 'normal',
      youId: 'u1',
      players: [{ id: 'u1', name: 'Ана' }],
      roomCode: null,
      questionSet: null,
      totalQuestions: 10,
      timeMs: 15_000,
    },
    players: {},
    standings: [{ id: 'u1', score: 0, streak: 0 }],
    phase: 'question',
    countdownEndsAt: 0,
    question: { ...base, ...question },
    deadline: Date.now() + 15_000,
    closesAt: null,
    answered: [],
    myChoice: null,
    myGuess: null,
    myOrder: null,
    removed: [],
    doubled: false,
    usedPowerups: [],
    powerupThisQuestion: false,
    retryArmed: false,
    retryPrompt: false,
    reveal: null,
    paused: null,
    resyncing: false,
    rounds: [],
    pick: null,
    eliminated: [],
    reactions: [],
    feed: [],
    history: [],
    end: null,
    ...more,
  } as unknown as LiveGame;
}

const show = (g: LiveGame) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <QuestionScreen game={g} offline={false} />
    </SafeAreaProvider>,
  );

test('the four answers are there, lettered, and a tap picks one', async () => {
  await show(game());
  await fireEvent.press(screen.getByRole('button', { name: 'Б) 1877' }));
  expect(answer).toHaveBeenCalledWith(1);
});

test('a pick the server has confirmed says so; nothing more can be picked', async () => {
  await show(game({}, { myChoice: 2, answered: ['u1'] }));
  expect(screen.getByText(/Отговорът е заключен/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: /^А\) 1876/ }));
  expect(answer).not.toHaveBeenCalled();
});

test('the reveal says which was right and that your pick was wrong — in words, not only colours', async () => {
  const reveal = {
    index: 0,
    correct: 2,
    results: { u1: { choice: 1, correct: false, points: 0, timeMs: 3000, streak: 0, doubled: false, retried: false } },
    standings: [],
    eliminated: [],
    nextInMs: 3000,
    fact: null,
    crowd: { known: 0.62, picks: null, answers: 120 },
  } as unknown as RevealPayload;
  await show(game({}, { myChoice: 1, answered: ['u1'], reveal }));
  expect(screen.getByRole('button', { name: /^В\) 1878 — верен отговор$/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Б\) 1877 — твоят избор, грешен$/ })).toBeTruthy();
  expect(screen.getByText('Грешно 😬')).toBeTruthy();
  expect(screen.getByText(/62% знаят/)).toBeTruthy();
});

test('a number is typed on the keypad, kept in its range, and locked in', async () => {
  await show(
    game({
      kind: 'number',
      options: [],
      number: { min: 1000, max: 2025, step: 1, unit: '', scale: 'linear' },
    } as Partial<QuestionPayload>),
  );
  const lock = screen.getByRole('button', { name: 'Заключи' });
  for (const key of ['1', '8', '7', '8']) await fireEvent.press(screen.getByRole('button', { name: key }));
  await fireEvent.press(lock);
  expect(guess).toHaveBeenCalledWith(1878);
});

test('„Подреди“: tapped in order, then locked in once all four are placed', async () => {
  const items = ['Първа', 'Втора', 'Трета', 'Четвърта'];
  await show(game({ kind: 'order', options: [], order: { items, direction: 'asc' } } as Partial<QuestionPayload>));
  expect(screen.getByRole('button', { name: 'Подредени 0 от 4' })).toBeTruthy();
  for (const i of [2, 0, 3, 1])
    await fireEvent.press(
      screen.getByRole('button', { name: new RegExp(`^${['А', 'Б', 'В', 'Г'][i]}\\) ${items[i]}`) }),
    );
  await fireEvent.press(screen.getByRole('button', { name: 'Заключи' }));
  expect(arrange).toHaveBeenCalledWith([2, 0, 3, 1]);
});

test('a fact after an answer in a run alone, with the way to stop and read it', async () => {
  const reveal = {
    index: 0,
    correct: 2,
    results: {
      u1: { choice: 2, correct: true, points: 1200, timeMs: 2500, streak: 3, doubled: false, retried: false },
    },
    standings: [],
    eliminated: [],
    nextInMs: 3000,
    fact: 'Освобождението е на 3 март 1878 г.',
    crowd: null,
  } as unknown as RevealPayload;
  await show(game({}, { myChoice: 2, answered: ['u1'], reveal }));
  expect(screen.getByText('+1200')).toBeTruthy();
  expect(screen.getByText(/Освобождението е на 3 март/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Спри, за да прочета' })).toBeTruthy();
});

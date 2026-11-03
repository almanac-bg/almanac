// The results' last part: the questions reviewed (how everyone answered, a picture's credit) with a mistake flagged,
// a host's own set reported — and a rematch offer, asked for and answered.
import { actions, api, type LiveGame, type ReviewItem, setState } from '@almanac/client';
import type { GameEndPayload, GamePlayer } from '@almanac/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QuestionReview } from '@/results/QuestionReview';
import { RematchStrip, useRematch } from '@/results/Rematch';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

const item = (more: Partial<ReviewItem>): ReviewItem =>
  ({
    id: 'q1',
    index: 0,
    q: 'Коя е столицата на Австралия?',
    options: ['Сидни', 'Канбера', 'Мелбърн', 'Пърт'],
    category: 'geography',
    difficulty: 'medium',
    correct: 1,
    choice: 0,
    number: null,
    order: null,
    image: null,
    right: false,
    fact: 'Канбера е строена нарочно за столица.',
    crowd: { known: 0.4, answers: 812, picks: [0.5, 0.4, 0.08, 0.02] },
    ...more,
  }) as ReviewItem;

const show = (children: React.ReactNode) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      {children}
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  setState({ me: { id: 1, username: 'Ана', isGuest: false } as never, rematch: null, game: null });
});

test('the review: how everyone answered, and a mistake flagged with a reason', async () => {
  const report = jest.spyOn(api, 'reportQuestion').mockResolvedValue({ ok: true } as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show(<QuestionReview items={[item({})]} />);
  // Folded until opened.
  expect(screen.queryByText(/Канбера е строена/)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Преглед на въпросите, 0 от 1 верни' }));
  expect(screen.getByLabelText('А) Сидни, твоят: 50%')).toBeTruthy();
  expect(screen.getByLabelText('Б) Канбера, верният: 40%')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Сигнализирай за грешка във въпрос 1' }));
  // In its row, and again in the sheet: what the report is about.
  expect(screen.getAllByText('Коя е столицата на Австралия?')).toHaveLength(2);
  await fireEvent.press(screen.getByRole('radio', { name: 'Отговорът, отбелязан като верен, е грешен' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Изпрати доклад' }));
  expect(report).toHaveBeenCalledWith('q1', 'wrong', '');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Сигнализирано — благодарим!' })).toBeTruthy());
});

test('a picture’s credit with the answer; a host’s own question isn’t the bank’s to flag, the set is', async () => {
  const reportSet = jest.spyOn(api, 'reportPlayedSet').mockResolvedValue({ ok: true } as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const pictured = item({
    id: 'set-7',
    crowd: null,
    image: {
      src: '/qimg/a-512.webp',
      srcSet: '/qimg/a-512.webp 512w',
      w: 512,
      h: 340,
      alt: 'Град на брега',
      credit: { credit: 'Иван Петров', license: 'CC BY-SA 3.0', licenseUrl: null, sourceUrl: null },
    },
  });
  await show(<QuestionReview items={[pictured]} set={{ gameId: 'g9', name: 'Клас 7б' }} />);
  await fireEvent.press(screen.getByRole('button', { name: /^Преглед на въпросите/ }));
  expect(screen.getByText(/CC BY-SA 3\.0 · Иван Петров/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Сигнализирай за грешка във въпрос/ })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '🚩 Сигнал за набора' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Незаконно съдържание' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Изпрати доклад' }));
  expect(reportSet).toHaveBeenCalledWith('g9', 'illegal', '');
});

const player = (id: string, name: string) =>
  ({
    id,
    userId: Number(id.slice(1)),
    name,
    avatar: 'fox',
    frame: 'classic',
    isBot: false,
    isGuest: false,
    team: null,
  }) as GamePlayer;

const ranked = (): LiveGame =>
  ({
    start: { youId: 'u1', players: [player('u1', 'Ана'), player('u9', 'Мария')] },
    players: { u1: player('u1', 'Ана'), u9: player('u9', 'Мария') },
    end: {
      gameId: 'g1',
      mode: 'duel',
      ranked: true,
      standings: [
        { id: 'u1', placement: 1, left: false },
        { id: 'u9', placement: 2, left: false },
      ],
    } as unknown as GameEndPayload,
  }) as unknown as LiveGame;

function Offer({ game }: { game: LiveGame }) {
  const rematch = useRematch(game);
  return rematch ? <RematchStrip rematch={rematch} /> : null;
}

test('a rematch: offered, asked for, accepted when the other asks — declined on leaving', async () => {
  const request = jest.spyOn(actions, 'requestRematch').mockImplementation(() => ({}) as never);
  const decline = jest.spyOn(actions, 'declineRematch').mockImplementation(() => {});
  const view = await show(<Offer game={ranked()} />);
  expect(screen.getByText('Реванш срещу Мария?')).toBeTruthy();
  await act(async () => setState({ rematch: { gameId: 'g1', ready: ['u9'] } as never }));
  expect(screen.getByText('Мария иска реванш!')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Приеми' }));
  expect(request).toHaveBeenCalledWith('g1');
  await view.unmount();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(decline).toHaveBeenCalledWith('g1');
});

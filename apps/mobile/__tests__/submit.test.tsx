// Предложи въпрос: locked below its level; a question checked before it's sent, then sent clean; one waiting changed
// or taken back.
import { api, setState } from '@almanac/client';
import type { Submission } from '@almanac/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Submit from '@/app/submit';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));

const waiting: Submission = {
  id: 7,
  category: 'geography',
  difficulty: 'easy',
  q: 'Кой е най-високият връх на Балканите?',
  options: ['Мусала', 'Вихрен', 'Олимп', 'Ботев'],
  answer: 0,
  answerSource: 'https://bg.wikipedia.org/wiki/Мусала',
  status: 'pending',
  createdAt: Date.now() - 3_600_000,
} as unknown as Submission;

const show = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Submit />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  setState({ me: { id: 1, username: 'Ана', isGuest: false, xp: 5000 } as never });
});

test('below its level: locked, with how far to go', async () => {
  setState({ me: { id: 1, username: 'Ана', isGuest: false, xp: 0 } as never });
  await show();
  expect(screen.getByText(/^Отключва се на ниво/)).toBeTruthy();
});

test('a question checked before it goes, then sent as the server takes it', async () => {
  jest.spyOn(api, 'mySubmissions').mockResolvedValue({ submissions: [] });
  const send = jest.spyOn(api, 'submitQuestion').mockResolvedValue({ submission: waiting });
  await show();
  await fireEvent.press(screen.getByRole('button', { name: 'Изпрати за одобрение' }));
  expect(send).not.toHaveBeenCalled();
  // Under each part: the question too short, the options empty (said before the missing mark).
  expect(screen.getByText(/^Въпросът трябва да е поне/)).toBeTruthy();
  expect(screen.getByText('Попълни всички отговори.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Въпрос'), '  Кой е най-високият връх на Балканите?  ');
  for (const [i, text] of ['Мусала', 'Вихрен', 'Олимп', 'Ботев'].entries())
    await fireEvent.changeText(screen.getByLabelText(`Отговор ${'АБВГ'[i]}`), text);
  await fireEvent.press(screen.getByRole('radio', { name: 'А е верният' }));
  await fireEvent.changeText(screen.getByLabelText('Източник на верния отговор'), 'не е линк');
  await fireEvent.press(screen.getByRole('button', { name: 'Изпрати за одобрение' }));
  expect(screen.getByText('Източникът трябва да е линк (https://…).')).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText('Източник на верния отговор'),
    'https://bg.wikipedia.org/wiki/Мусала',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Изпрати за одобрение' }));
  expect(send).toHaveBeenCalledWith({
    category: 'general',
    difficulty: 'easy',
    q: 'Кой е най-високият връх на Балканите?',
    options: ['Мусала', 'Вихрен', 'Олимп', 'Ботев'],
    answer: 0,
    answerSource: 'https://bg.wikipedia.org/wiki/Мусала',
  });
  await act(async () => {});
});

test('one waiting: changed, or taken back after a dialog', async () => {
  jest.spyOn(api, 'mySubmissions').mockResolvedValue({ submissions: [waiting] });
  const withdraw = jest.spyOn(api, 'withdrawSubmission').mockResolvedValue({ ok: true });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show();
  await waitFor(() => expect(screen.getByText('Чака одобрение')).toBeTruthy());
  expect(screen.getByText(/^0 одобрени · чакат 1 от \d+$/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: `Промени „${waiting.q}“` }));
  expect(screen.getByText('Промени предложението')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Оттегли въпроса' }));
  await act(async () =>
    alert.mock.calls
      .at(-1)?.[2]
      ?.find((b) => b.text === 'Да, оттегли го')
      ?.onPress?.(),
  );
  expect(withdraw).toHaveBeenCalledWith(7);
  await waitFor(() => expect(screen.queryByText('Чака одобрение')).toBeNull());
});

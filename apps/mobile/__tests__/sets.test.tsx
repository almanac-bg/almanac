// Моите въпроси: a set made and played in a room; the editor (a question of each kind, a number checked before it's
// saved, the save as the server takes it); another host's set by its link — a copy taken, or your own opened.
import { actions, api, setState } from '@almanac/client';
import type { QuestionSetInfo } from '@almanac/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import SetEditor from '@/app/sets/[id]';
import Sets from '@/app/sets/index';
import SharedSet from '@/app/sets/shared/[code]';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '3', code: 'abc' }),
  useNavigation: () => ({ dispatch: jest.fn() }),
  usePreventRemove: jest.fn(),
  useFocusEffect: jest.fn(),
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })) }));
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { WEBP: 'webp' },
}));

const set = (more: Partial<QuestionSetInfo> = {}): QuestionSetInfo => ({
  id: 3,
  name: 'Клас 7б',
  code: 'abc',
  questions: [{ kind: 'choice', q: 'Коя е столицата?', options: ['София', 'Пловдив', 'Варна', 'Бургас'], answer: 0 }],
  hidden: false,
  updatedAt: Date.now(),
  ...more,
});

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
  setState({ me: { id: 1, username: 'Ана', isGuest: false } as never });
});

test('the list: a set made opens its editor; one with questions goes into a room', async () => {
  jest.spyOn(api, 'sets').mockResolvedValue({
    sets: [{ id: 3, name: 'Клас 7б', questions: 12, hidden: false, updatedAt: Date.now() }],
  });
  const create = jest.spyOn(api, 'createSet').mockResolvedValue({ id: 4 });
  const room = jest.spyOn(actions, 'createRoom').mockResolvedValue({ ok: true } as never);
  await show(<Sets />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Пусни „Клас 7б“ в стая' })).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Пусни „Клас 7б“ в стая' }));
  expect(room).toHaveBeenCalledWith({ set: 3 });
  await waitFor(() => expect(router.push).toHaveBeenCalledWith('/room'));
  await fireEvent.press(screen.getByRole('button', { name: '+ Нов набор' }));
  expect(create).toHaveBeenCalledWith({ name: 'Нов набор', questions: [] });
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/sets/[id]', params: { id: '4' } }));
});

test('the editor: a number question checked, then saved as the server takes it', async () => {
  jest.spyOn(api, 'set').mockResolvedValue(set());
  const save = jest.spyOn(api, 'saveSet').mockImplementation(async (_id, body) => set({ ...body }));
  await show(<SetEditor />);
  await waitFor(() => expect(screen.getByDisplayValue('Коя е столицата?')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Запази' }).props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: '+ Въпрос 2' }));
  await fireEvent.press(screen.getAllByRole('radio', { name: 'Число' }).at(-1)!);
  await fireEvent.changeText(screen.getAllByLabelText('Текст на въпрос 2').at(-1)!, 'Колко е висок Мусала?');
  await fireEvent.press(screen.getByRole('button', { name: 'Запази' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText('Въпрос 2: напиши верния отговор като число.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Верният отговор'), '2925');
  // A year-like number gets ten either way; anything else a tenth — here, 293.
  expect(screen.getByDisplayValue('293')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Мерна единица'), 'м');
  await fireEvent.press(screen.getByRole('button', { name: 'Запази' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(3, {
      name: 'Клас 7б',
      questions: [
        { kind: 'choice', q: 'Коя е столицата?', options: ['София', 'Пловдив', 'Варна', 'Бургас'], answer: 0 },
        { kind: 'number', q: 'Колко е висок Мусала?', number: { answer: 2925, unit: 'м', tolerance: 293 } },
      ],
    }),
  );
  await act(async () => {});
});

test('the editor: a question moved up, the right option changed', async () => {
  jest.spyOn(api, 'set').mockResolvedValue(
    set({
      questions: [
        { kind: 'choice', q: 'Първи?', options: ['А1', 'Б1', 'В1', 'Г1'], answer: 0 },
        { kind: 'truefalse', q: 'Втори.', answer: true },
      ],
    }),
  );
  const save = jest.spyOn(api, 'saveSet').mockImplementation(async (_id, body) => set({ ...body }));
  await show(<SetEditor />);
  await waitFor(() => expect(screen.getByDisplayValue('Първи?')).toBeTruthy());
  await fireEvent.press(screen.getByRole('radio', { name: 'Б е верният' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Въпрос 2 по-нагоре' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Запази' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0]?.[1].questions.map((q) => q.q)).toEqual(['Втори.', 'Първи?']);
  expect(save.mock.calls[0]?.[1].questions[1]).toMatchObject({ answer: 1 });
});

test('another host’s set: a copy taken and opened; your own opened instead', async () => {
  const preview = jest.spyOn(api, 'sharedSet').mockResolvedValue({
    name: 'История за 7 клас',
    author: 'Мария',
    questions: 20,
    kinds: { choice: 12, truefalse: 3, number: 2, order: 3 },
    mine: null,
    hidden: false,
  });
  const copy = jest.spyOn(api, 'copySet').mockResolvedValue({ id: 8 });
  await show(<SharedSet />);
  await waitFor(() => expect(screen.getByText('12 с избор, 3 вярно/невярно, 2 с число, 3 за подреждане')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Вземи копие за моите стаи' }));
  expect(copy).toHaveBeenCalledWith('abc');
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/sets/[id]', params: { id: '8' } }));
  preview.mockResolvedValue({
    name: 'История за 7 клас',
    author: 'Ана',
    questions: 20,
    kinds: { choice: 20, truefalse: 0, number: 0, order: 0 },
    mine: 3,
    hidden: false,
  });
  jest.clearAllMocks();
  await show(<SharedSet />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Отвори своя набор' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: '🚩 Сигнализирай' })).toBeNull();
});

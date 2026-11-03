// Знания: the overview with „Поправителен“ and the categories, and a category's facts with their search.
import { actions, api, setState } from '@almanac/client';
import type { KnowledgeFact, KnowledgeOverview } from '@almanac/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import CategoryFacts from '@/app/(tabs)/knowledge/[category]';
import Knowledge from '@/app/(tabs)/knowledge/index';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ category: 'history' }),
}));

const fact = (id: string, q: string, more: Partial<KnowledgeFact> = {}): KnowledgeFact => ({
  id,
  category: 'history',
  q,
  answer: 'Отговор',
  number: null,
  order: null,
  image: null,
  fact: `Фактът зад ${id}.`,
  learnedAt: Date.now(),
  ...more,
});

const overview: KnowledgeOverview = {
  facts: 12,
  total: 300,
  categories: [
    { category: 'history', facts: 10, total: 25, tier: 1 },
    { category: 'science', facts: 2, total: 25, tier: null },
  ],
  review: { due: 6, waiting: 0, nextDueAt: null, ready: true },
  recent: [
    fact('h1', 'Коя година е Съединението?', {
      answer: null,
      number: { answer: 1885, unit: '', step: 1, scale: 'linear' } as never,
    }),
  ],
};

const show = (children: ReactNode) =>
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
  setState({ me: { id: 7, username: 'Ана', isGuest: false, knowledge: { facts: 12, due: 6 } } as never });
});

test('the overview: how far along, „Поправителен“ to play, a category opened', async () => {
  jest.spyOn(api, 'knowledge').mockResolvedValue(overview);
  const start = jest.spyOn(actions, 'startReview').mockResolvedValue({ ok: true });
  await show(<Knowledge />);
  await waitFor(() => expect(screen.getByText('12 от 300 факта')).toBeTruthy());
  expect(screen.getByText(/6 сгрешени въпроса са готови/)).toBeTruthy();
  expect(screen.getByText(/1885/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Играй' }));
  expect(start).toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'История: 10 от 25 факта, Експерт' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/knowledge/[category]', params: { category: 'history' } });
});

test('nothing to play yet: when the missed ones come back, and no button', async () => {
  jest.spyOn(api, 'knowledge').mockResolvedValue({
    ...overview,
    review: { due: 0, waiting: 0, nextDueAt: null, ready: false },
  });
  await show(<Knowledge />);
  await waitFor(() => expect(screen.getByText(/Сгрешеното се връща тук след/)).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Играй' })).toBeNull();
});

test('a category: its facts, searched by any word, the answer too', async () => {
  const facts = Array.from({ length: 9 }, (_, i) => fact(`f${i}`, `Въпрос ${i}?`));
  facts.push(
    fact('year', 'Кога е Освобождението?', {
      answer: null,
      number: { answer: 1878, unit: '', step: 1, scale: 'linear' } as never,
    }),
  );
  jest.spyOn(api, 'knowledgeCategory').mockResolvedValue({ category: 'history', facts, total: 25, tier: null });
  await show(<CategoryFacts />);
  await waitFor(() => expect(screen.getByText('10 от 25 факта')).toBeTruthy());
  expect(screen.getByText('Въпрос 0?', { exact: false })).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Търси във фактите от „История“'), '1878');
  await waitFor(() => expect(screen.queryByText('Въпрос 0?', { exact: false })).toBeNull());
  expect(screen.getByText(/Кога е Освобождението\?/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Търси във фактите от „История“'), 'няма такова');
  await waitFor(() => expect(screen.getByText('Нищо не съвпада с „няма такова“.')).toBeTruthy());
});

test('a category with nothing yet says how to fill it', async () => {
  jest.spyOn(api, 'knowledgeCategory').mockResolvedValue({ category: 'history', facts: [], total: 25, tier: null });
  await show(<CategoryFacts />);
  await waitFor(() => expect(screen.getByText('Още нищо тук')).toBeTruthy());
  expect(screen.queryByLabelText('Търси във фактите от „История“')).toBeNull();
});

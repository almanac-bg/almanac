export const CATEGORIES = [
  { id: 'general', name: 'Обща култура', icon: '💡', color: '#facc15' },
  { id: 'science', name: 'Наука', icon: '🧪', color: '#22d3ee' },
  { id: 'history', name: 'История', icon: '🏛️', color: '#f59e0b' },
  { id: 'geography', name: 'География', icon: '🌍', color: '#34d399' },
  { id: 'movies', name: 'Кино и телевизия', icon: '🎬', color: '#f472b6' },
  { id: 'music', name: 'Музика', icon: '🎧', color: '#a78bfa' },
  { id: 'sports', name: 'Спорт', icon: '⚽', color: '#fb923c' },
  { id: 'technology', name: 'Технологии и игри', icon: '🎮', color: '#60a5fa' },
  { id: 'literature', name: 'Изкуство и литература', icon: '📚', color: '#f87171' },
  { id: 'nature', name: 'Природа и животни', icon: '🦊', color: '#4ade80' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];
export type CategoryChoice = CategoryId | 'mixed';

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as CategoryId[];

export const MIXED_CATEGORY = { id: 'mixed', name: 'Микс', icon: '🎲', color: '#e879f9' } as const;

export function categoryById(id: string) {
  return id === 'mixed' ? MIXED_CATEGORY : CATEGORIES.find((c) => c.id === id);
}

export function isCategoryChoice(value: unknown): value is CategoryChoice {
  return value === 'mixed' || CATEGORY_IDS.includes(value as CategoryId);
}

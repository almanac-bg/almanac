// „Моите знания“ on the web and in the app: a fact's answer as it's shown, and the search over the facts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KnowledgeFact } from '@almanac/shared';
import { factAnswer, factMatches, keepTogether, searchWords } from '../src/index.ts';

const fact = (more: Partial<KnowledgeFact>): KnowledgeFact => ({
  id: 'q1',
  category: 'history',
  q: 'Кога е Съединението?',
  answer: null,
  number: null,
  order: null,
  image: null,
  fact: 'На 6 септември 1885 г. Пловдив посреща Съединението.',
  learnedAt: 0,
  ...more,
});

test('the answer of each kind: the option, the number with its unit, the order in turn', () => {
  assert.equal(factAnswer(fact({ answer: 'В 1885 г.' })), 'В 1885\u00a0г.');
  assert.equal(
    factAnswer(fact({ number: { answer: 12_500, unit: 'км', step: 1, scale: 'linear' } as never })),
    '12\u00a0500\u00a0км',
  );
  const order = {
    items: [
      { text: 'Плиска', value: 681 },
      { text: 'Преслав', value: 893 },
    ],
    direction: 'asc',
    unit: '',
  };
  assert.equal(factAnswer(fact({ order: order as never })), 'Плиска → Преслав');
});

test('a search finds every word, in any case, wherever it is, the answer too', () => {
  const f = fact({ number: { answer: 1885, unit: '', step: 1, scale: 'linear' } as never });
  assert.ok(factMatches(f, searchWords('1885')));
  assert.ok(factMatches(f, searchWords('  ПЛОВДИВ  съединението ')));
  // The fact keeps „6 септември“ together with a no-break space; typed, it's an ordinary one.
  assert.ok(factMatches(fact({ fact: keepTogether('На 6 септември') }), searchWords('6 септември')));
  assert.ok(!factMatches(f, searchWords('пловдив софия')));
  assert.deepEqual(searchWords('   '), []);
});

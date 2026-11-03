// A host's own set as the web's and the app's editors hold it: numbers as typed, switched kinds, the body the server
// takes — and what's wrong with a number before it's sent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blankDraft, defaultTolerance, parseNumber, setKinds, switchKind, toDraft, toSetBody } from '../src/index.ts';

test('a number as typed: a comma, spaces between thousands; not one, null', () => {
  assert.equal(parseNumber('2,5'), 2.5);
  assert.equal(parseNumber(' 12 500 '), 12_500);
  assert.equal(parseNumber('-3'), -3);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('около 5'), null);
});

test('the tolerance a number gets: ten for a year, a tenth of the rest, at least one', () => {
  assert.equal(defaultTolerance('1878'), '10');
  assert.equal(defaultTolerance('2925'), '293');
  assert.equal(defaultTolerance('3'), '1');
  assert.equal(defaultTolerance('нещо'), '');
});

test('a kind switched keeps the text, and the picture between the kinds that have one', () => {
  const image = { id: 'p', w: 10, h: 10, alt: 'кула' };
  const choice = { ...blankDraft(), q: 'Коя кула?', image };
  const tf = switchKind(choice, 'truefalse');
  assert.equal(tf.q, 'Коя кула?');
  assert.ok(tf.kind === 'truefalse' && tf.image === image);
  assert.equal(switchKind(tf, 'truefalse'), tf);
  assert.ok(!('image' in switchKind(tf, 'number')));
});

test('the body the server takes, or the number that is wrong', () => {
  const number = toDraft({ kind: 'number', q: 'Колко?', number: { answer: 2.5, unit: 'м', tolerance: 1 } });
  assert.ok(number.kind === 'number' && number.answer === '2,5');
  const order = { ...switchKind(blankDraft(), 'order'), q: 'Подреди:' };
  if (order.kind !== 'order') throw new Error('order');
  order.items = order.items.map((_item, i) => ({ text: `т${i}`, value: i === 0 ? 'x' : '' }));
  assert.deepEqual(toSetBody('Мой', [number, order]), { error: 'Въпрос 2: числата за подреждане трябва да са числа.' });
  const body = toSetBody('Мой', [number]);
  assert.deepEqual(body, {
    body: {
      name: 'Мой',
      questions: [{ kind: 'number', q: 'Колко?', number: { answer: 2.5, unit: 'м', tolerance: 1 } }],
    },
  });
  assert.deepEqual(toSetBody('Мой', [{ ...number, tolerance: '0' }]), {
    error: 'Въпрос 1: отклонението е число над нула.',
  });
});

test('a shared set’s kinds in words, the ones it has', () => {
  assert.equal(setKinds({ choice: 12, truefalse: 0, number: 2, order: 1 }), '12 с избор, 2 с число, 1 за подреждане');
  assert.equal(setKinds({ choice: 0, truefalse: 0, number: 0, order: 0 }), '');
});

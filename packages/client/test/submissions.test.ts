// A question proposed for the bank, checked as the server checks it before it's sent — its source's link first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanDraft, emptyQuestionDraft, hasErrors, isHttpsLink, validateDraft } from '../src/index.ts';

test('a source’s link: https, a host with a dot, no spaces', () => {
  for (const ok of [
    'https://bg.wikipedia.org/wiki/Рила',
    'https://example.com',
    'https://example.com:8443/a?b=c#d',
    'HTTPS://Example.COM/path',
  ])
    assert.equal(isHttpsLink(ok), true, ok);
  for (const no of [
    'http://example.com',
    'https://localhost/a',
    'https://example..com',
    'https://.example.com',
    'https://example.com./',
    'https://exa mple.com',
    'https:///example.com',
    'example.com',
    '',
  ])
    assert.equal(isHttpsLink(no), false, no);
});

test('a long host of dots is turned down at once, not after a long backtrack', () => {
  const started = performance.now();
  assert.equal(isHttpsLink(`https://!.${'!.'.repeat(50_000)}`), false);
  assert.equal(isHttpsLink(`https://a${'.a'.repeat(50_000)} `), false);
  assert.ok(performance.now() - started < 200, 'linear in the link’s length');
});

test('a draft: each part checked as the server checks it, then sent clean', () => {
  const draft = {
    ...emptyQuestionDraft(),
    q: '  Кой е най-високият връх на Балканите?  ',
    options: ['Мусала', 'Олимп', 'Вихрен', 'Ботев'],
    answer: 0,
    answerSource: 'https://bg.wikipedia.org/wiki/Мусала',
  };
  assert.equal(hasErrors(validateDraft(draft)), false);
  assert.equal(validateDraft({ ...draft, answerSource: 'bg.wikipedia.org' }).answerSource !== undefined, true);
  assert.equal(
    validateDraft({ ...draft, fact: 'Мусала е висок 2925 метра над морето.' }).factSource !== undefined,
    true,
  );
  assert.equal(cleanDraft(draft).q, 'Кой е най-високият връх на Балканите?');
});

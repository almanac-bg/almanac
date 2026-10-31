import fs from 'node:fs';
// The public pages' own quizzes (apps/web → GuidePages: the holiday pages), bundled in with the server's code.
import ALPHABET from '../../web/src/content/alphabet-day.json';
import BOTEV from '../../web/src/content/botev.json';
import CHRISTMAS from '../../web/src/content/christmas.json';
import ENLIGHTENERS from '../../web/src/content/enlighteners-day.json';
import INDEPENDENCE from '../../web/src/content/independence-day.json';
import LEVSKI from '../../web/src/content/levski.json';
import LIBERATION from '../../web/src/content/liberation-day.json';
import UNIFICATION from '../../web/src/content/unification-day.json';

/** A text as the comparison sees it: lowercase, its punctuation and spacing gone. */
const plain = (text: string) =>
  text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

type Comparable = { q: string; kind?: string; image?: { file: string }; items?: { text: string }[] };

/**
 * What makes a question the same one: its text — but a picture's is often the same for many („Чие е това знаме?“), so
 * there its picture, and an order question's („Подреди от най-старото“) goes with its items.
 */
export const questionKey = (q: Comparable) =>
  q.image
    ? `picture:${q.image.file}`
    : q.items
      ? `order:${plain(q.q)}|${q.items.map((i) => plain(i.text)).join('|')}`
      : plain(q.q);

/**
 * What anyone can read with its answer, on the site or in the public repository: the sample bank (the /quiz pages, the
 * landing's sample question, /facts) and the holiday quizzes. A match never deals any of it, or a page would be its
 * crib sheet (the 31 October review, SEC-1/COPY-1/BANK-2/LEGAL-1): the real bank's copies of them are held back.
 */
export function publicQuestions(sampleFile: string): { ids: Set<string>; keys: Set<string> } {
  const sample: (Comparable & { id: string })[] = fs.existsSync(sampleFile)
    ? (JSON.parse(fs.readFileSync(sampleFile, 'utf8')) as (Comparable & { id: string })[])
    : [];
  const pages = [
    ALPHABET,
    BOTEV,
    CHRISTMAS,
    ENLIGHTENERS,
    INDEPENDENCE,
    LEVSKI,
    LIBERATION,
    UNIFICATION,
  ].flat() as (Comparable & { id: string })[];
  const all = [...sample, ...pages];
  return { ids: new Set(all.map((q) => q.id)), keys: new Set(all.map(questionKey)) };
}

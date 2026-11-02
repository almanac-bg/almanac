// The two faces (decision D2, the 31 October review's UX-6): Unbounded for titles, Onest for data — names, numbers with
// their units. Unbounded's Bulgarian „т“ reads as a Latin „m“ („250 m.“) and its names as another alphabet, so nothing
// set in it may hold a username or a value with „т.“ or „дни“. A static look at the web app's JSX: an element whose
// classes set the display face (font-display, t-page, t-section), and what it holds up to its closing tag.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const src = path.resolve(import.meta.dirname, '../../web/src');
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    return e.isDirectory() ? files(file) : file.endsWith('.tsx') ? [file] : [];
  });

const DISPLAY = /\b(font-display|t-page|t-section)\b/;
// A score's „т.“, a count of days, a player's name.
const DATA = /(?:\s|\})т\.|(?<!\p{L})дни(?!\p{L})|\busername\b/u;

test('nothing in the display face holds a username or a value with its unit', () => {
  const found: string[] = [];
  for (const file of files(src)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const open of text.matchAll(/<([a-zA-Z][\w.]*)\b[^>]*>/g)) {
      if (!DISPLAY.test(open[0]) || open[0].endsWith('/>')) continue;
      const end = text.indexOf(`</${open[1]}>`, open.index + open[0].length);
      if (end === -1) continue;
      // What it shows, without comments; an element inside that switches to the text face is fine.
      const inner = text.slice(open.index + open[0].length, end).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      if (DATA.test(inner) && !inner.includes('font-sans'))
        found.push(`${path.relative(src, file)}:${text.slice(0, open.index).split('\n').length}`);
    }
  }
  assert.deepEqual(found, [], 'set these in the text face (font-sans, the default)');
});

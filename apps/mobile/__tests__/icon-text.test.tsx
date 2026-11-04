// An icon and the words after it are two texts, never one: on Android one text of both lost its words once the app had
// drawn it before (⚽ stayed, „Спорт“ went, from a match's second question on — the first run on a phone).
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react-native';
import { IconText } from '@/ui';

test('the words are the text a screen reader gets; the icon beside them is hidden from it', async () => {
  await render(
    <IconText icon="⚽" variant="h1" role="heading">
      Спорт
    </IconText>,
  );
  expect(screen.getByRole('heading', { name: 'Спорт' })).toBeTruthy();
  // Out of a screen reader's reach (queries see what it sees), yet drawn.
  expect(screen.queryByText('⚽')).toBeNull();
  expect(screen.getByText('⚽', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByText('⚽ Спорт')).toBeNull();
});

test('without an icon, just the words', async () => {
  await render(<IconText icon={null}>Смесени</IconText>);
  expect(screen.getByText('Смесени')).toBeTruthy();
});

/** Every .ts(x) file under the app's src/. */
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test('no icon joined to words in one text anywhere in the app (IconText, or an `icon` on Button, Choices, Chip)', () => {
  const src = path.resolve(__dirname, '../src');
  const joined = sources(src).flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ line, at: `${path.relative(src, file)}:${i + 1}` }))
      // `${x.icon} words…` in a string, or {x.icon} words… in JSX (not an attribute: icon={x.icon}).
      .filter(({ line }) => /\$\{[\w.?]+\.icon(?: \?\? '')?\} \S|(?<!=)\{[\w.?]+\.icon\}\s+[^\s<}/]/.test(line))
      .map(({ at, line }) => `${at}: ${line.trim()}`),
  );
  // The mastery tiers' line names all three at once, and their icons (🥉🥈🥇) are outside the old symbol range.
  expect(joined.filter((l) => !l.includes('MASTERY_TIERS.map'))).toEqual([]);
});

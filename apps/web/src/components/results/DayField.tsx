import { fmt, percent } from '@quiz/client';
import type { DailyField } from '@quiz/shared';
import clsx from 'clsx';
import { useState } from 'react';

/** The tallest column: the histogram is a glance, not a figure to study. */
const HEIGHT = 56;

const people = (n: number) => `${fmt(n)} ${n === 1 ? 'човек' : 'души'}`;
const rightAnswers = (n: number) => `${n} ${n === 1 ? 'верен' : 'верни'}`;

/**
 * How the day went for everyone (once enough have played): „По-добър от 73% днес“, and how many got each number of
 * answers right, the player's own column marked. Hovering or focusing a column reads it out; a table says it all to a
 * screen reader.
 */
export function DayField({ field, correct, className }: { field: DailyField; correct: number; className?: string }) {
  const [pointed, setPointed] = useState<number | null>(null);
  const max = Math.max(1, ...field.histogram);
  const total = field.histogram.reduce((a, b) => a + b, 0);
  const shown = pointed ?? correct;

  return (
    <div className={className}>
      <p className="font-semibold text-fg">
        {field.beaten >= 0.995 ? 'Най-добрият резултат днес!' : `По-добър от ${percent(field.beaten)} днес`}
      </p>
      <div
        aria-hidden
        className="mt-3 flex items-end gap-0.5"
        style={{ height: HEIGHT + 16 }}
        onPointerLeave={() => setPointed(null)}
      >
        {field.histogram.map((n, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: one column per number of right answers, fixed
            key={i}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
            onPointerEnter={() => setPointed(i)}
          >
            {i === correct && <span className="mb-0.5 text-[10px] leading-3 font-bold text-fg">ти</span>}
            <div
              className={clsx(
                'w-full max-w-6 rounded-t-[4px]',
                i === correct ? 'bg-amber-300' : 'bg-[#6b6588]',
                pointed === i && 'brightness-125',
              )}
              // A column for a number nobody got still shows as a sliver on the baseline.
              style={{ height: Math.max(2, Math.round((n / max) * HEIGHT)) }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-1 flex gap-0.5 border-t border-line pt-1">
        {field.histogram.map((_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: one label per column
            key={i}
            className={clsx('flex-1 text-center text-[10px] tabular-nums', i === correct ? 'text-fg' : 'text-fg-3')}
          >
            {i}
          </span>
        ))}
      </div>
      <p aria-hidden className="mt-1.5 text-xs text-fg-3">
        {rightAnswers(shown)}: {people(field.histogram[shown])}
        {shown === correct && ' (с теб)'}
      </p>
      <table className="sr-only">
        <caption>Колко верни отговора имаха играчите днес (от {people(total)})</caption>
        <tbody>
          {field.histogram.map((n, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one row per number of right answers
            <tr key={i}>
              <th scope="row">{rightAnswers(i)}</th>
              <td>
                {people(n)}
                {i === correct && ', сред тях ти'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

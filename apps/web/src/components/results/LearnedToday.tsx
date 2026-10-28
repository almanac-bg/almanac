import type { ReviewItem } from '@quiz/client';
import { BookOpen } from 'lucide-react';
import { Link } from 'react-router';
import { keepTogether } from '../../lib/typography';
import { numberText } from '../game/numbers';
import { Card } from '../ui';

/** How many facts the results show up front (the rest are in the review below). */
const SHOWN = 3;

/**
 * "Научи днес": a few "Знаеше ли?" facts from the match just played, the ones behind the questions you missed first —
 * that's when "so that's why" lands best. Here there's time to read, so the match itself never had to stop for them.
 * `added`: how many of them went into „Моят алманах“ (got right, or stopped on to read).
 */
export function LearnedToday({ items, added }: { items: ReviewItem[]; added: number }) {
  const withFacts = items.filter((i) => i.fact);
  if (!withFacts.length) return null;
  const shown = [...withFacts.filter((i) => !i.right), ...withFacts.filter((i) => i.right)].slice(0, SHOWN);
  return (
    <Card className="mt-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="t-card">💡 Научи днес</h2>
        {added > 0 && (
          <Link
            to="/almanac"
            className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/25"
          >
            <BookOpen aria-hidden className="size-4" />+{added} в алманаха ти
          </Link>
        )}
      </div>
      <ul className="mt-4 space-y-4">
        {shown.map((item) => (
          <li key={item.id}>
            <p className="text-xs text-fg-3">
              {keepTogether(item.q)} —{' '}
              <span className="font-semibold text-emerald-300">
                {item.number ? numberText(item.number.answer, item.number) : keepTogether(item.options[item.correct])}
              </span>
            </p>
            <p className="mt-1 text-[15px] text-fg text-pretty">{item.fact}</p>
          </li>
        ))}
      </ul>
      {withFacts.length > SHOWN && (
        <p className="mt-4 text-xs text-fg-3">Още {withFacts.length - SHOWN} — в прегледа на въпросите по-долу.</p>
      )}
    </Card>
  );
}

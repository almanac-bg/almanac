import type { ReviewItem } from '@quiz/client';
import { Card } from '../ui';

/** How many facts the results show up front (the rest are in the review below). */
const SHOWN = 3;

/**
 * "Научи днес": a few "Знаеше ли?" facts from the match just played, the ones behind the questions you missed first —
 * that's when "so that's why" lands best. Here there's time to read, so the match itself never had to stop for them.
 */
export function LearnedToday({ items }: { items: ReviewItem[] }) {
  const withFacts = items.filter((i) => i.fact);
  if (!withFacts.length) return null;
  const shown = [...withFacts.filter((i) => !i.right), ...withFacts.filter((i) => i.right)].slice(0, SHOWN);
  return (
    <Card className="mt-4 p-5 sm:p-6">
      <h2 className="t-card">💡 Научи днес</h2>
      <ul className="mt-4 space-y-4">
        {shown.map((item) => (
          <li key={item.id}>
            <p className="text-xs text-fg-3">
              {item.q} — <span className="font-semibold text-emerald-300">{item.options[item.correct]}</span>
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

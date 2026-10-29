import { actions, plural, timeAgo, toast } from '@quiz/client';
import { type AlmanacFact, MASTERY_TIERS, REVIEW, type ReviewQueue } from '@quiz/shared';
import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { keepTogether } from '../lib/typography';
import { numberText } from './game/numbers';
import { Thumbnail } from './game/QuestionPicture';
import { Button, Card } from './ui';

/** A category's mastery tier, as a small badge: „🥈 Експерт“. */
export function TierBadge({ tier, className }: { tier: number; className?: string }) {
  const t = MASTERY_TIERS[tier];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full bg-emerald-400/12 px-2 py-0.5 text-xs font-bold text-emerald-200',
        className,
      )}
    >
      <span aria-hidden>{t.icon}</span>
      {t.name}
    </span>
  );
}

/** One fact of the almanac: its question and answer, small, then the fact itself. */
export function FactItem({ fact }: { fact: AlmanacFact }) {
  return (
    <div className="flex gap-3">
      {fact.image && <Thumbnail image={fact.image} />}
      <div className="min-w-0">
        <p className="text-xs text-fg-3">
          {keepTogether(fact.q)} —{' '}
          <span className="font-semibold text-emerald-300">
            {fact.number
              ? numberText(fact.number.answer, fact.number)
              : fact.order
                ? fact.order.items.map((i) => i.text).join(' → ')
                : keepTogether(fact.answer ?? '')}
          </span>
        </p>
        <p className="mt-1 text-[15px] text-fg text-pretty">{fact.fact}</p>
      </div>
    </div>
  );
}

/** Starts „Поправителен“ (the match screen opens by itself once it does). */
export function useStartReview() {
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    const res = await actions.startReview();
    setBusy(false);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  }
  return { busy, start };
}

/**
 * „Поправителен“: the questions missed a few days ago, back to be answered again — ready to play, waiting for a few
 * more, or saying when the next one comes back.
 */
export function ReviewCard({ queue, className }: { queue: ReviewQueue; className?: string }) {
  const { busy, start } = useStartReview();
  const nothing = queue.due === 0 && queue.waiting === 0;
  return (
    <Card className={clsx('relative overflow-hidden p-5 sm:p-6', className)}>
      <div className="absolute -top-16 -right-12 size-48 rounded-full glow text-emerald-400/20" />
      <div className="relative flex flex-wrap items-center gap-4">
        <span aria-hidden className="text-4xl leading-none">
          📒
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="t-card">Поправителен</h2>
          <p className="mt-0.5 text-sm text-fg-2 text-pretty">
            {queue.ready
              ? `${plural(queue.due, 'сгрешен въпрос се върна', 'сгрешени въпроса се върнаха')}. Помниш ли ги сега?`
              : queue.due > 0
                ? `${plural(queue.due, 'въпрос се върна', 'въпроса се върнаха')}: играе се, щом станат поне ${REVIEW.min}.`
                : nothing
                  ? `Сгрешеното се връща тук след ${REVIEW.afterDays.join(', ').replace(/, (\d+)$/, ' и $1')} дни — докато го запомниш.`
                  : `${plural(queue.waiting, 'сгрешен въпрос чака', 'сгрешени въпроса чакат')}: следващият се връща ${timeAgo(queue.nextDueAt!)}.`}
          </p>
        </div>
        {queue.ready && (
          <Button variant="gold" onClick={() => void start()} loading={busy}>
            Играй <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </Card>
  );
}

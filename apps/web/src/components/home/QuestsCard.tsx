import { refreshMe, useNow, useStore } from '@quiz/client';
import type { QuestInfo } from '@quiz/shared';
import clsx from 'clsx';
import { Check, ListChecks } from 'lucide-react';
import { useEffect } from 'react';
import { Card, ProgressBar } from '../ui';
import { countdown } from './time';

/** Today's three quests: any match moves them along and pays their XP by itself; all three earn a bonus on top. */
export function QuestsCard({ className }: { className?: string }) {
  const quests = useStore((s) => s.me!.quests);
  const now = useNow(1000);

  // Midnight in Sofia: a new set is up. Asked again now and then, in case this clock runs ahead of the server's.
  const expired = now >= quests.endsAt;
  useEffect(() => {
    if (!expired) return;
    void refreshMe();
    const id = setInterval(() => void refreshMe(), 30_000);
    return () => clearInterval(id);
  }, [expired]);

  const total = quests.quests.length;
  if (!total) return null;
  const done = quests.quests.filter((q) => q.done).length;

  return (
    <Card className={clsx('relative flex flex-col overflow-hidden p-5 sm:p-7', className)}>
      <div aria-hidden className="absolute -top-20 -right-16 size-56 rounded-full bg-sky-500/15 blur-3xl" />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sky-300">
          <ListChecks aria-hidden className="size-5" />
          <span className="t-eyebrow">Всеки ден нови</span>
        </div>
        <span className={clsx('text-xs font-bold tabular-nums', done === total ? 'text-emerald-300' : 'text-fg-3')}>
          {done}/{total}
          <span className="sr-only"> изпълнени</span>
        </span>
      </div>
      <h2 className="relative mt-2 t-card">Задачи за деня</h2>
      <p className="relative mt-1 text-sm text-fg-3">Всеки мач брои. Щом изпълниш задача, XP идва сам.</p>

      <ul className="relative mt-5 space-y-4">
        {quests.quests.map((q) => (
          <Quest key={q.id} quest={q} />
        ))}
      </ul>

      <div
        className={clsx(
          'relative mt-5 flex items-center gap-3 rounded-2xl border p-3',
          quests.bonusDone ? 'border-emerald-300/25 bg-emerald-400/10' : 'border-amber-300/20 bg-amber-400/[0.07]',
        )}
      >
        <span aria-hidden className="text-xl leading-none">
          🎁
        </span>
        <p className="min-w-0 flex-1 text-sm text-fg-2">
          {quests.bonusDone ? 'Бонусът за трите задачи е твой!' : 'Изпълни и трите за бонус'}
        </p>
        <span
          className={clsx(
            'shrink-0 text-sm font-bold tabular-nums',
            quests.bonusDone ? 'text-emerald-300' : 'text-amber-300',
          )}
        >
          {quests.bonusDone && <Check aria-hidden className="mr-0.5 inline size-4 align-[-3px]" />}+{quests.bonusXp} XP
        </span>
      </div>

      <p className="relative mt-auto pt-4 text-xs text-fg-3 tabular-nums">
        Нови задачи след {countdown(quests.endsAt - now)}
      </p>
    </Card>
  );
}

function Quest({ quest: q }: { quest: QuestInfo }) {
  const value = Math.min(q.progress, q.goal);
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={clsx(
          'relative grid size-10 shrink-0 place-items-center rounded-xl text-xl leading-none',
          q.done ? 'bg-emerald-400/15' : 'bg-white/5',
        )}
      >
        {q.icon}
        {q.done && (
          <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full bg-emerald-400 text-emerald-950 ring-2 ring-ink-2">
            <Check className="size-3" strokeWidth={3.5} />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className={clsx('min-w-0 text-sm font-semibold', q.done && 'text-fg-2')}>
            {q.text}
            {q.done && <span className="sr-only"> — изпълнена</span>}
          </p>
          <span
            className={clsx('shrink-0 text-xs font-bold tabular-nums', q.done ? 'text-emerald-300' : 'text-violet-300')}
          >
            +{q.xp} XP
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2.5">
          <ProgressBar
            value={value / q.goal}
            className="h-1.5 flex-1"
            gradient={q.done ? 'linear-gradient(90deg,#34d399,#6ee7b7)' : 'linear-gradient(90deg,#38bdf8,#a78bfa)'}
          />
          <span className="text-xs text-fg-3 tabular-nums">
            <span className="sr-only">
              {value} от {q.goal}
            </span>
            <span aria-hidden>
              {value}/{q.goal}
            </span>
          </span>
        </div>
      </div>
    </li>
  );
}

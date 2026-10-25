import { DIFFICULTY_LABEL } from '@quiz/client';
import { categoryById, type QuestionDraft } from '@quiz/shared';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { LETTERS, OPTION_COLORS } from './draft';

/** Read-only question card styled like the in-game one, with the correct answer highlighted. */
export function QuestionPreview({ draft, compact }: { draft: QuestionDraft; compact?: boolean }) {
  const cat = categoryById(draft.category)!;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold"
          style={{ borderColor: `${cat.color}55`, background: `${cat.color}14`, color: cat.color }}
        >
          {cat.icon} {cat.name}
        </span>
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-semibold text-fg-3">
          {DIFFICULTY_LABEL[draft.difficulty]}
        </span>
      </div>

      <div className={clsx('glass relative mt-3 overflow-hidden rounded-3xl', compact ? 'p-4' : 'p-5 sm:p-6')}>
        <div
          className="absolute -top-16 left-1/2 size-48 -translate-x-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: cat.color }}
        />
        <p
          className={clsx(
            'relative leading-snug font-bold text-balance break-words',
            compact ? 'text-base' : 'text-lg sm:text-xl',
          )}
        >
          {draft.q.trim() || <span className="text-fg-3">Тук ще се появи въпросът…</span>}
        </p>
      </div>

      <div className={clsx('mt-3 grid gap-2', !compact && 'sm:grid-cols-2')}>
        {draft.options.map((text, i) => {
          const correct = draft.answer === i;
          const color = OPTION_COLORS[i];
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: the four answers are fixed slots (А–Г)
              key={i}
              className={clsx(
                'relative flex min-h-12 items-center gap-3 overflow-hidden rounded-2xl border px-3 py-2.5',
                correct ? 'border-emerald-400/70 bg-emerald-500/15' : 'glass',
              )}
            >
              <span className="absolute inset-y-0 left-0 w-1" style={{ background: correct ? '#34d399' : color }} />
              <span
                className="grid size-8 shrink-0 place-items-center rounded-lg font-display text-sm font-bold"
                style={{ background: correct ? '#34d399' : `${color}22`, color: correct ? '#0b0a14' : color }}
              >
                {correct ? <Check className="size-4" strokeWidth={3} /> : LETTERS[i]}
              </span>
              <span className={clsx('min-w-0 flex-1 text-sm font-semibold break-words', !text.trim() && 'text-fg-3')}>
                {text.trim() || '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

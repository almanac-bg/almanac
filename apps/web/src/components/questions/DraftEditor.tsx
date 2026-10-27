import { CATEGORIES, type CategoryId, type Difficulty, type QuestionDraft, SUBMISSION_RULES } from '@quiz/shared';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { LETTERS, OPTION_COLORS } from '../game/answers';
import { Segmented } from '../ui';
import type { DraftErrors } from './draft';

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Лесен' },
  { value: 'medium', label: 'Среден' },
  { value: 'hard', label: 'Труден' },
];

/** Form fields for a question: category, difficulty, text, four options and the correct one. */
export function DraftEditor({
  draft,
  onChange,
  errors = {},
  compact,
}: {
  draft: QuestionDraft;
  onChange: (d: QuestionDraft) => void;
  errors?: DraftErrors;
  compact?: boolean;
}) {
  const [, qMax] = SUBMISSION_RULES.question;
  const [, oMax] = SUBMISSION_RULES.option;
  const set = (patch: Partial<QuestionDraft>) => onChange({ ...draft, ...patch });
  const setOption = (i: number, value: string) => set({ options: draft.options.map((o, j) => (j === i ? value : o)) });
  const qLength = draft.q.trim().length;

  return (
    <div className="space-y-5">
      <Field label="Категория">
        {compact ? (
          <select
            value={draft.category}
            onChange={(e) => set({ category: e.target.value as CategoryId })}
            className="field h-11 w-full rounded-2xl pr-10 pl-3 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id} className="bg-ink-2">
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CATEGORIES.map((c) => {
              const active = draft.category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => set({ category: c.id })}
                  aria-pressed={active}
                  className={clsx(
                    'focus-ring flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors pointer-coarse:min-h-11',
                    active ? 'text-fg' : 'border-line bg-white/[0.03] text-fg-2 hover:bg-white/[0.07]',
                  )}
                  style={active ? { borderColor: `${c.color}99`, background: `${c.color}1f` } : undefined}
                >
                  <span className="text-lg leading-none">{c.icon}</span>
                  <span className="truncate">{c.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </Field>

      <Field label="Трудност">
        <Segmented value={draft.difficulty} onChange={(difficulty) => set({ difficulty })} options={DIFFICULTIES} />
      </Field>

      <Field label="Въпрос" error={errors.q}>
        <div className="relative">
          <textarea
            value={draft.q}
            onChange={(e) => set({ q: e.target.value })}
            rows={compact ? 2 : 3}
            maxLength={qMax + 20}
            placeholder="напр. Кой е най-високият връх на Балканския полуостров?"
            aria-invalid={!!errors.q}
            className="field w-full resize-none rounded-2xl px-4 py-3 pb-7 text-[15px] aria-invalid:border-rose-400/60"
          />
          <span
            className={clsx(
              'pointer-events-none absolute right-3 bottom-2.5 text-xs tabular-nums',
              qLength > qMax ? 'text-rose-300' : 'text-fg-3',
            )}
          >
            {qLength}/{qMax}
          </span>
        </div>
      </Field>

      <Field label="Отговори — отбележи верния" error={errors.options ?? errors.answer}>
        <div className={clsx('grid gap-2', !compact && 'sm:grid-cols-2')}>
          {draft.options.map((value, i) => {
            const color = OPTION_COLORS[i];
            const correct = draft.answer === i;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: answer slots; a text key remounts the input as you type
                key={i}
                className={clsx(
                  'field-box relative flex items-center gap-2 overflow-hidden rounded-2xl py-1.5 pr-1.5 pl-3',
                  correct && 'border-emerald-400/70 bg-emerald-500/10',
                )}
              >
                <span className="absolute inset-y-0 left-0 w-1" style={{ background: correct ? '#34d399' : color }} />
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-lg font-display text-sm font-bold"
                  style={{ background: `${color}22`, color }}
                >
                  {LETTERS[i]}
                </span>
                <input
                  value={value}
                  onChange={(e) => setOption(i, e.target.value)}
                  maxLength={oMax + 10}
                  placeholder={`Отговор ${LETTERS[i]}`}
                  aria-label={`Отговор ${LETTERS[i]}`}
                  className="h-9 min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:font-normal placeholder:text-fg-3"
                />
                <button
                  type="button"
                  onClick={() => set({ answer: i })}
                  aria-pressed={correct}
                  title="Верен отговор"
                  className={clsx(
                    'focus-ring inline-flex h-8 shrink-0 items-center gap-1 rounded-xl px-2.5 text-xs font-bold transition-colors pointer-coarse:h-11',
                    correct ? 'bg-emerald-400 text-ink' : 'bg-white/5 text-fg-3 hover:bg-white/10 hover:text-fg-2',
                  )}
                >
                  <Check className="size-3.5" strokeWidth={3} />
                  <span className={clsx(compact && 'hidden sm:inline')}>верен</span>
                </button>
              </div>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-fg-2 uppercase">{label}</p>
      {children}
      {error && <p className="mt-1.5 text-xs font-semibold text-rose-300">{error}</p>}
    </div>
  );
}

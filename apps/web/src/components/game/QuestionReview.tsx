import { api, type ReviewItem, toast } from '@quiz/client';
import { categoryById, QUESTION_REPORT_REASONS, type QuestionReportReason } from '@quiz/shared';
import clsx from 'clsx';
import { Check, ChevronDown, Flag, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Button, Card, Modal } from '../ui';
import { LETTERS } from './answers';

/** The match's questions with the right answers, and a way to flag a mistake in any of them. */
export function QuestionReview({ items }: { items: ReviewItem[] }) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState<ReviewItem | null>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const right = items.filter((i) => i.right).length;

  return (
    <Card className="mt-4 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="focus-ring flex w-full items-center justify-between gap-4 rounded-3xl p-5 text-left sm:px-6"
      >
        <div>
          <h2 className="font-display text-lg font-bold">Преглед на въпросите</h2>
          <p className="text-sm text-fg-3">
            {right} от {items.length} верни · видя ли грешка във въпрос? Сигнализирай с <Flag className="inline size-3.5" />
          </p>
        </div>
        <ChevronDown className={clsx('size-5 shrink-0 text-fg-3 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="divide-y divide-line border-t border-line"
          >
            {items.map((item) => (
              <ReviewRow
                key={item.index}
                item={item}
                reported={reported.has(item.id)}
                onReport={() => setReporting(item)}
              />
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
      <ReportQuestion
        item={reporting}
        onClose={() => setReporting(null)}
        onSent={(id) => setReported((s) => new Set(s).add(id))}
      />
    </Card>
  );
}

function ReviewRow({ item, reported, onReport }: { item: ReviewItem; reported: boolean; onReport: () => void }) {
  const category = categoryById(item.category);
  return (
    <li className="flex gap-3 px-5 py-4 sm:px-6">
      <span
        className={clsx(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold',
          item.right ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
        )}
        aria-label={item.right ? 'Верен отговор' : 'Грешен отговор'}
      >
        {item.right ? <Check className="size-4" /> : <X className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-fg-3">
          {item.index + 1}. {category?.icon} {category?.name}
        </p>
        <p className="mt-0.5 font-semibold">{item.q}</p>
        <p className="mt-1.5 text-sm text-emerald-300">
          ✓ {LETTERS[item.correct]}) {item.options[item.correct]}
        </p>
        {!item.right && (
          <p className="text-sm text-rose-300/90">
            {item.choice === null || item.choice < 0
              ? 'Без отговор'
              : `Ти: ${LETTERS[item.choice]}) ${item.options[item.choice]}`}
          </p>
        )}
      </div>
      <button
        onClick={onReport}
        disabled={reported}
        title={reported ? 'Сигнализирано — благодарим!' : 'Сигнализирай за грешка'}
        aria-label={reported ? 'Сигнализирано' : `Сигнализирай за грешка във въпрос ${item.index + 1}`}
        className={clsx(
          'focus-ring -mt-1.5 -mr-2 grid size-11 shrink-0 place-items-center rounded-xl transition-colors',
          reported ? 'text-amber-300' : 'text-fg-3 hover:bg-white/10 hover:text-amber-300',
        )}
      >
        <Flag className={clsx('size-4', reported && 'fill-current')} />
      </button>
    </li>
  );
}

function ReportQuestion({ item, onClose, onSent }: { item: ReviewItem | null; onClose: () => void; onSent: (id: string) => void }) {
  const [reason, setReason] = useState<QuestionReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  function close() {
    setReason(null);
    setDetails('');
    onClose();
  }

  async function submit() {
    if (!item || !reason) return;
    setBusy(true);
    try {
      await api.reportQuestion(item.id, reason, details);
      onSent(item.id);
      toast({ kind: 'success', title: 'Благодарим!', body: 'Модератор ще прегледа въпроса.' });
      close();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof Error ? err.message : 'Нещо се обърка.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!item} onClose={close} title="Сигнализирай за грешка">
      {item && <p className="mb-4 rounded-2xl bg-white/5 p-3 text-sm text-fg-2">{item.q}</p>}
      <div className="space-y-2">
        {QUESTION_REPORT_REASONS.map((r) => (
          <label
            key={r.id}
            className={clsx(
              'flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors',
              reason === r.id ? 'border-amber-400/50 bg-amber-500/10' : 'border-line hover:bg-white/5',
            )}
          >
            <input
              type="radio"
              name="question-reason"
              checked={reason === r.id}
              onChange={() => setReason(r.id)}
              className="accent-amber-400"
            />
            {r.label}
          </label>
        ))}
      </div>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value.slice(0, 500))}
        placeholder="Какъв е верният отговор или какво не е наред? (по желание)"
        rows={3}
        className="mt-4 w-full rounded-2xl border border-line bg-black/30 p-3 text-sm outline-none focus:border-violet-400/60"
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>
          Отказ
        </Button>
        <Button onClick={submit} disabled={!reason} loading={busy}>
          Изпрати
        </Button>
      </div>
    </Modal>
  );
}

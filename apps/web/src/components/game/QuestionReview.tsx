import { api, errorMessage, fmt, percent, type ReviewItem, toast, useStore } from '@quiz/client';
import { categoryById, QUESTION_REPORT_REASONS, type QuestionReportReason } from '@quiz/shared';
import clsx from 'clsx';
import { Check, ChevronDown, Flag, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { keepTogether } from '../../lib/typography';
import { Button, Card, Modal } from '../ui';
import { LETTERS } from './answers';
import { numberText, offText } from './numbers';

/** A question from a room host's own set („Моите въпроси“), not the bank. */
const ownQuestion = (item: ReviewItem) => item.id.startsWith('set-');

/** The match's questions with the right answers, and a way to flag a mistake in any of them. */
export function QuestionReview({ items }: { items: ReviewItem[] }) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState<ReviewItem | null>(null);
  // Flagging needs a saved account (the server refuses guests).
  const canReport = useStore((s) => !s.me?.isGuest);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const right = items.filter((i) => i.right).length;

  return (
    <Card className="mt-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="focus-ring flex w-full items-center justify-between gap-4 rounded-3xl p-5 text-left sm:px-6"
      >
        <div>
          <h2 className="t-card">Преглед на въпросите</h2>
          <p className="text-sm text-fg-3">
            {right} от {items.length} верни
            {canReport && (
              <>
                {' '}
                · видя ли грешка във въпрос? Сигнализирай с <Flag className="inline size-3.5" />
              </>
            )}
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
                // A host's own question isn't the bank's to fix.
                onReport={canReport && !ownQuestion(item) ? () => setReporting(item) : null}
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

function ReviewRow({
  item,
  reported,
  onReport,
}: {
  item: ReviewItem;
  reported: boolean;
  onReport: (() => void) | null;
}) {
  const category = categoryById(item.category);
  return (
    <li className="flex gap-3 px-5 py-4 sm:px-6">
      <span
        className={clsx(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold',
          item.right ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
        )}
        role="img"
        aria-label={item.right ? 'Верен отговор' : 'Грешен отговор'}
      >
        {item.right ? <Check className="size-4" /> : <X className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-fg-3">
          {item.index + 1}. {ownQuestion(item) ? '📝 От набора на домакина' : `${category?.icon} ${category?.name}`}
        </p>
        <p className="mt-0.5 font-semibold">{keepTogether(item.q)}</p>
        {item.number ? (
          <>
            <p className="mt-1.5 text-sm text-emerald-300">✓ {numberText(item.number.answer, item.number)}</p>
            <p className={clsx('text-sm', item.right ? 'text-fg-2' : 'text-rose-300/90')}>
              {item.number.guess === null
                ? 'Без отговор'
                : `Ти: ${numberText(item.number.guess, item.number)} (${offText(item.number.guess, item.number.answer, item.number)})`}
            </p>
            {item.crowd && (
              <p className="mt-1 text-xs text-fg-3">
                {percent(item.crowd.known)} от всички бяха близо (от {fmt(item.crowd.answers)} отговора)
              </p>
            )}
          </>
        ) : item.crowd?.picks ? (
          <OptionShares item={item} picks={item.crowd.picks} answers={item.crowd.answers} />
        ) : (
          <>
            <p className="mt-1.5 text-sm text-emerald-300">
              ✓ {LETTERS[item.correct]}) {keepTogether(item.options[item.correct])}
            </p>
            {!item.right && (
              <p className="text-sm text-rose-300/90">
                {item.choice === null || item.choice < 0
                  ? 'Без отговор'
                  : `Ти: ${LETTERS[item.choice]}) ${keepTogether(item.options[item.choice])}`}
              </p>
            )}
          </>
        )}
        {item.fact && (
          <p className="mt-2 text-sm text-fg-2 text-pretty">
            <span className="font-semibold text-amber-200">💡 </span>
            {item.fact}
          </p>
        )}
      </div>
      {onReport && (
        <button
          type="button"
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
      )}
    </li>
  );
}

/** Every option with the share of everyone who picked it: the right one, yours, and what tempted the rest. */
function OptionShares({ item, picks, answers }: { item: ReviewItem; picks: number[]; answers: number }) {
  const yours = item.choice !== null && item.choice >= 0 ? item.choice : null;
  return (
    <>
      <ul className="mt-2 space-y-1">
        {item.options.map((text, i) => {
          const right = i === item.correct;
          const mine = i === yours;
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: the four options are fixed slots (А–Г)
              key={i}
              className="relative overflow-hidden rounded-lg bg-white/[0.03] px-2.5 py-1 text-sm"
            >
              <span
                aria-hidden
                className={clsx(
                  'absolute inset-y-0 left-0 rounded-lg',
                  right ? 'bg-emerald-500/20' : mine ? 'bg-rose-500/20' : 'bg-white/[0.06]',
                )}
                style={{ width: percent(picks[i]) }}
              />
              <span className="relative flex items-baseline justify-between gap-3">
                <span className={clsx(right ? 'font-semibold text-emerald-300' : mine ? 'text-rose-300' : 'text-fg-2')}>
                  {right && '✓ '}
                  {LETTERS[i]}) {keepTogether(text)}
                  {mine && <span className="font-semibold"> · ти</span>}
                </span>
                <span className="shrink-0 text-fg-3 tabular-nums">{percent(picks[i])}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-xs text-fg-3">
        {yours === null && !item.right && <span className="text-rose-300/90">Без отговор · </span>}
        Как отговориха всички (от {fmt(answers)} отговора)
      </p>
    </>
  );
}

function ReportQuestion({
  item,
  onClose,
  onSent,
}: {
  item: ReviewItem | null;
  onClose: () => void;
  onSent: (id: string) => void;
}) {
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
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!item} onClose={close} title="Сигнализирай за грешка">
      {item && <p className="mb-4 rounded-2xl bg-white/5 p-3 text-sm text-fg-2">{keepTogether(item.q)}</p>}
      <div className="space-y-2">
        {/* The fact is a reason only where there is one. */}
        {QUESTION_REPORT_REASONS.filter((r) => r.id !== 'fact' || item?.fact).map((r) => (
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
        className="field mt-4 w-full rounded-2xl p-3 text-sm"
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

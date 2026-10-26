import { api, DIFFICULTY_LABEL, errorMessage, type QuestionReports, timeAgo, toast } from '@quiz/client';
import { categoryById, QUESTION_REPORT_REASONS, type QuestionInfo, type QuestionReportGroup } from '@quiz/shared';
import clsx from 'clsx';
import { Check, EyeOff, Flag, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect, useState } from 'react';
import { useLoad } from '../../lib/load';
import { LETTERS } from '../game/answers';
import { LoadError } from '../LoadError';
import { Button, Card, EmptyState, Spinner } from '../ui';

const reasonLabel = (id: string) => QUESTION_REPORT_REASONS.find((r) => r.id === id)?.label ?? id;

/** Questions players flagged as wrong, the most reported first; hiding one takes it out of new matches at once. */
export function QuestionReportsQueue({ onOpen }: { onOpen: (n: number) => void }) {
  const { data, error, retry, setData } = useLoad(() => api.adminQuestionReports());

  // biome-ignore lint/correctness/useExhaustiveDependencies: `onOpen` is recreated on every parent render
  useEffect(() => {
    if (data) onOpen(data.groups.length);
  }, [data]);

  function update(next: QuestionReports) {
    setData(next);
  }

  if (error && !data) return <LoadError title="Сигналите не се заредиха" error={error} onRetry={retry} />;
  if (!data) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {data.groups.length === 0 ? (
        <Card>
          <EmptyState icon="✅" title="Няма сигнали за въпроси" body="Играчите не са открили грешки — засега." />
        </Card>
      ) : (
        <>
          <p className="text-fg-2">
            Сигнали от играчите за грешни или неясни въпроси. „Скрий“ спира въпроса за нови мачове веднага; вградените
            въпроси се поправят в <code>questions.json</code> по номера им.
          </p>
          <AnimatePresence initial={false}>
            {data.groups.map((g) => (
              <QuestionReportCard key={g.question.id} group={g} onResolved={update} />
            ))}
          </AnimatePresence>
        </>
      )}
      {data.hidden.length > 0 && <HiddenQuestions questions={data.hidden} onChange={update} />}
    </div>
  );
}

function QuestionCard({ question, children }: { question: QuestionInfo; children?: ReactNode }) {
  const category = categoryById(question.category);
  return (
    <>
      <p className="text-xs text-fg-3">
        <code>{question.id}</code> · {category?.icon} {category?.name} · {DIFFICULTY_LABEL[question.difficulty]}
        {question.author && ` · от ${question.author}`}
      </p>
      <p className="mt-1 font-semibold">{question.q}</p>
      <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
        {question.options.map((o, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: the four answers are fixed slots (А–Г)
            key={i}
            className={clsx(
              'rounded-xl px-3 py-2',
              i === question.answer ? 'bg-emerald-500/15 font-semibold text-emerald-200' : 'bg-white/5 text-fg-2',
            )}
          >
            {LETTERS[i]}) {o} {i === question.answer && '✓'}
          </li>
        ))}
      </ol>
      {children}
    </>
  );
}

function QuestionReportCard({
  group,
  onResolved,
}: {
  group: QuestionReportGroup;
  onResolved: (r: QuestionReports) => void;
}) {
  const [busy, setBusy] = useState<'dismiss' | 'hide' | null>(null);

  async function decide(action: 'dismiss' | 'hide') {
    setBusy(action);
    try {
      const r = await api.resolveQuestionReports(group.question.id, action);
      toast({
        kind: 'success',
        title: action === 'hide' ? 'Въпросът е скрит от нови мачове' : 'Сигналите са затворени',
      });
      onResolved(r);
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}>
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <QuestionCard question={group.question} />
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-sm font-bold text-amber-300">
            <Flag className="size-3.5" /> {group.reports.length}
          </span>
        </div>
        <ul className="mt-4 space-y-2">
          {group.reports.map((r) => (
            <li key={r.id} className="rounded-2xl border border-line bg-black/20 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{reasonLabel(r.reason)}</span>
                <span className="text-xs text-fg-3">
                  {r.reporter ?? 'изтрит профил'} · {timeAgo(r.createdAt)}
                </span>
              </div>
              {r.details && <p className="mt-1 text-fg-2">„{r.details}“</p>}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'dismiss'}
            disabled={!!busy}
            onClick={() => decide('dismiss')}
          >
            <Check className="size-4" /> Въпросът е наред
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-amber-300 hover:bg-amber-500/10"
            loading={busy === 'hide'}
            disabled={!!busy}
            onClick={() => decide('hide')}
          >
            <EyeOff className="size-4" /> Скрий въпроса
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

function HiddenQuestions({
  questions,
  onChange,
}: {
  questions: QuestionInfo[];
  onChange: (r: QuestionReports) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function unhide(id: string) {
    setBusy(id);
    try {
      onChange(await api.unhideQuestion(id));
      toast({ kind: 'success', title: 'Въпросът отново се появява в мачовете' });
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3 pt-4">
      <h2 className="t-card">Скрити въпроси ({questions.length})</h2>
      {questions.map((q) => (
        <Card key={q.id} className="p-5">
          <QuestionCard question={q}>
            <Button size="sm" variant="secondary" className="mt-4" loading={busy === q.id} onClick={() => unhide(q.id)}>
              <RotateCcw className="size-4" /> Върни в играта
            </Button>
          </QuestionCard>
        </Card>
      ))}
    </section>
  );
}

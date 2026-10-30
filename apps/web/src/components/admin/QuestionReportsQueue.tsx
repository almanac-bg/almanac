import { api, DIFFICULTY_LABEL, errorMessage, type QuestionReports, timeAgo, toast, useStore } from '@quiz/client';
import {
  categoryById,
  QUESTION_REPORT_REASONS,
  type QuestionDraft,
  type QuestionInfo,
  type QuestionReportAction,
  type QuestionReportGroup,
} from '@quiz/shared';
import clsx from 'clsx';
import { Check, EyeOff, Flag, Lightbulb, Pencil, RefreshCw, RotateCcw, Wrench } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { type ReactNode, useEffect, useState } from 'react';
import { useLoad } from '../../lib/load';
import { Emoji } from '../Emoji';
import { LETTERS } from '../game/answers';
import { RightOrderList } from '../game/OrderQuestion';
import { QuestionPicture } from '../game/QuestionPicture';
import { LoadError } from '../LoadError';
import { Button, Card, EmptyState, Spinner } from '../ui';
import { EditQuestionModal } from './EditQuestionModal';

const reasonLabel = (id: string) => QUESTION_REPORT_REASONS.find((r) => r.id === id)?.label ?? id;

const sourceHost = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** A player's question (in the database, so a moderator corrects it here); the bank's are fixed in its repo. */
const isCommunity = (q: QuestionInfo) => q.id.startsWith('usr-');

/** A question as the editor takes it (a player's question, corrected by a moderator). */
export const draftOf = (q: QuestionInfo): QuestionDraft => ({
  category: q.category,
  difficulty: q.difficulty,
  q: q.q,
  options: q.options,
  answer: q.answer,
  answerSource: q.answerSource ?? '',
  fact: q.fact ?? '',
  factSource: q.factSource ?? '',
});

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
      <ReloadBank />
      {data.groups.length === 0 ? (
        <Card>
          <EmptyState icon="✅" title="Няма сигнали за въпроси" body="Играчите не са открили грешки — засега." />
        </Card>
      ) : (
        <>
          <p className="text-fg-2">
            Сигнали от играчите за грешни или неясни въпроси. „Скрий“ спира въпроса за нови мачове веднага. Въпросите на
            играчите се поправят тук („Редактирай“); тези от банката — в <code>questions.json</code> по номера им, после
            „Презареди банката“. „Поправих го“ връща въпроса в играта, нулира числата му и благодари на сигнализиралите.
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

/** After a fix pulled into the bank on the server: the game reads it again without a restart. */
function ReloadBank() {
  const [busy, setBusy] = useState(false);
  const owner = useStore((s) => s.me?.staffRole === 'owner');
  async function reload() {
    setBusy(true);
    try {
      await api.reloadBank();
      toast({ kind: 'success', title: 'Банката е заредена наново' });
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  // The bank is the owner's (the server's copy of it).
  if (!owner) return null;
  return (
    <div className="flex justify-end">
      <Button size="sm" variant="ghost" onClick={reload} loading={busy}>
        <RefreshCw className="size-4" /> Презареди банката
      </Button>
    </div>
  );
}

export function QuestionCard({ question, children }: { question: QuestionInfo; children?: ReactNode }) {
  const category = categoryById(question.category);
  return (
    <>
      <p className="text-xs text-fg-3">
        <code>{question.id}</code> · {category && <Emoji e={category.icon} />} {category?.name} ·{' '}
        {DIFFICULTY_LABEL[question.difficulty]}
        {question.author && ` · от ${question.author}`}
      </p>
      <p className="mt-1 font-semibold">{question.q}</p>
      {question.image && (
        <QuestionPicture image={question.image} credit={question.image} maxHeight="12rem" className="mt-3 !mx-0" />
      )}
      {question.order && (
        <div className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2">
          <RightOrderList items={question.order.items} unit={question.order.unit} />
        </div>
      )}
      {question.number && (
        <p className="mt-3 rounded-xl bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-200">
          <Emoji e="🔢" /> {question.number.answer.toLocaleString('bg-BG')} {question.number.unit} ✓
        </p>
      )}
      <ol className="mt-3 grid gap-1.5 text-sm empty:hidden sm:grid-cols-2">
        {question.options.map((o, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: the four answers are fixed slots (А–Г)
            key={i}
            className={clsx(
              'rounded-xl px-3 py-2',
              i === question.answer ? 'bg-emerald-500/15 font-semibold text-emerald-200' : 'bg-tint/5 text-fg-2',
            )}
          >
            {LETTERS[i]}) {o} {i === question.answer && '✓'}
          </li>
        ))}
      </ol>
      {question.answerSource && (
        <p className="mt-2 text-xs text-fg-3">
          Отговорът се проверява в{' '}
          <a
            href={question.answerSource}
            target="_blank"
            rel="noreferrer noopener"
            className="text-violet-300 underline"
          >
            {sourceHost(question.answerSource)}
          </a>
        </p>
      )}
      {question.fact && (
        <p className="mt-3 rounded-xl bg-amber-400/[0.07] px-3 py-2 text-sm text-fg-2">
          <Lightbulb aria-hidden className="mb-0.5 inline size-4 text-amber-200" /> {question.fact}
          {question.factSource && (
            <>
              {' '}
              <a
                href={question.factSource}
                target="_blank"
                rel="noreferrer noopener"
                className="text-violet-300 underline"
              >
                източник
              </a>
            </>
          )}
        </p>
      )}
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
  const [busy, setBusy] = useState<QuestionReportAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(group.question);

  async function decide(action: QuestionReportAction) {
    setBusy(action);
    try {
      const r = await api.resolveQuestionReports(group.question.id, action);
      toast({
        kind: 'success',
        title:
          action === 'hide'
            ? 'Въпросът е скрит от нови мачове'
            : action === 'fixed'
              ? 'Поправен: числата му започват отначало, а сигнализиралите получават благодарност'
              : 'Сигналите са затворени',
      });
      onResolved(r);
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <m.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}>
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <QuestionCard question={question} />
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-sm font-bold text-amber-300">
            <Flag className="size-3.5" /> {group.reports.length}
          </span>
        </div>
        <ul className="mt-4 space-y-2">
          {group.reports.map((r) => (
            <li key={r.id} className="rounded-2xl border border-line bg-sunk/20 px-4 py-3 text-sm">
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
          {isCommunity(question) && (
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Редактирай
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'fixed'}
            disabled={!!busy}
            onClick={() => decide('fixed')}
            title={
              isCommunity(question)
                ? 'След редакцията: числата му започват отначало, сигнализиралите получават благодарност'
                : 'След поправката в банката (и „Презареди банката“): числата му започват отначало'
            }
          >
            <Wrench className="size-4" /> Поправих го
          </Button>
          {question.hidden ? (
            <span className="inline-flex items-center gap-1.5 self-center text-xs font-semibold text-amber-300">
              <EyeOff className="size-4" /> Скрит от новите мачове, докато решиш
            </span>
          ) : (
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
          )}
        </div>
      </Card>
      <EditQuestionModal
        questionId={editing ? question.id : null}
        draft={editing ? draftOf(question) : null}
        onClose={() => setEditing(false)}
        onSaved={(d) =>
          setQuestion({
            ...question,
            ...d,
            answerSource: d.answerSource || null,
            fact: d.fact || null,
            factSource: d.factSource || null,
          })
        }
      />
    </m.div>
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

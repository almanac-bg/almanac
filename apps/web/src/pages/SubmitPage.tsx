import { api, errorMessage, plural, timeAgo, toast, useStore } from '@quiz/client';
import { categoryById, type QuestionDraft, SUBMISSION_RULES, type Submission } from '@quiz/shared';
import clsx from 'clsx';
import { Check, Lock, Pencil, Send, Trash2 } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { type FormEvent, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { GuestNudge } from '../components/ClaimAccount';
import { Emoji } from '../components/Emoji';
import { LoadError } from '../components/LoadError';
import { DraftEditor } from '../components/questions/DraftEditor';
import {
  cleanDraft,
  emptyDraft,
  hasErrors,
  SUBMISSION_STATUS,
  toDraft,
  validateDraft,
} from '../components/questions/draft';
import { QuestionPreview } from '../components/questions/QuestionPreview';
import { Button, Card, EmptyState, Modal, ProgressBar, SectionTitle, Spinner } from '../components/ui';
import { useLoad } from '../lib/load';
import { usePageTitle } from '../lib/title';

export function SubmitPage() {
  usePageTitle('Предложи въпрос');
  const me = useStore((s) => s.me)!;
  const unlocked = me.level >= SUBMISSION_RULES.minLevel;
  // Each question sent: "Моите предложения" below loads again.
  const [sent, setSent] = useState(0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="t-page">Предложи въпрос</h1>
        <p className="mt-1 max-w-2xl text-fg-2">
          Измисли въпрос за играта. Модератор го преглежда и ако бъде одобрен, влиза в мачовете с твоето име — плюс{' '}
          <b className="text-violet-300">{SUBMISSION_RULES.approvedXp} XP</b> и прогрес към постиженията „Първо перо“ и
          „Златно перо“.
        </p>
      </div>
      {me.isGuest ? (
        <GuestNudge>
          Въпросите влизат в играта с името на автора — запази профила си с име и парола, за да предлагаш.
        </GuestNudge>
      ) : unlocked ? (
        <SubmitForm onSent={() => setSent((n) => n + 1)} />
      ) : (
        <LockedCard level={me.level} />
      )}
      {unlocked && !me.isGuest && <MySubmissions refresh={sent} />}
    </div>
  );
}

function LockedCard({ level }: { level: number }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-tint/5">
        <Lock className="size-7 text-fg-3" />
      </span>
      <h2 className="t-card">Отключва се на ниво {SUBMISSION_RULES.minLevel}</h2>
      <p className="max-w-sm text-sm text-fg-2">
        Изиграй още няколко мача — нужни са ти още {plural(SUBMISSION_RULES.minLevel - level, 'ниво', 'нива')}, за да
        предлагаш въпроси.
      </p>
      <ProgressBar value={level / SUBMISSION_RULES.minLevel} className="mt-2 w-56" />
      <Link to="/" className="mt-3 text-sm font-semibold text-violet-300 hover:text-violet-200">
        Към играта →
      </Link>
    </Card>
  );
}

function SubmitForm({ onSent }: { onSent: () => void }) {
  // From „Моите въпроси“ („Предложи в общата банка“): that question, to pick its category and difficulty for.
  const proposed = (useLocation().state as { draft?: Partial<QuestionDraft> } | null)?.draft;
  const [draft, setDraft] = useState<QuestionDraft>(() => ({ ...emptyDraft(), ...proposed }));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = useMemo(() => validateDraft(draft), [draft]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (hasErrors(errors)) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      await api.submitQuestion(cleanDraft(draft));
      toast({ kind: 'success', title: 'Благодарим! Въпросът чака одобрение.', icon: '✍️' });
      setDraft(emptyDraft());
      setShowErrors(false);
      onSent();
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Неуспешно изпращане.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      <Card className="p-5 sm:p-6">
        <form onSubmit={submit} className="space-y-6">
          <DraftEditor draft={draft} onChange={setDraft} errors={showErrors ? errors : {}} />
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            <Send className="size-5" /> Изпрати за одобрение
          </Button>
        </form>
      </Card>
      <div className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-3 t-eyebrow text-fg-3">Преглед</p>
        <QuestionPreview draft={draft} />
        <p className="mt-4 text-xs text-fg-3">
          Съвет: един безспорно верен отговор и три правдоподобни грешни, от един вид (все градове, все години). Без
          въпроси, чийто отговор се променя с времето, и без думи във въпроса, които издават отговора.
        </p>
      </div>
    </div>
  );
}

/** How many may wait at once (as the server counts it): a few until one is approved, one at a time after many turned down. */
function pendingLimit(items: Submission[]) {
  const approved = items.filter((s) => s.status === 'approved').length;
  const rejected = items.filter((s) => s.status === 'rejected').length;
  if (rejected >= SUBMISSION_RULES.rejectedLimit && rejected > approved) return SUBMISSION_RULES.maxPendingRejected;
  return approved ? SUBMISSION_RULES.maxPending : SUBMISSION_RULES.maxPendingNew;
}

function MySubmissions({ refresh }: { refresh: number }) {
  const { data, error, retry, setData } = useLoad(() => api.mySubmissions(), '', refresh);
  const items: Submission[] | null = data?.submissions ?? null;
  const [editing, setEditing] = useState<Submission | null>(null);

  const approved = items?.filter((s) => s.status === 'approved').length ?? 0;
  const pending = items?.filter((s) => s.status === 'pending').length ?? 0;
  const limit = items ? pendingLimit(items) : 0;

  return (
    <section>
      <SectionTitle
        aside={
          items &&
          items.length > 0 && (
            <span className="text-sm text-fg-3">
              {plural(approved, 'одобрен', 'одобрени')} ·{' '}
              <span className={clsx(pending >= limit && 'text-amber-300')}>
                чакат {pending} от {limit}
              </span>
            </span>
          )
        }
      >
        Моите предложения
      </SectionTitle>
      {items && pending >= limit && (
        <p className="mb-3 text-sm text-fg-2">
          {limit === 1
            ? 'Един въпрос чака преглед. След него можеш да изпратиш следващия.'
            : `Стигна до ${limit} чакащи въпроса. Когато модератор ги прегледа, можеш да изпратиш още.`}{' '}
          {limit === SUBMISSION_RULES.maxPendingNew && 'След първия одобрен може да чакат повече наведнъж.'}
        </p>
      )}
      <EditSubmission
        submission={editing}
        onClose={() => setEditing(null)}
        onSaved={(changed) =>
          data && setData({ submissions: data.submissions.map((s) => (s.id === changed.id ? changed : s)) })
        }
        onWithdrawn={(id) => data && setData({ submissions: data.submissions.filter((s) => s.id !== id) })}
      />
      {error && !items ? (
        <LoadError title="Предложенията ти не се заредиха" error={error} onRetry={retry} />
      ) : !items ? (
        <div className="grid place-items-center py-12">
          <Spinner className="size-6 text-violet-400" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="✍️"
            title="Още нямаш предложения"
            body="Първият ти одобрен въпрос отключва постижението „Първо перо“."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          <AnimatePresence initial={false}>
            {items.map((s) => {
              const cat = categoryById(s.category)!;
              const status = SUBMISSION_STATUS[s.status];
              return (
                <m.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-wrap items-start gap-3 px-4 py-3.5 sm:flex-nowrap sm:px-5"
                >
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-xl bg-tint/5 text-xl"
                    title={cat.name}
                  >
                    <Emoji e={cat.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words">{s.q}</p>
                    <p className="mt-0.5 text-xs text-fg-3">
                      Верен: <span className="text-emerald-300">{s.options[s.answer]}</span> · {timeAgo(s.createdAt)}
                    </p>
                    {s.status === 'rejected' && s.reason && (
                      <p className="mt-1 text-xs text-rose-300">Причина: {s.reason}</p>
                    )}
                    {s.played && (
                      <p className="mt-1 text-xs text-fg-3">
                        {s.played.answered
                          ? `Изигран ${plural(s.played.answered, 'път', 'пъти')} · ${Math.round((100 * s.played.correct) / s.played.answered)}% верни`
                          : 'Още не е попаднал в мач'}
                      </p>
                    )}
                  </div>
                  <div className="flex w-full items-center justify-between gap-2 pl-13 sm:w-auto sm:shrink-0 sm:flex-col sm:items-end sm:pl-0">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.className}`}>
                      {status.label}
                    </span>
                    {s.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        <Pencil className="size-4" /> Промени
                      </Button>
                    )}
                  </div>
                </m.div>
              );
            })}
          </AnimatePresence>
        </Card>
      )}
    </section>
  );
}

/** A question still waiting, changed or taken back by its author. */
function EditSubmission({
  submission,
  onClose,
  onSaved,
  onWithdrawn,
}: {
  submission: Submission | null;
  onClose: () => void;
  onSaved: (s: Submission) => void;
  onWithdrawn: (id: number) => void;
}) {
  return (
    <Modal open={!!submission} onClose={onClose} title="Промени предложението" className="max-w-2xl">
      {submission && (
        <EditForm
          key={submission.id}
          submission={submission}
          onClose={onClose}
          onSaved={onSaved}
          onWithdrawn={onWithdrawn}
        />
      )}
    </Modal>
  );
}

function EditForm({
  submission,
  onClose,
  onSaved,
  onWithdrawn,
}: {
  submission: Submission;
  onClose: () => void;
  onSaved: (s: Submission) => void;
  onWithdrawn: (id: number) => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(submission));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<'save' | 'withdraw' | null>(null);
  const [sure, setSure] = useState(false);
  const errors = useMemo(() => validateDraft(draft), [draft]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (hasErrors(errors)) {
      setShowErrors(true);
      return;
    }
    setBusy('save');
    try {
      const { submission: saved } = await api.editSubmission(submission.id, cleanDraft(draft));
      toast({ kind: 'success', title: 'Промените са запазени.' });
      onSaved(saved);
      onClose();
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Промените не се запазиха.') });
      setBusy(null);
    }
  }

  async function withdraw() {
    if (!sure) {
      setSure(true);
      return;
    }
    setBusy('withdraw');
    try {
      await api.withdrawSubmission(submission.id);
      toast({ kind: 'info', title: 'Въпросът е оттеглен.' });
      onWithdrawn(submission.id);
      onClose();
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Въпросът не се оттегли.') });
      setBusy(null);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <DraftEditor draft={draft} onChange={setDraft} errors={showErrors ? errors : {}} compact />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-rose-300 hover:bg-rose-500/10"
          onClick={withdraw}
          loading={busy === 'withdraw'}
        >
          <Trash2 className="size-4" /> {sure ? 'Да, оттегли го' : 'Оттегли въпроса'}
        </Button>
        <Button type="submit" loading={busy === 'save'}>
          <Check className="size-4" /> Запази
        </Button>
      </div>
    </form>
  );
}

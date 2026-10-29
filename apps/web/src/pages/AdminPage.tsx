import { api, errorMessage, longDate, timeAgo, toast, useStore } from '@quiz/client';
import { MODERATION, type QuestionDraft, type Submission, type SubmissionStatus } from '@quiz/shared';
import { Check, Pencil, ShieldCheck, Undo2, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { Avatar, LevelBadge } from '../components/Avatar';
import { EditQuestionModal } from '../components/admin/EditQuestionModal';
import { LaunchStatsPanel } from '../components/admin/LaunchStatsPanel';
import { ModerationLogPanel } from '../components/admin/ModerationLog';
import { PlayCheckPanel } from '../components/admin/PlayCheckPanel';
import { PlayersPanel } from '../components/admin/PlayersPanel';
import { QuestionReportsQueue } from '../components/admin/QuestionReportsQueue';
import { ReportsQueue } from '../components/admin/ReportsQueue';
import { LoadError } from '../components/LoadError';
import { DraftEditor } from '../components/questions/DraftEditor';
import {
  cleanDraft,
  draftsEqual,
  hasErrors,
  SUBMISSION_STATUS,
  toDraft,
  validateDraft,
} from '../components/questions/draft';
import { QuestionPreview } from '../components/questions/QuestionPreview';
import { Button, Card, EmptyState, Segmented, Spinner } from '../components/ui';
import { useLoad } from '../lib/load';
import { usePageTitle } from '../lib/title';

type Section = 'questions' | 'flags' | 'reports' | 'players' | 'log' | 'play' | 'stats';
const SECTIONS: Section[] = ['questions', 'flags', 'reports', 'players', 'log', 'play', 'stats'];

export function AdminPage() {
  usePageTitle('Модерация');
  const me = useStore((s) => s.me)!;
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');
  const section: Section = SECTIONS.find((x) => x === tab) ?? 'questions';
  const [counts, setCounts] = useState<{
    pendingQuestions: number;
    openReports: number;
    questionReports: number;
  } | null>(null);

  useEffect(() => {
    if (me.isAdmin)
      api
        .adminSummary()
        .then(setCounts)
        .catch(() => {});
  }, [me.isAdmin]);

  if (!me.isAdmin) return <Navigate to="/" replace />;

  const badge = (n: number | undefined) => (n ? <span className="ml-1.5 text-amber-300">{n}</span> : null);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 t-eyebrow text-emerald-300">
            <ShieldCheck className="size-4" /> Модератор
          </p>
          <h1 className="mt-1 t-page">Модерация</h1>
        </div>
        <Segmented
          value={section}
          onChange={(v) => setParams(v === 'questions' ? {} : { tab: v }, { replace: true })}
          options={[
            { value: 'questions', label: <>Въпроси{badge(counts?.pendingQuestions)}</> },
            { value: 'flags', label: <>Сигнали{badge(counts?.questionReports)}</> },
            { value: 'reports', label: <>Доклади{badge(counts?.openReports)}</> },
            { value: 'players', label: 'Играчи' },
            { value: 'log', label: 'Дневник' },
            { value: 'play', label: 'Игра' },
            { value: 'stats', label: 'Статистика' },
          ]}
        />
      </div>
      {section === 'questions' && (
        <QuestionsQueue onPending={(n) => setCounts((c) => c && { ...c, pendingQuestions: n })} />
      )}
      {section === 'flags' && (
        <QuestionReportsQueue onOpen={(n) => setCounts((c) => c && { ...c, questionReports: n })} />
      )}
      {section === 'reports' && <ReportsQueue onOpen={(n) => setCounts((c) => c && { ...c, openReports: n })} />}
      {section === 'players' && <PlayersPanel />}
      {section === 'log' && <ModerationLogPanel />}
      {section === 'play' && <PlayCheckPanel />}
      {section === 'stats' && <LaunchStatsPanel />}
    </div>
  );
}

function QuestionsQueue({ onPending }: { onPending: (n: number) => void }) {
  const [status, setStatus] = useState<SubmissionStatus>('pending');
  const { data, error, retry, setData } = useLoad(() => api.adminSubmissions(status), status);
  const items: Submission[] | null = data?.submissions ?? null;
  const pending = data?.pending ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `onPending` is recreated on every parent render
  useEffect(() => {
    if (pending !== null) onPending(pending);
  }, [pending]);

  function reviewed(id: number, pendingNow: number) {
    if (data) setData({ ...data, submissions: data.submissions.filter((s) => s.id !== id), pending: pendingNow });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-fg-2">Въпроси, предложени от играчите. Одобрените влизат веднага в играта.</p>
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            {
              value: 'pending',
              label: <>Чакащи{pending ? <span className="ml-1.5 text-amber-300">{pending}</span> : null}</>,
            },
            { value: 'approved', label: 'Одобрени' },
            { value: 'rejected', label: 'Отхвърлени' },
          ]}
        />
      </div>

      {error && !items ? (
        <LoadError title="Въпросите не се заредиха" error={error} onRetry={retry} />
      ) : !items ? (
        <div className="grid place-items-center py-24">
          <Spinner className="size-8 text-violet-400" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={status === 'pending' ? '🎉' : '🗂️'}
            title={status === 'pending' ? 'Няма чакащи въпроси' : 'Тук още няма нищо'}
            body={status === 'pending' ? 'Всичко е прегледано. Браво!' : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <AnimatePresence initial={false}>
            {items.map((s) =>
              status === 'pending' ? (
                <PendingCard key={s.id} submission={s} onReviewed={reviewed} />
              ) : (
                <ReviewedCard key={s.id} submission={s} />
              ),
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function AuthorLine({ submission: s }: { submission: Submission }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar avatar={s.author.avatar} frame={s.author.frame} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="truncate font-semibold">{s.author.username}</span>
          <LevelBadge level={s.author.level} />
        </div>
        <div className="text-xs text-fg-3" title={longDate(s.createdAt)}>
          {timeAgo(s.createdAt)}
        </div>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${SUBMISSION_STATUS[s.status].className}`}>
        {SUBMISSION_STATUS[s.status].label}
      </span>
    </div>
  );
}

function PendingCard({
  submission,
  onReviewed,
}: {
  submission: Submission;
  onReviewed: (id: number, pending: number) => void;
}) {
  const original = useMemo(() => toDraft(submission), [submission]);
  const { data: similar } = useLoad(() => api.similarQuestions(submission.id), String(submission.id));
  const [draft, setDraft] = useState<QuestionDraft>(original);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const errors = useMemo(() => validateDraft(draft), [draft]);
  const edited = !draftsEqual(draft, original);

  async function approve() {
    if (edited && hasErrors(errors)) {
      setEditing(true);
      return;
    }
    setBusy('approve');
    try {
      const res = await api.approveSubmission(submission.id, edited ? cleanDraft(draft) : null);
      toast({
        kind: 'success',
        title: `Одобрен${edited ? ' (с редакция)' : ''} — ${submission.author.username} получава XP`,
      });
      onReviewed(submission.id, res.pending);
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e, 'Неуспешно одобрение.') });
      setBusy(null);
    }
  }

  async function reject() {
    setBusy('reject');
    try {
      const res = await api.rejectSubmission(submission.id, reason);
      toast({ kind: 'info', title: 'Въпросът е отхвърлен' });
      onReviewed(submission.id, res.pending);
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e, 'Неуспешно отхвърляне.') });
      setBusy(null);
    }
  }

  return (
    <m.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.25 } }}
    >
      <Card className="space-y-4 p-5">
        <AuthorLine submission={submission} />

        {editing ? (
          <DraftEditor draft={draft} onChange={setDraft} errors={errors} compact />
        ) : (
          <>
            <QuestionPreview draft={draft} compact />
            <Sources draft={draft} />
          </>
        )}

        {similar && similar.similar.length > 0 && (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-3 text-sm">
            <p className="font-semibold text-amber-200">Прилича на въпроси в играта</p>
            <ul className="mt-1.5 space-y-1 text-fg-2">
              {similar.similar.map((q) => (
                <li key={q.id}>
                  <code className="text-xs text-fg-3">{q.id}</code> {q.q} → <b>{q.answer}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        {rejecting ? (
          <div className="space-y-3 rounded-2xl border border-rose-400/30 bg-rose-500/[0.06] p-3">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={MODERATION.reasonMax}
              // biome-ignore lint/a11y/noAutofocus: it appears on clicking "Откажи", so focus moves to it
              autoFocus
              placeholder="Защо — авторът ще го прочете, за да напише следващия по-добре"
              aria-label="Причина за отказа"
              className="field h-10 w-full rounded-xl px-3 text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                Назад
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={reject}
                loading={busy === 'reject'}
                disabled={reason.trim().length < MODERATION.reasonMin}
              >
                <X className="size-4" /> Отхвърли
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {editing && edited && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(original)}>
                <Undo2 className="size-4" /> Върни оригинала
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setEditing(!editing)}>
              <Pencil className="size-4" /> {editing ? 'Преглед' : 'Редактирай'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(true)} disabled={busy !== null}>
              <X className="size-4" /> Откажи
            </Button>
            <Button size="sm" onClick={approve} loading={busy === 'approve'} disabled={edited && hasErrors(errors)}>
              <Check className="size-4" /> Одобри{edited ? ' с промените' : ''}
            </Button>
          </div>
        )}
      </Card>
    </m.div>
  );
}

/** Where the answer and the fact can be checked. */
function Sources({ draft }: { draft: QuestionDraft }) {
  if (!draft.answerSource && !draft.factSource) return null;
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
      {draft.answerSource ? (
        <a href={draft.answerSource} target="_blank" rel="noreferrer noopener" className="text-violet-300 underline">
          Източник на отговора
        </a>
      ) : (
        <span className="text-amber-300">Без източник на отговора</span>
      )}
      {draft.fact?.trim() && draft.factSource && (
        <a href={draft.factSource} target="_blank" rel="noreferrer noopener" className="text-violet-300 underline">
          Източник на факта
        </a>
      )}
    </p>
  );
}

function ReviewedCard({ submission }: { submission: Submission }) {
  const [s, setS] = useState(submission);
  const [editing, setEditing] = useState(false);
  return (
    <m.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="space-y-4 p-5">
        <AuthorLine submission={s} />
        <QuestionPreview draft={toDraft(s)} compact />
        <Sources draft={s} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-3">
          {s.reviewedAt && <span>Прегледан {timeAgo(s.reviewedAt)}</span>}
          {s.played && (
            <span>
              {s.played.answered
                ? `Изигран ${s.played.answered} пъти · ${Math.round((100 * s.played.correct) / s.played.answered)}% верни`
                : 'Още не е попаднал в мач'}
            </span>
          )}
          {s.status === 'rejected' && (
            <span className="text-rose-300">{s.reason ? `Причина: ${s.reason}` : 'Без посочена причина'}</span>
          )}
          {s.questionId && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Поправи
            </Button>
          )}
        </div>
      </Card>
      <EditQuestionModal
        questionId={editing ? s.questionId : null}
        draft={editing ? s : null}
        onClose={() => setEditing(false)}
        onSaved={(d) => setS({ ...s, ...d })}
      />
    </m.div>
  );
}

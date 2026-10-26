import { api, longDate, timeAgo, toast, useStore } from '@quiz/client';
import type { QuestionDraft, Submission, SubmissionStatus } from '@quiz/shared';
import { Check, Pencil, ShieldCheck, Undo2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { Avatar, LevelBadge } from '../components/Avatar';
import { LaunchStatsPanel } from '../components/admin/LaunchStatsPanel';
import { QuestionReportsQueue } from '../components/admin/QuestionReportsQueue';
import { ReportsQueue } from '../components/admin/ReportsQueue';
import { LoadError } from '../components/LoadError';
import { DraftEditor } from '../components/questions/DraftEditor';
import { cleanDraft, draftsEqual, hasErrors, SUBMISSION_STATUS, validateDraft } from '../components/questions/draft';
import { QuestionPreview } from '../components/questions/QuestionPreview';
import { Button, Card, EmptyState, Segmented, Spinner } from '../components/ui';
import { useLoad } from '../lib/load';
import { usePageTitle } from '../lib/title';

const toDraft = (s: Submission): QuestionDraft => ({
  category: s.category,
  difficulty: s.difficulty,
  q: s.q,
  options: [...s.options],
  answer: s.answer,
});

type Section = 'questions' | 'flags' | 'reports' | 'stats';

export function AdminPage() {
  usePageTitle('Модерация');
  const me = useStore((s) => s.me)!;
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');
  const section: Section = tab === 'reports' || tab === 'flags' || tab === 'stats' ? tab : 'questions';
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
      toast({ kind: 'error', title: e instanceof Error ? e.message : 'Неуспешно одобрение.' });
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
      toast({ kind: 'error', title: e instanceof Error ? e.message : 'Неуспешно отхвърляне.' });
      setBusy(null);
    }
  }

  return (
    <motion.div
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
          <QuestionPreview draft={draft} compact />
        )}

        {rejecting ? (
          <div className="space-y-3 rounded-2xl border border-rose-400/30 bg-rose-500/[0.06] p-3">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              // biome-ignore lint/a11y/noAutofocus: it appears on clicking "Откажи", so focus moves to it
              autoFocus
              placeholder="Причина (по желание) — авторът ще я види"
              className="h-10 w-full rounded-xl border border-line bg-black/30 px-3 text-sm outline-none placeholder:text-fg-3 focus:border-rose-400/60"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                Назад
              </Button>
              <Button size="sm" variant="danger" onClick={reject} loading={busy === 'reject'}>
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
    </motion.div>
  );
}

function ReviewedCard({ submission: s }: { submission: Submission }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="space-y-4 p-5">
        <AuthorLine submission={s} />
        <QuestionPreview draft={toDraft(s)} compact />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-3">
          {s.reviewedAt && <span>Прегледан {timeAgo(s.reviewedAt)}</span>}
          {s.status === 'rejected' && (
            <span className="text-rose-300">{s.reason ? `Причина: ${s.reason}` : 'Без посочена причина'}</span>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

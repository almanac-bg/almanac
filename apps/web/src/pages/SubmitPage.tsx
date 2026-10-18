import { categoryById, type QuestionDraft, type Submission, SUBMISSION_RULES } from '@quiz/shared';
import { Lock, Send } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { cleanDraft, emptyDraft, hasErrors, SUBMISSION_STATUS, validateDraft } from '../components/questions/draft';
import { DraftEditor } from '../components/questions/DraftEditor';
import { QuestionPreview } from '../components/questions/QuestionPreview';
import { Button, Card, EmptyState, ProgressBar, SectionTitle, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { toast, useStore } from '../lib/store';

export function SubmitPage() {
  const me = useStore((s) => s.me)!;
  const unlocked = me.level >= SUBMISSION_RULES.minLevel;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Предложи въпрос</h1>
        <p className="mt-1 max-w-2xl text-fg-2">
          Измисли въпрос за играта. Модератор го преглежда и ако бъде одобрен, влиза в мачовете с твоето име — плюс{' '}
          <b className="text-violet-300">+{SUBMISSION_RULES.approvedXp} XP</b> и прогрес към постиженията „Автор“.
        </p>
      </div>
      {unlocked ? <SubmitForm /> : <LockedCard level={me.level} />}
      {unlocked && <MySubmissions />}
    </div>
  );
}

function LockedCard({ level }: { level: number }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-white/5">
        <Lock className="size-7 text-fg-3" />
      </span>
      <h2 className="font-display text-xl font-bold">Отключва се на ниво {SUBMISSION_RULES.minLevel}</h2>
      <p className="max-w-sm text-sm text-fg-2">
        Изиграй още няколко мача — нужни са ти още {SUBMISSION_RULES.minLevel - level} нива, за да предлагаш въпроси.
      </p>
      <ProgressBar value={level / SUBMISSION_RULES.minLevel} className="mt-2 w-56" />
      <Link to="/" className="mt-3 text-sm font-semibold text-violet-300 hover:text-violet-200">
        Към игрите →
      </Link>
    </Card>
  );
}

function SubmitForm() {
  const [draft, setDraft] = useState<QuestionDraft>(emptyDraft);
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
      // Tells the "Моите предложения" list below to refresh.
      window.dispatchEvent(new CustomEvent('quiz:submitted'));
    } catch (err) {
      toast({ kind: 'error', title: err instanceof Error ? err.message : 'Неуспешно изпращане.' });
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
        <p className="mb-3 text-xs font-bold tracking-widest text-fg-3 uppercase">Преглед</p>
        <QuestionPreview draft={draft} />
        <p className="mt-4 text-xs text-fg-3">
          Съвет: един безспорно верен отговор и три правдоподобни грешни. Без въпроси, чийто отговор се променя с времето.
        </p>
      </div>
    </div>
  );
}

function MySubmissions() {
  const [items, setItems] = useState<Submission[] | null>(null);

  useEffect(() => {
    const load = () =>
      api
        .mySubmissions()
        .then((r) => setItems(r.submissions))
        .catch((e) => toast({ kind: 'error', title: e.message }));
    void load();
    window.addEventListener('quiz:submitted', load);
    return () => window.removeEventListener('quiz:submitted', load);
  }, []);

  const approved = items?.filter((s) => s.status === 'approved').length ?? 0;

  return (
    <section>
      <SectionTitle aside={items && items.length > 0 && <span className="text-sm text-fg-3">{approved} одобрени</span>}>
        Моите предложения
      </SectionTitle>
      {!items ? (
        <div className="grid place-items-center py-12">
          <Spinner className="size-6 text-violet-400" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon="✍️" title="Още нямаш предложения" body="Първият ти одобрен въпрос отключва постижението „Автор“." />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          <AnimatePresence initial={false}>
            {items.map((s) => {
              const cat = categoryById(s.category)!;
              const status = SUBMISSION_STATUS[s.status];
              return (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-wrap items-start gap-3 px-4 py-3.5 sm:flex-nowrap sm:px-5"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/5 text-xl" title={cat.name}>
                    {cat.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words">{s.q}</p>
                    <p className="mt-0.5 text-xs text-fg-3">
                      Верен: <span className="text-emerald-300">{s.options[s.answer]}</span> · {timeAgo(s.createdAt)}
                    </p>
                    {s.status === 'rejected' && s.reason && <p className="mt-1 text-xs text-rose-300">Причина: {s.reason}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </Card>
      )}
    </section>
  );
}

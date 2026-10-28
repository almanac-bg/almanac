import { api, errorMessage, timeAgo, toast } from '@quiz/client';
import type { PlayCheck } from '@quiz/shared';
import clsx from 'clsx';
import { Ban } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useLoad } from '../../lib/load';
import { Avatar, LevelBadge } from '../Avatar';
import { LoadError } from '../LoadError';
import { Button, Card, EmptyState, Spinner } from '../ui';
import { QuestionCard } from './QuestionReportsQueue';
import { BanForm } from './ReportsQueue';

const percent = (share: number) => `${Math.round(share * 100)}%`;
const seconds = (ms: number) => `${(ms / 1000).toLocaleString('bg-BG', { maximumFractionDigits: 1 })} с`;

const VERDICT: Record<PlayCheck['questions'][number]['verdict'], { label: string; className: string }> = {
  wrong: { label: 'Вероятно грешен отговор', className: 'bg-rose-500/15 text-rose-300' },
  harder: { label: 'По-труден, отколкото пише', className: 'bg-amber-400/15 text-amber-200' },
  easier: { label: 'По-лесен, отколкото пише', className: 'bg-sky-400/15 text-sky-200' },
};

/**
 * What the answer log says: play no person could manage (a script reading the answers off a copy of the bank), and
 * questions whose difficulty — or marked answer — the answers disagree with.
 */
export function PlayCheckPanel() {
  const { data, error, retry, setData } = useLoad(() => api.adminPlayCheck());
  if (error && !data) return <LoadError title="Проверката не се зареди" error={error} onRetry={retry} />;
  if (!data) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }
  const { rules } = data;
  const banned = (userId: number, until: number) =>
    setData({
      ...data,
      suspicious: data.suspicious.map((s) =>
        s.user.id === userId ? { ...s, user: { ...s.user, bannedUntil: until } } : s,
      ),
    });
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="t-section">Подозрителна игра</h2>
        <p className="text-fg-2">
          Поне {percent(rules.minAccuracy)} верни от поне {rules.minAnswers} средни и трудни въпроса, с половината под{' '}
          {seconds(rules.maxMedianMs)}: така играе програма, която чете отговорите от копие на банката. Силен играч
          греши понякога и има нужда да прочете. Виж профила, преди да решиш (отговорите се пазят {rules.logDays} дни).
        </p>
        {data.suspicious.length === 0 ? (
          <Card>
            <EmptyState icon="🧠" title="Никой не играе твърде съвършено" body="Засега всички изглеждат като хора." />
          </Card>
        ) : (
          data.suspicious.map((s) => <SuspectCard key={s.user.id} suspect={s} onBanned={banned} />)
        )}
      </section>

      <section className="space-y-4">
        <h2 className="t-section">Въпроси за проверка</h2>
        <p className="text-fg-2">
          Въпроси с поне {rules.questionMinAnswers} отговора, при които делът верни не съвпада с трудността. Вградените
          се поправят в <code>questions.json</code> по номера им.
        </p>
        {data.questions.length === 0 ? (
          <Card>
            <EmptyState icon="📊" title="Всичко е в рамките" body="Или още няма достатъчно отговори." />
          </Card>
        ) : (
          data.questions.map((q) => (
            <Card key={q.question.id} className="p-5">
              <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-bold', VERDICT[q.verdict].className)}>
                  {VERDICT[q.verdict].label}
                </span>
                <span className="text-fg-2">
                  {percent(q.correctShare)} верни от {q.answered}
                  {q.avgCorrectMs !== null && ` · верните средно за ${seconds(q.avgCorrectMs)}`}
                </span>
              </p>
              <QuestionCard question={q.question} />
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

function SuspectCard({
  suspect,
  onBanned,
}: {
  suspect: PlayCheck['suspicious'][number];
  onBanned: (userId: number, until: number) => void;
}) {
  const { user } = suspect;
  const [banning, setBanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const stopped = !!user.bannedUntil && user.bannedUntil > Date.now();
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar avatar={user.avatar} frame={user.frame} size={44} />
        <div className="min-w-0 flex-1">
          <Link
            to={`/profile/${encodeURIComponent(user.username)}`}
            className="flex items-center gap-1.5 font-semibold hover:underline"
          >
            {user.username} <LevelBadge level={user.level} />
          </Link>
          <p className="text-sm text-fg-2">
            {percent(suspect.accuracy)} верни от {suspect.answers} · половината под {seconds(suspect.medianCorrectMs)} ·{' '}
            {timeAgo(suspect.lastAt)}
          </p>
          {stopped && <p className="text-xs text-rose-300">Профилът е спрян в момента</p>}
        </div>
        {!banning && !stopped && (
          <Button
            size="sm"
            variant="ghost"
            className="text-rose-300 hover:bg-rose-500/10"
            onClick={() => setBanning(true)}
          >
            <Ban className="size-4" /> Спри профила
          </Button>
        )}
      </div>
      {banning && (
        <BanForm
          busy={busy}
          onCancel={() => setBanning(false)}
          onBan={async (decision, message) => {
            setBusy(true);
            try {
              await api.resolveReports(user.id, decision);
              toast({ kind: 'success', title: message });
              onBanned(
                user.id,
                decision.days === null ? Number.MAX_SAFE_INTEGER : Date.now() + decision.days * 86_400_000,
              );
              setBanning(false);
            } catch (e) {
              toast({ kind: 'error', title: errorMessage(e) });
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </Card>
  );
}

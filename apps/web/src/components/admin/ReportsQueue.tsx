import { api, errorMessage, timeAgo, toast } from '@quiz/client';
import { type ModerationAction, REPORT_REASONS, type ReportGroup } from '@quiz/shared';
import { Ban, Check, Flag, PenLine } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLoad } from '../../lib/load';
import { Avatar, LevelBadge } from '../Avatar';
import { LoadError } from '../LoadError';
import { Button, Card, EmptyState, Segmented, Spinner } from '../ui';

const reasonLabel = (id: string) => REPORT_REASONS.find((r) => r.id === id)?.label ?? id;

const BAN_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1 ден' },
  { value: '7', label: '7 дни' },
  { value: '30', label: '30 дни' },
  { value: 'forever', label: 'Завинаги' },
];

export function ReportsQueue({ onOpen }: { onOpen: (n: number) => void }) {
  const { data, error, retry, setData } = useLoad(() => api.adminReports());
  const groups: ReportGroup[] | null = data?.groups ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `onOpen` is recreated on every parent render
  useEffect(() => {
    if (groups) onOpen(groups.length);
  }, [groups]);

  function resolved(next: ReportGroup[]) {
    if (data) setData({ ...data, groups: next });
  }

  if (error && !groups) return <LoadError title="Докладите не се заредиха" error={error} onRetry={retry} />;
  if (!groups) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <Card>
        <EmptyState icon="🕊️" title="Няма отворени доклади" body="Общността се държи прилично." />
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-fg-2">Играчи, за които има доклади. Решението затваря всички доклади за играча.</p>
      <AnimatePresence initial={false}>
        {groups.map((g) => (
          <ReportCard key={g.target.id} group={g} onResolved={resolved} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ReportCard({ group, onResolved }: { group: ReportGroup; onResolved: (groups: ReportGroup[]) => void }) {
  const { target, reports } = group;
  const [mode, setMode] = useState<'idle' | 'rename' | 'ban'>('idle');
  const [name, setName] = useState('');
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide(decision: ModerationAction, message: string) {
    setBusy(true);
    try {
      const r = await api.resolveReports(target.id, decision);
      toast({ kind: 'success', title: message });
      onResolved(r.groups);
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}>
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar avatar={target.avatar} frame={target.frame} size={44} />
          <div className="min-w-0 flex-1">
            <Link
              to={`/profile/${encodeURIComponent(target.username)}`}
              className="flex items-center gap-1.5 font-semibold hover:underline"
            >
              {target.username} <LevelBadge level={target.level} />
            </Link>
            {target.bannedUntil && target.bannedUntil > Date.now() && (
              <p className="text-xs text-rose-300">Профилът е спрян в момента</p>
            )}
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-3 py-1 text-sm font-bold text-rose-300">
            <Flag className="size-3.5" /> {reports.length}
          </span>
        </div>

        <ul className="mt-4 space-y-2">
          {reports.map((r) => (
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

        {mode === 'rename' && (
          <form
            noValidate
            className="mt-4 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void decide({ action: 'rename', username: name }, `Името е сменено на „${name.trim()}“`);
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ново име"
              // biome-ignore lint/a11y/noAutofocus: it appears on clicking "Смени името", so focus moves to it
              autoFocus
              required
              className="field h-10 min-w-0 flex-1 rounded-xl px-3 text-sm"
            />
            <Button size="sm" type="submit" loading={busy}>
              Смени
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setMode('idle')}>
              Отказ
            </Button>
          </form>
        )}
        {mode === 'ban' && (
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void decide(
                { action: 'ban', days: days === 'forever' ? null : Number(days), reason },
                days === 'forever'
                  ? 'Профилът е спрян завинаги'
                  : `Профилът е спрян за ${BAN_OPTIONS.find((o) => o.value === days)!.label}`,
              );
            }}
          >
            <Segmented value={days} onChange={setDays} options={BAN_OPTIONS} />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина (играчът ще я види при вход)"
              maxLength={200}
              className="field h-10 w-full rounded-xl px-3 text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="danger" type="submit" loading={busy}>
                <Ban className="size-4" /> Спри профила
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setMode('idle')}>
                Отказ
              </Button>
            </div>
          </form>
        )}
        {mode === 'idle' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() => decide({ action: 'dismiss' }, 'Докладите са отхвърлени')}
            >
              <Check className="size-4" /> Няма нарушение
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setMode('rename')}>
              <PenLine className="size-4" /> Смени името
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-300 hover:bg-rose-500/10"
              onClick={() => setMode('ban')}
            >
              <Ban className="size-4" /> Спри профила
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  );
}

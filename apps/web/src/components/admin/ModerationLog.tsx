import { api, errorMessage, longDate, timeAgo, toast } from '@quiz/client';
import type { ModerationLogAction, ModerationLogEntry } from '@quiz/shared';
import clsx from 'clsx';
import { Undo2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { useLoad } from '../../lib/load';
import { LoadError } from '../LoadError';
import { Button, Card, EmptyState, Spinner } from '../ui';
import { basisLabel, type Grounds, GroundsFields, groundsReady } from './Decisions';

const ACTION: Record<ModerationLogAction, string> = {
  ban: 'спря профила на',
  unban: 'свали спирането на',
  ban_change: 'промени спирането на',
  rename: 'смени името на',
  annul: 'анулира резултатите на',
  dismiss_reports: 'отхвърли докладите за',
  hide_question: 'скри въпрос',
  auto_hide_question: 'скри въпрос по сигналите на играчите',
  unhide_question: 'върна в играта въпрос',
  fix_question: 'отбеляза като поправен въпрос',
  dismiss_flags: 'затвори сигналите за въпрос',
  edit_question: 'поправи въпрос',
  approve: 'одобри въпрос на',
  reject: 'отхвърли въпрос на',
  hide_set: 'скри набор',
  unhide_set: 'показа отново набор',
  rename_group: 'преименува група на',
  reload_bank: 'презареди банката с въпроси',
};

/**
 * One decision: who, what, about whom, on what basis and why; undone (and why), or a button to undo it — with a reason
 * the log keeps and the player reads.
 */
export function LogEntry({ entry, onUndone }: { entry: ModerationLogEntry; onUndone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grounds, setGrounds] = useState<Grounds>({ basis: 'other', reason: '' });

  async function undo(e: FormEvent) {
    e.preventDefault();
    if (!groundsReady(grounds)) return;
    setBusy(true);
    try {
      await api.undoModeration(entry.id, grounds.reason.trim());
      toast({ kind: 'success', title: 'Отменено' });
      onUndone();
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e, 'Не се отмени.') });
      setBusy(false);
    }
  }

  const basis = basisLabel(entry.basis);
  return (
    <li className={clsx('px-4 py-3 text-sm sm:px-5', entry.undoneAt && 'opacity-60')}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1">
          <b>{entry.admin ?? 'Играта'}</b> {ACTION[entry.action]}{' '}
          {entry.user && (
            <Link
              to={`/admin?tab=players&player=${entry.user.id}`}
              className="font-semibold text-violet-300 hover:underline"
            >
              {entry.user.username}
            </Link>
          )}
          {entry.target && (
            <>
              {' '}
              {entry.link ? (
                <Link to={entry.link} className="text-violet-300 hover:underline">
                  <code className="whitespace-nowrap">{entry.target}</code>
                </Link>
              ) : (
                <code className="whitespace-nowrap text-fg-2">{entry.target}</code>
              )}
            </>
          )}
          <span className="block text-xs text-fg-3" title={longDate(entry.createdAt)}>
            {timeAgo(entry.createdAt)}
            {entry.undoneAt && ` · отменено от ${entry.undoneBy ?? 'изтрит модератор'} ${timeAgo(entry.undoneAt)}`}
          </span>
        </p>
        {entry.canUndo && !asking && (
          <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
            <Undo2 className="size-4" /> Отмени
          </Button>
        )}
      </div>
      {(basis || entry.reason) && (
        <p className="mt-1 text-fg-2">
          {basis && <span className="font-semibold">{basis}. </span>}
          {entry.reason}
        </p>
      )}
      {entry.undoReason && <p className="mt-1 text-fg-3">Отменено, защото: {entry.undoReason}</p>}
      {asking && (
        <form onSubmit={undo} className="mt-3 space-y-3 rounded-2xl border border-line bg-sunk/20 p-4">
          <GroundsFields
            grounds={grounds}
            onChange={setGrounds}
            withBasis={false}
            reasonLabel="Защо го отменяш — дневникът го пази, а играчът го прочита"
          />
          <div className="flex gap-2">
            <Button size="sm" type="submit" loading={busy} disabled={!groundsReady(grounds)}>
              <Undo2 className="size-4" /> Отмени решението
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAsking(false)}>
              Отказ
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

/** Every decision, newest first, 50 at a time. */
export function ModerationLogPanel() {
  const [refresh, setRefresh] = useState(0);
  const { data, error, retry, setData } = useLoad(() => api.moderationLog(), '', refresh);
  const [more, setMore] = useState<'idle' | 'loading' | 'done'>('idle');
  const entries = data?.entries ?? null;

  async function loadMore() {
    if (!entries?.length) return;
    setMore('loading');
    try {
      const next = await api.moderationLog(entries.at(-1)!.id);
      setData({ entries: [...entries, ...next.entries] });
      setMore(next.entries.length < 50 ? 'done' : 'idle');
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
      setMore('idle');
    }
  }

  if (error && !entries) return <LoadError title="Дневникът не се зареди" error={error} onRetry={retry} />;
  if (!entries) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <Card>
        <EmptyState icon="📒" title="Още няма решения" body="Всяко решение на модератор се записва тук." />
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-fg-2">
        Всяко решение — с основанието и причината. „Отмени“ връща нещата както бяха преди него (спиране, име, резултати,
        скрит въпрос или набор, име на група, отхвърлени доклади) и иска причина, която играчът научава.
      </p>
      <Card className="p-0">
        <ul className="divide-y divide-line">
          {entries.map((e) => (
            <LogEntry key={e.id} entry={e} onUndone={() => setRefresh((n) => n + 1)} />
          ))}
        </ul>
      </Card>
      {entries.length >= 50 && more !== 'done' && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} loading={more === 'loading'}>
            Още
          </Button>
        </div>
      )}
    </div>
  );
}

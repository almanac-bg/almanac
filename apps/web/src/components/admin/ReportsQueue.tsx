import { ApiError, api, errorMessage, plural, timeAgo, toast } from '@quiz/client';
import {
  type CaseDecision,
  type ModerationBasis,
  REPORT_REASONS,
  type ReportCase,
  type ReportCases,
  type SetQuestion,
  setPictureUrl,
} from '@quiz/shared';
import clsx from 'clsx';
import { Ban, BookOpen, Check, EyeOff, Flag, IdCard, PenLine, ShieldAlert } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLoad } from '../../lib/load';
import { Avatar, LevelBadge } from '../Avatar';
import { LoadError } from '../LoadError';
import { Button, Card, EmptyState, Spinner } from '../ui';
import { BanForm, type Grounds, GroundsFields, groundsReady, RenameForm, SetVisibilityForm } from './Decisions';

const reasonLabel = (id: string) => REPORT_REASONS.find((r) => r.id === id)?.label ?? id;
const KIND = { player: 'Играч', group: 'Група', set: 'Набор' } as const;

/**
 * Reports, one case per reported thing (a player, a group, a set): every report about it, who sent each, and the
 * decisions that fit it. A decision answers the reports on screen, and their senders hear what came of it.
 */
export function ReportsQueue({ onOpen }: { onOpen: (n: number) => void }) {
  const { data, error, retry, setData } = useLoad(() => api.adminReports());

  // biome-ignore lint/correctness/useExhaustiveDependencies: `onOpen` is recreated on every parent render
  useEffect(() => {
    if (data) onOpen(data.total);
  }, [data]);

  if (error && !data) return <LoadError title="Докладите не се заредиха" error={error} onRetry={retry} />;
  if (!data) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }
  if (data.total === 0) {
    return (
      <Card>
        <EmptyState icon="🕊️" title="Няма отворени доклади" body="Общността се държи прилично." />
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-fg-2">
        Един случай за всеки докладван играч, група или набор: първо незаконното съдържание, после най-докладваните.
        Решението затваря докладите, които виждаш, и подателите им научават какво сте решили.
        {data.total > data.cases.length && ` Показани ${data.cases.length} от ${data.total}.`}
      </p>
      <AnimatePresence initial={false}>
        {data.cases.map((c) => (
          <CaseCard key={`${c.kind}:${c.id}`} item={c} onDecided={setData} onStale={retry} />
        ))}
      </AnimatePresence>
    </div>
  );
}

type Mode = 'idle' | 'rename' | 'ban' | 'rename_group' | 'hide_set';

function CaseCard({
  item,
  onDecided,
  onStale,
}: {
  item: ReportCase;
  onDecided: (next: ReportCases) => void;
  onStale: () => void;
}) {
  const { kind, owner, reports } = item;
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const illegal = reports.some((r) => r.reason === 'illegal');

  async function decide(decision: CaseDecision, message: string) {
    setBusy(true);
    try {
      const next = await api.decideCase(
        item,
        reports.map((r) => r.id),
        decision,
      );
      toast({ kind: 'success', title: message });
      onDecided(next);
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
      // Another moderator got there first: what's left of the case, as it is now.
      if (e instanceof ApiError && e.status === 409) onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <m.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40 }}
      aria-label={`${KIND[kind]} ${kind === 'player' ? owner.username : `„${item.name}“`}`}
    >
      <Card className={clsx('p-5', illegal && 'ring-2 ring-rose-400/60')}>
        <div className="flex flex-wrap items-center gap-3">
          <Avatar avatar={owner.avatar} frame={owner.frame} size={44} />
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-xs font-bold tracking-wide text-fg-3 uppercase">
              {KIND[kind]}
              {kind !== 'player' &&
                item.size !== null &&
                ` · ${kind === 'group' ? plural(item.size, 'член', 'членове') : plural(item.size, 'въпрос', 'въпроса')}`}
              {item.hidden && ' · скрит'}
            </p>
            {kind === 'player' ? (
              <Link
                to={`/profile/${encodeURIComponent(owner.username)}`}
                className="flex items-center gap-1.5 font-semibold hover:underline"
              >
                {owner.username} <LevelBadge level={owner.level} />
              </Link>
            ) : (
              <p className="font-semibold [overflow-wrap:anywhere]">
                „{item.name}“ <span className="font-normal text-fg-3">от {owner.username}</span>
              </p>
            )}
            {owner.bannedUntil && owner.bannedUntil > Date.now() && (
              <p className="text-xs text-rose-300">Профилът {kind === 'player' ? '' : 'на собственика '}е спрян</p>
            )}
          </div>
          <Link
            to={`/admin?tab=players&player=${owner.id}`}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-fg-2 hover:bg-tint/10 pointer-coarse:h-11"
          >
            <IdCard className="size-4" /> {kind === 'player' ? 'Подробно' : 'Собственикът'}
          </Link>
          {illegal && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/20 px-3 py-1 text-sm font-bold text-rose-200">
              <ShieldAlert className="size-3.5" /> Незаконно
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-3 py-1 text-sm font-bold text-rose-300">
            <Flag className="size-3.5" /> {reports.length}
          </span>
        </div>

        <ul className="mt-4 space-y-2">
          {reports.map((r) => (
            <li key={r.id} className="rounded-2xl border border-line bg-sunk/20 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={clsx('font-semibold', r.reason === 'illegal' && 'text-rose-300')}>
                  {reasonLabel(r.reason)}
                </span>
                <span className="text-xs text-fg-3">{timeAgo(r.createdAt)}</span>
              </div>
              {r.details && <p className="mt-1 text-fg-2">„{r.details}“</p>}
              <p className="mt-1 text-xs text-fg-3">
                {r.reporter ? (
                  <>
                    {r.reporter.name} · профил{' '}
                    {r.reporter.days ? `от ${plural(r.reporter.days, 'ден', 'дни')}` : 'от днес'},{' '}
                    {plural(r.reporter.matches, 'мач', 'мача')} · предишни доклади: {r.reporter.upheld} уважени,{' '}
                    {r.reporter.dismissed} без нарушение
                  </>
                ) : (
                  'изтрит профил'
                )}
              </p>
            </li>
          ))}
        </ul>

        {kind === 'set' && (
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={() => setReading(!reading)} aria-expanded={reading}>
              <BookOpen className="size-4" /> {reading ? 'Скрий въпросите' : 'Прочети набора'}
            </Button>
            {reading && <SetReader code={item.id} />}
          </div>
        )}

        {mode === 'rename' && (
          <RenameForm
            busy={busy}
            onCancel={() => setMode('idle')}
            onRename={(rename) =>
              void decide({ action: 'rename', ...rename }, `Името е сменено на „${rename.username}“`)
            }
          />
        )}
        {mode === 'ban' && (
          <BanForm
            busy={busy}
            defaultBasis={reports.some((r) => r.reason === 'cheating') ? 'cheating' : ''}
            onBan={(ban, message) => void decide({ action: 'ban', ...ban }, message)}
            onCancel={() => setMode('idle')}
          />
        )}
        {mode === 'rename_group' && (
          <GroupRenameForm
            id={item.id}
            busy={busy}
            onCancel={() => setMode('idle')}
            onRename={(g) => void decide({ action: 'rename_group', ...g }, 'Групата е преименувана')}
          />
        )}
        {mode === 'hide_set' && (
          <SetVisibilityForm
            hidden={false}
            busy={busy}
            onCancel={() => setMode('idle')}
            onSubmit={(g) =>
              void decide(
                { action: 'hide_set', basis: g.basis as ModerationBasis, reason: g.reason },
                'Наборът е скрит',
              )
            }
          />
        )}
        {mode === 'idle' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() => decide({ action: 'dismiss' }, 'Без нарушение: докладите са затворени')}
            >
              <Check className="size-4" /> Няма нарушение
            </Button>
            {kind === 'player' && (
              <>
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
              </>
            )}
            {kind === 'group' && (
              <Button size="sm" variant="secondary" onClick={() => setMode('rename_group')}>
                <PenLine className="size-4" /> Преименувай групата
              </Button>
            )}
            {kind === 'set' && !item.hidden && (
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-300 hover:bg-rose-500/10"
                onClick={() => setMode('hide_set')}
              >
                <EyeOff className="size-4" /> Скрий набора
              </Button>
            )}
          </div>
        )}
      </Card>
    </m.article>
  );
}

/** A group's name broke the rules: it becomes „Група N“ for a week at least. */
function GroupRenameForm({
  id,
  busy,
  onRename,
  onCancel,
}: {
  id: string;
  busy: boolean;
  onRename: (grounds: { basis: ModerationBasis; reason: string }) => void;
  onCancel: () => void;
}) {
  const [grounds, setGrounds] = useState<Grounds>({ basis: 'name', reason: '' });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (groundsReady(grounds)) onRename({ basis: grounds.basis as ModerationBasis, reason: grounds.reason.trim() });
  }
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-2xl border border-line bg-sunk/20 p-4">
      <p className="text-xs text-fg-3">
        Името става „Група {id}“ поне за седмица; собственикът научава основанието и причината.
      </p>
      <GroundsFields grounds={grounds} onChange={setGrounds} />
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={busy} disabled={!groundsReady(grounds)}>
          <PenLine className="size-4" /> Преименувай
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Отказ
        </Button>
      </div>
    </form>
  );
}

/** A reported set, read in full: every question, its answer and its picture (a report is judged on what's in it). */
function SetReader({ code }: { code: string }) {
  const { data, error, retry } = useLoad(() => api.adminSet(code), code);
  if (error) return <LoadError title="Наборът не се зареди" error={error} onRetry={retry} />;
  if (!data) return <Spinner className="mt-3 size-6 text-violet-400" />;
  return (
    <ol className="mt-3 space-y-3">
      {data.set.questions.map((q, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a set's questions in their order, read-only
        <li key={i} className="rounded-2xl border border-line p-3 text-sm">
          <p className="font-semibold">
            {i + 1}. {q.q}
          </p>
          {'image' in q && q.image && (
            <img
              src={setPictureUrl(q.image.id)}
              alt={q.image.alt}
              width={q.image.w}
              height={q.image.h}
              loading="lazy"
              className="mt-2 max-h-48 w-auto rounded-xl"
            />
          )}
          <p className="mt-1 text-fg-2">{answerOf(q)}</p>
        </li>
      ))}
    </ol>
  );
}

function answerOf(q: SetQuestion): string {
  switch (q.kind) {
    case 'choice':
      return q.options.map((o, i) => (i === q.answer ? `✓ ${o}` : o)).join(' · ');
    case 'truefalse':
      return q.answer ? '✓ Вярно' : '✓ Невярно';
    case 'number':
      return `✓ ${q.number.answer} ${q.number.unit}`.trim();
    case 'order':
      return q.items.map((it) => it.text).join(' → ');
  }
}

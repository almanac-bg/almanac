import { api, errorMessage, longDate, timeAgo, toast } from '@quiz/client';
import type { ModerationBasis, PlayerCard, PlayerSearchHit } from '@quiz/shared';
import { Ban, Check, Eye, EyeOff, PenLine, Search, Trash2, Unlock } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLoad } from '../../lib/load';
import { Avatar, LevelBadge } from '../Avatar';
import { LoadError } from '../LoadError';
import { Button, Card, EmptyState, Segmented, Spinner } from '../ui';
import {
  BanForm,
  basisLabel,
  type Grounds,
  GroundsFields,
  groundsReady,
  RenameForm,
  SetVisibilityForm,
} from './Decisions';
import { LogEntry } from './ModerationLog';

/** A player found by name, and everything a moderator does about them in one card. */
export function PlayersPanel() {
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get('player')) || null;
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [hits, setHits] = useState<PlayerSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function search(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      setHits((await api.adminPlayers(q)).players);
      setParams({ tab: 'players', q }, { replace: true });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setSearching(false);
    }
  }

  // A search in the address (back from a card) runs again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on opening the tab
  useEffect(() => {
    if (!selected && query.trim().length >= 2) void search();
  }, []);

  const open = (id: number) => setParams({ tab: 'players', player: String(id), ...(query && { q: query }) });

  return (
    <div className="space-y-5">
      <form onSubmit={search} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Име, #номер или точен имейл"
          aria-label="Търси играч"
          className="field h-11 min-w-0 flex-1 rounded-2xl px-4 text-sm"
        />
        <Button type="submit" loading={searching} disabled={query.trim().length < 2}>
          <Search className="size-4" /> Търси
        </Button>
      </form>

      {selected ? (
        <PlayerCardView id={selected} onBack={() => setParams({ tab: 'players', ...(query && { q: query }) })} />
      ) : hits === null ? (
        <p className="text-fg-2">Търси по име, за да видиш историята на играча и да решиш.</p>
      ) : hits.length === 0 ? (
        <Card>
          <EmptyState icon="🔎" title="Няма такъв играч" />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {hits.map((h) => (
              <li key={h.user.id}>
                <button
                  type="button"
                  onClick={() => open(h.user.id)}
                  className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-tint/5 sm:px-5"
                >
                  <Avatar avatar={h.user.avatar} frame={h.user.frame} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <span className="truncate">{h.user.username}</span> <LevelBadge level={h.user.level} />
                    </span>
                    <span className="text-xs text-fg-3">
                      {h.isGuest ? 'Гост' : 'Профил'} от {longDate(h.createdAt)}
                    </span>
                  </span>
                  {h.banned && (
                    <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-300">
                      Спрян
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type Mode = 'idle' | 'ban' | 'change' | 'rename' | 'annul';

function PlayerCardView({ id, onBack }: { id: number; onBack: () => void }) {
  const { data, error, retry, setData } = useLoad(() => api.adminPlayer(id), String(id));
  const card = data?.card ?? null;
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);

  async function act(run: () => Promise<{ card: PlayerCard }>, message: string) {
    setBusy(true);
    try {
      setData(await run());
      toast({ kind: 'success', title: message });
      setMode('idle');
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  if (error && !card) return <LoadError title="Играчът не се зареди" error={error} onRetry={retry} />;
  if (!card) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }
  const { user, ban } = card;
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="focus-ring rounded-lg text-sm font-semibold text-violet-300">
        ← Към търсенето
      </button>
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar avatar={user.avatar} frame={user.frame} size={52} />
          <div className="min-w-0 flex-1">
            <Link
              to={`/profile/${encodeURIComponent(user.username)}`}
              className="flex items-center gap-1.5 text-lg font-bold hover:underline"
            >
              {user.username} <LevelBadge level={user.level} />
            </Link>
            <p className="text-xs text-fg-3">
              {user.isGuest ? 'Гост' : 'Профил'} от {longDate(user.createdAt)}
              {user.lastSeenAt && ` · последно ${timeAgo(user.lastSeenAt)}`} · {card.gamesPlayed} мача ·{' '}
              {user.hasEmail ? 'с имейл' : 'без имейл'}
            </p>
            {card.staff && (
              <p className="mt-1 text-xs font-semibold text-emerald-300">
                {card.staff === 'owner' ? 'Собственик' : 'Модератор'} — решенията за този профил са на собственика
              </p>
            )}
          </div>
        </div>

        {ban && (
          <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/[0.07] px-4 py-3 text-sm">
            <p className="font-semibold text-rose-200">
              Спрян {ban.until >= 8e15 ? 'завинаги' : `до ${longDate(ban.until)}`}
            </p>
            {(ban.basis || ban.reason) && (
              <p className="mt-1 text-fg-2">
                {ban.basis && <span className="font-semibold">{basisLabel(ban.basis)}. </span>}
                {ban.reason}
              </p>
            )}
          </div>
        )}

        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <Stat label="Доклади за играча">
            {card.reports.open} отворени · {card.reports.resolved} решени
          </Stat>
          <Stat label="Доклади от играча">{card.reports.filed}</Stat>
          <Stat label="Предложени въпроси">
            {card.submissions.approved} одобрени · {card.submissions.rejected} отхвърлени · {card.submissions.pending}{' '}
            чакат
          </Stat>
        </dl>

        {mode === 'ban' && (
          <BanForm
            busy={busy}
            onCancel={() => setMode('idle')}
            onBan={(b, message) => void act(() => api.banPlayer(id, b), message)}
          />
        )}
        {mode === 'change' && (
          <ChangeBanForm
            busy={busy}
            onCancel={() => setMode('idle')}
            onChange={(days, reason) =>
              void act(
                () => api.changeBan(id, days, reason),
                days === null ? 'Спирането е свалено' : `Спирането вече е за ${days} дни от днес`,
              )
            }
          />
        )}
        {mode === 'rename' && (
          <RenameForm
            busy={busy}
            onCancel={() => setMode('idle')}
            onRename={(r) => void act(() => api.renamePlayer(id, r), `Името е сменено на „${r.username}“`)}
          />
        )}
        {mode === 'annul' && (
          <ReasonForm
            busy={busy}
            action="Анулирай резултатите"
            hint="Рейтингите от този сезон, дневните и вечерните класирания отпадат. Играчът научава основанието и причината. Може да се отмени от „Дневник“."
            onCancel={() => setMode('idle')}
            onSubmit={(grounds) => void act(() => api.annulResults(id, grounds), 'Резултатите са анулирани')}
          />
        )}
        {mode === 'idle' && (
          <div className="mt-4 flex flex-wrap gap-2">
            {card.reports.open > 0 && (
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={() => act(() => api.dismissPlayerReports(id), 'Докладите са отхвърлени')}
              >
                <Check className="size-4" /> Няма нарушение
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setMode('rename')}>
              <PenLine className="size-4" /> Смени името
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setMode('annul')}>
              <Trash2 className="size-4" /> Анулирай резултати
            </Button>
            {ban ? (
              <Button size="sm" variant="secondary" onClick={() => setMode('change')}>
                <Unlock className="size-4" /> Свали или скъси спирането
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-300 hover:bg-rose-500/10"
                onClick={() => setMode('ban')}
              >
                <Ban className="size-4" /> Спри профила
              </Button>
            )}
          </div>
        )}
      </Card>

      {card.groups.length > 0 && (
        <Section title="Групи на играча">
          {card.groups.map((g) => (
            <GroupRow key={g.id} group={g} onRenamed={retry} />
          ))}
        </Section>
      )}
      {card.sets.length > 0 && (
        <Section title="Набори на играча">
          {card.sets.map((s) => (
            <SetRow key={s.code} set={s} onChanged={retry} />
          ))}
        </Section>
      )}
      <Section title="Решения за играча">
        {card.log.length === 0 ? (
          <li className="px-4 py-3 text-sm text-fg-3 sm:px-5">Още няма.</li>
        ) : (
          card.log.map((e) => <LogEntry key={e.id} entry={e} onUndone={retry} />)
        )}
      </Section>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-tint/5 px-3 py-2">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 t-card">{title}</h2>
      <Card className="p-0">
        <ul className="divide-y divide-line">{children}</ul>
      </Card>
    </section>
  );
}

const CHANGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'lift', label: 'Свали сега' },
  { value: '1', label: '1 ден' },
  { value: '7', label: '7 дни' },
  { value: '30', label: '30 дни' },
];

function ChangeBanForm({
  busy,
  onChange,
  onCancel,
}: {
  busy: boolean;
  onChange: (days: number | null, reason: string) => void;
  onCancel: () => void;
}) {
  const [days, setDays] = useState('lift');
  const [grounds, setGrounds] = useState<Grounds>({ basis: 'other', reason: '' });
  return (
    <form
      className="mt-4 space-y-3 rounded-2xl border border-line bg-sunk/20 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (groundsReady(grounds)) onChange(days === 'lift' ? null : Number(days), grounds.reason.trim());
      }}
    >
      <Segmented value={days} onChange={setDays} options={CHANGE_OPTIONS} />
      <p className="text-xs text-fg-3">{days === 'lift' ? '' : 'Новият край се брои от днес.'}</p>
      <GroundsFields grounds={grounds} onChange={setGrounds} withBasis={false} reasonLabel="Защо (за дневника)" />
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={busy} disabled={!groundsReady(grounds)}>
          <Unlock className="size-4" /> {days === 'lift' ? 'Свали спирането' : 'Промени'}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Отказ
        </Button>
      </div>
    </form>
  );
}

/** A decision with only its grounds to give (annulling results). */
function ReasonForm({
  busy,
  action,
  hint,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  action: string;
  hint: string;
  onSubmit: (grounds: { basis: ModerationBasis; reason: string }) => void;
  onCancel: () => void;
}) {
  const [grounds, setGrounds] = useState<Grounds>({ basis: 'cheating', reason: '' });
  return (
    <form
      className="mt-4 space-y-3 rounded-2xl border border-line bg-sunk/20 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (groundsReady(grounds)) onSubmit({ basis: grounds.basis as ModerationBasis, reason: grounds.reason.trim() });
      }}
    >
      <p className="text-sm text-fg-2">{hint}</p>
      <GroundsFields grounds={grounds} onChange={setGrounds} />
      <div className="flex gap-2">
        <Button size="sm" variant="danger" type="submit" loading={busy} disabled={!groundsReady(grounds)}>
          {action}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Отказ
        </Button>
      </div>
    </form>
  );
}

function GroupRow({ group, onRenamed }: { group: PlayerCard['groups'][number]; onRenamed: () => void }) {
  const [open, setOpen] = useState(false);
  const [grounds, setGrounds] = useState<Grounds>({ basis: 'name', reason: '' });
  const [busy, setBusy] = useState(false);

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!groundsReady(grounds)) return;
    setBusy(true);
    try {
      await api.renameGroupByModerator(group.id, grounds.basis as ModerationBasis, grounds.reason.trim());
      toast({ kind: 'success', title: `Групата вече е „Група ${group.id}“` });
      setOpen(false);
      onRenamed();
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-4 py-3 text-sm sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <b>{group.name}</b>{' '}
          <span className="text-fg-3">
            №{group.id} · {group.members} членове
          </span>
        </span>
        {!open && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            <PenLine className="size-4" /> Преименувай
          </Button>
        )}
      </div>
      {open && (
        <form onSubmit={rename} className="mt-3 space-y-3">
          <p className="text-xs text-fg-3">
            Името става „Група {group.id}“ поне за седмица; собственикът научава основанието и причината.
          </p>
          <GroundsFields grounds={grounds} onChange={setGrounds} />
          <div className="flex gap-2">
            <Button size="sm" type="submit" loading={busy} disabled={!groundsReady(grounds)}>
              Преименувай
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
              Отказ
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function SetRow({ set, onChanged }: { set: PlayerCard['sets'][number]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(grounds: { basis?: ModerationBasis; reason: string; copies?: boolean }) {
    setBusy(true);
    try {
      await api.hideSet(set.code, !set.hidden, grounds);
      toast({ kind: 'success', title: set.hidden ? 'Наборът отново се споделя' : 'Наборът е скрит' });
      setOpen(false);
      onChanged();
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="px-4 py-3 text-sm sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/sets/shared/${set.code}`} className="min-w-0 flex-1 font-semibold hover:underline">
          {set.name}
        </Link>
        {set.hidden && <span className="text-xs font-bold text-amber-300">Скрит</span>}
        {!open && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            {set.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />} {set.hidden ? 'Покажи' : 'Скрий'}
          </Button>
        )}
      </div>
      {open && (
        <SetVisibilityForm
          hidden={set.hidden}
          busy={busy}
          onSubmit={(g) => void submit(g)}
          onCancel={() => setOpen(false)}
        />
      )}
    </li>
  );
}

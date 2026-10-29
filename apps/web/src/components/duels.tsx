import { actions, api, fmt, toast, useNow, useStore } from '@quiz/client';
import {
  CATEGORIES,
  type CategoryId,
  type DuelEntry,
  type DuelRecord,
  type DuelStanding,
  MODES,
  type PublicUser,
  ROUNDS,
} from '@quiz/shared';
import clsx from 'clsx';
import { RotateCcw, Swords } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { useLoad } from '../lib/load';
import { Avatar } from './Avatar';
import { Emoji } from './Emoji';
import { PlayerName } from './FitName';
import { Button, Modal } from './ui';

/** "остават 21 ч.", "остават 35 мин.": how long the second of a duel has to play it. */
export function timeLeft(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'времето изтече';
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `остават ${hours} ч.` : `остават ${Math.max(1, Math.ceil(ms / 60_000))} мин.`;
}

/** The two of them so far, you first: "3 : 2" (and the draws, if any). */
export function recordLine(record: DuelRecord): string {
  return `${record.wins} : ${record.losses}${record.draws ? ` · ${record.draws} равни` : ''}`;
}

/** Your friend duels, reloaded when news comes in (a friend played, a note arrived). */
export function useDuels(enabled = true) {
  const friendsVersion = useStore((s) => s.friendsVersion);
  const unread = useStore((s) => s.me?.unreadNotifications ?? 0);
  return useLoad(
    () => (enabled ? api.duels() : Promise.resolve({ duels: [] as DuelEntry[] })),
    enabled ? 'duels' : 'off',
    `${friendsVersion}:${unread}`,
  );
}

/** Starts a duel with a friend: you play it now (the match opens by itself), they within a day. */
export function DuelButton({
  friend,
  categories,
  children,
  ...props
}: {
  friend: PublicUser;
  categories?: CategoryId[];
  children?: ReactNode;
} & Omit<Parameters<typeof Button>[0], 'onClick' | 'children'>) {
  const [busy, setBusy] = useState(false);
  const inGame = useStore((s) => !!s.game && s.game.phase !== 'ended');
  async function start() {
    setBusy(true);
    const res = await actions.startDuel(friend.id, categories);
    setBusy(false);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  }
  return (
    <Button {...props} onClick={start} loading={busy} disabled={props.disabled || inGame}>
      {children ?? (
        <>
          <Swords className="size-4" /> Дуел
        </>
      )}
    </Button>
  );
}

/**
 * The next duel with the same friend. Whoever lost the last one picks its categories (one a round, in order); the
 * winner's is drawn.
 */
export function RematchButton({
  standing,
  ...props
}: { standing: DuelStanding } & Omit<Parameters<typeof Button>[0], 'onClick' | 'children'>) {
  const [picking, setPicking] = useState(false);
  if (!standing.canPick) {
    return (
      <DuelButton friend={standing.friend} {...props}>
        <RotateCcw className="size-4" /> Реванш
      </DuelButton>
    );
  }
  return (
    <>
      <Button {...props} onClick={() => setPicking(true)}>
        <RotateCcw className="size-4" /> Реванш
      </Button>
      <RematchPicker friend={standing.friend} open={picking} onClose={() => setPicking(false)} />
    </>
  );
}

/** Lost the last duel: pick the rematch's three categories, one a round, in order (tap again to take one back). */
function RematchPicker({ friend, open, onClose }: { friend: PublicUser; open: boolean; onClose: () => void }) {
  const [picked, setPicked] = useState<CategoryId[]>([]);
  const toggle = (id: CategoryId) =>
    setPicked((p) => (p.includes(id) ? p.filter((c) => c !== id) : p.length < ROUNDS.count ? [...p, id] : p));
  return (
    <Modal open={open} onClose={onClose} title="Избери категориите">
      <p className="text-sm text-fg-2">
        Последния дуел го загуби, затова реваншът е на твоя терен: по една категория за всеки от трите рунда, по ред.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {CATEGORIES.map((c) => {
          const at = picked.indexOf(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              aria-pressed={at >= 0}
              className={clsx(
                'focus-ring relative flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors',
                at >= 0 ? 'border-violet-400/70 bg-violet-500/15' : 'border-line bg-tint/[0.04] hover:bg-tint/[0.08]',
              )}
            >
              <Emoji e={c.icon} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {at >= 0 && (
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#7c3aed] text-xs font-bold text-white">
                  {at + 1}
                  <span className="sr-only">-ви рунд</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Отказ
        </Button>
        <DuelButton friend={friend} categories={picked} disabled={picked.length !== ROUNDS.count}>
          <Swords className="size-4" /> Играй ({picked.length}/{ROUNDS.count})
        </DuelButton>
      </div>
    </Modal>
  );
}

const OUTCOME = { won: 'Победа', lost: 'Загуба', draw: 'Равенство' } as const;

/**
 * A duel head to head, for one of its two: both scores (or whose turn it is), how it ended, and the two of them so
 * far; then what's next — playing it, or a rematch.
 */
export function DuelCard({
  standing,
  me,
  canPlay,
  onPlay,
  playing,
  actions = true,
  className,
}: {
  standing: DuelStanding;
  me: Pick<PublicUser, 'avatar' | 'frame' | 'username'>;
  /** Not played yet by you, and still open. */
  canPlay?: boolean;
  onPlay?: () => void;
  playing?: boolean;
  /** Its play or rematch button (the results keep theirs in the bar at the bottom). */
  actions?: boolean;
  className?: string;
}) {
  const now = useNow(60_000);
  const { friend, mine, theirs, outcome, record, expired } = standing;
  const status = outcome
    ? OUTCOME[outcome]
    : expired
      ? mine
        ? `${friend.username} не го изигра навреме`
        : 'Времето изтече'
      : mine
        ? `Чакаме ${friend.username} · ${timeLeft(standing.expiresAt, now)}`
        : `Твой ред · ${timeLeft(standing.expiresAt, now)}`;
  const side = (who: Pick<PublicUser, 'avatar' | 'frame' | 'username'>, run: DuelStanding['mine'], you: boolean) => (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <Avatar avatar={who.avatar} frame={who.frame} size={64} />
      <span className={clsx('max-w-full truncate text-sm font-semibold', you && 'text-violet-300')}>
        {you ? 'Ти' : who.username}
      </span>
      <span className="font-display text-2xl font-black tabular-nums">{run ? fmt(run.score) : '—'}</span>
      {run && (
        <span className="text-xs text-fg-3">
          {run.correct} от {MODES.challenge.questions} верни
        </span>
      )}
    </div>
  );
  return (
    <section className={clsx('glass rounded-3xl p-5 sm:p-6', className)} aria-label={`Дуел с ${friend.username}`}>
      <p
        className={clsx(
          'text-center text-sm font-bold',
          outcome === 'won' ? 'text-amber-300' : outcome === 'lost' ? 'text-rose-300' : 'text-fg-2',
        )}
      >
        {status}
      </p>
      <div className="mt-4 flex items-start gap-3">
        {side(me, mine, true)}
        <span className="mt-6 shrink-0 font-display text-xl font-black text-fuchsia-400 italic">VS</span>
        <Link
          to={`/profile/${encodeURIComponent(friend.username)}`}
          className="focus-ring flex min-w-0 flex-1 rounded-2xl"
        >
          {side(friend, theirs, false)}
        </Link>
      </div>
      <p className="mt-4 text-center text-sm text-fg-3">
        Дуели помежду ви: <b className="text-fg tabular-nums">{recordLine(record)}</b>
      </p>
      {actions && (canPlay || outcome || expired) && (
        <div className="mt-4 flex justify-center">
          {canPlay && !expired ? (
            <Button onClick={onPlay} loading={playing}>
              <Swords className="size-4" /> Играй дуела
            </Button>
          ) : (
            <RematchButton standing={standing} />
          )}
        </div>
      )}
    </section>
  );
}

/** One duel in a list: who, whose turn or how it ended, and the way to play it. */
export function DuelRow({ duel, onPlay, playing }: { duel: DuelEntry; onPlay: () => void; playing: boolean }) {
  const now = useNow(60_000);
  const { friend } = duel;
  const line =
    duel.state === 'yours'
      ? `${duel.theirs ? `${fmt(duel.theirs.score)} т. за биене` : 'Ти започваш'} · ${timeLeft(duel.expiresAt, now)}`
      : duel.state === 'theirs'
        ? `Чакаме — ${timeLeft(duel.expiresAt, now)}`
        : duel.state === 'expired'
          ? duel.mine
            ? 'Не го изигра навреме'
            : 'Времето изтече'
          : `${OUTCOME[duel.outcome!]} · ${fmt(duel.mine!.score)} : ${fmt(duel.theirs!.score)}`;
  return (
    <div className="flex items-center gap-3 py-2">
      <Link
        to={`/c/${duel.id}`}
        className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl"
        aria-label={`Дуел с ${friend.username}: ${line}`}
      >
        <Avatar avatar={friend.avatar} frame={friend.frame} size={36} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <PlayerName name={friend.username} />
            {duel.state === 'yours' && (
              <span className="shrink-0 rounded-full bg-amber-400/20 px-2 py-px text-xs font-bold text-amber-200">
                Твой ред
              </span>
            )}
          </span>
          <span
            className={clsx(
              'block truncate text-xs',
              duel.outcome === 'won' ? 'text-amber-300' : duel.outcome === 'lost' ? 'text-rose-300' : 'text-fg-3',
            )}
          >
            {line}
          </span>
        </span>
      </Link>
      {duel.state === 'yours' && (
        <Button size="sm" onClick={onPlay} loading={playing}>
          Играй
        </Button>
      )}
    </div>
  );
}

/** Plays a duel that's waiting for you (the match opens by itself). */
export function usePlayDuel() {
  const [playing, setPlaying] = useState<string | null>(null);
  async function play(id: string) {
    setPlaying(id);
    const res = await actions.startChallenge(id);
    setPlaying(null);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  }
  return { playing, play };
}

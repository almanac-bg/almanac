import { actions, getState, type LiveGame, useNow, useStore } from '@quiz/client';
import { type GamePlayer, isQueueMode } from '@quiz/shared';
import clsx from 'clsx';
import { Check, Swords } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../Avatar';
import { Button, Spinner } from '../ui';

/** The server keeps an offer open for a minute after the match; the clock here starts a moment later, so a bit less. */
const OFFER_MS = 58_000;
/** Asked, but the server never answered: the offer was already gone (it doesn't say so when nobody had asked yet). */
const NO_ANSWER_MS = 4000;

/** When this device first showed each match's offer — a remount (back to /game) keeps the same clock. */
const shownAt = new Map<string, number>();
/** Offers this device declined (left the results); coming back to them shows them over. */
const declined = new Set<string>();

export type RematchStatus = 'open' | 'invited' | 'waiting' | 'over';

export interface Rematch {
  status: RematchStatus;
  /** The other humans who stayed to the end: the rematch is with them. */
  opponents: GamePlayer[];
  /** Of them, who already asked. */
  ready: Set<string>;
  /** Local time the offer runs out. */
  until: number;
  /** You asked, or someone asked you: worth saying so when it falls through. */
  involved: boolean;
  request: () => void;
}

/**
 * "Реванш" after a ranked queue match with other people: the same humans play again once all of them ask. Null when
 * the match doesn't qualify. Leaving the results (Home, a new queue, the back button) declines it, so nobody waits on
 * someone who's gone.
 */
export function useRematch(game: LiveGame): Rematch | null {
  const end = game.end!;
  const gameId = end.gameId;
  const youId = game.start.youId;

  // Mirrors the server: humans who didn't leave, at least two of them, you among them.
  const opponents = useMemo(() => {
    if (!end.ranked || !isQueueMode(end.mode)) return [];
    const stayed = end.standings.filter((s) => !s.left).map((s) => game.players[s.id]);
    if (!stayed.some((p) => p?.id === youId)) return [];
    return stayed.filter((p): p is GamePlayer => !!p && p.id !== youId && !p.isBot && p.userId !== null);
  }, [end, game.players, youId]);
  const eligible = opponents.length > 0;

  const offer = useStore((s) => (s.rematch?.gameId === gameId ? s.rematch : null));
  const [until] = useState(() => {
    if (!shownAt.has(gameId)) shownAt.set(gameId, Date.now());
    return shownAt.get(gameId)! + OFFER_MS;
  });
  const [asked, setAsked] = useState(false);
  const [seen, setSeen] = useState(false);
  const [expired, setExpired] = useState(() => Date.now() >= until);
  const [unanswered, setUnanswered] = useState(false);

  // An offer that was live and is now gone (while this match is still on screen) was called off.
  useEffect(() => {
    if (offer) setSeen(true);
  }, [offer]);

  useEffect(() => {
    if (!eligible || expired) return;
    const timer = setTimeout(() => setExpired(true), until - Date.now());
    return () => clearTimeout(timer);
  }, [eligible, expired, until]);

  const youReady = !!offer?.ready.includes(youId);
  useEffect(() => {
    if (!asked || youReady) return;
    const timer = setTimeout(() => setUnanswered(true), NO_ANSWER_MS);
    return () => clearTimeout(timer);
  }, [asked, youReady]);

  // Leaving the results declines it. Checked a tick later: a new match taking over (the rematch itself, or anything
  // the server already counted as moving on) isn't leaving, and neither is a remount on the same screen (StrictMode).
  useEffect(() => {
    if (!eligible) return;
    return () => {
      setTimeout(() => {
        const current = getState().game;
        if (current && (current.start.gameId !== gameId || window.location.pathname === '/game')) return;
        declined.add(gameId);
        actions.declineRematch(gameId);
      }, 0);
    };
  }, [eligible, gameId]);

  if (!eligible) return null;
  const ready = new Set(offer?.ready.filter((id) => id !== youId));
  const over = declined.has(gameId) || expired || unanswered || (seen && !offer);
  const status: RematchStatus = over ? 'over' : asked || youReady ? 'waiting' : ready.size ? 'invited' : 'open';
  return {
    status,
    opponents,
    ready,
    until,
    involved: asked || seen,
    request: () => {
      setAsked(true);
      actions.requestRematch(gameId);
    },
  };
}

/** "Мария", "Мария и Иван", "Мария и още 3". */
function names(players: GamePlayer[]) {
  if (players.length <= 2) return players.map((p) => p.name).join(' и ');
  return `${players[0].name} и още ${players.length - 1}`;
}

function SecondsLeft({ until }: { until: number }) {
  const now = useNow(1000);
  return <span className="tabular-nums">{Math.max(0, Math.ceil((until - now) / 1000))} с</span>;
}

/**
 * The rematch offer as one row: who it's with (a tick on everyone who asked), what's happening, and the button.
 * `bar`: inside the phones' sticky action bar; otherwise a card of its own in the page.
 */
export function RematchStrip({ rematch: r, bar, className }: { rematch: Rematch; bar?: boolean; className?: string }) {
  // Nobody asked before it ran out: nothing to report.
  if (r.status === 'over' && !r.involved) return null;
  const readyPlayers = r.opponents.filter((p) => r.ready.has(p.id));
  const pending = r.opponents.filter((p) => !r.ready.has(p.id));
  const invited = r.status === 'invited';

  const title =
    r.status === 'over'
      ? 'Реваншът няма да се състои.'
      : r.status === 'waiting'
        ? `Чакаме ${names(pending)}…`
        : invited
          ? `${names(readyPlayers)} ${readyPlayers.length === 1 ? 'иска' : 'искат'} реванш!`
          : r.opponents.length === 1
            ? `Реванш срещу ${r.opponents[0].name}?`
            : 'Реванш със същите съперници?';
  const detail =
    r.status === 'waiting'
      ? 'Мачът започва, щом всички поискат'
      : invited && pending.length === 0
        ? 'Приеми и мачът започва веднага'
        : 'Започва, щом всички поискат';

  return (
    <div
      className={clsx(
        'flex items-center gap-3 transition-colors',
        bar ? 'rounded-2xl border px-3 py-2' : 'glass mx-auto max-w-xl rounded-3xl p-4 sm:px-5',
        invited
          ? 'border-amber-300/50 bg-amber-400/10 shadow-[0_0_32px_-12px_rgb(251_191_36/0.7)]'
          : bar && 'border-line bg-tint/5',
        r.status === 'over' && 'opacity-70',
        className,
      )}
    >
      <div className="flex shrink-0 -space-x-3">
        {r.opponents.slice(0, 3).map((p) => (
          <Avatar key={p.id} avatar={p.avatar} frame={p.frame} size={bar ? 32 : 44} className="ring-2 ring-ink-2">
            {r.ready.has(p.id) && r.status !== 'over' && (
              <span className="absolute -right-0.5 -bottom-0.5 grid size-4.5 place-items-center rounded-full bg-emerald-400 text-emerald-950 ring-2 ring-ink-2">
                <Check aria-hidden className="size-3" strokeWidth={3.5} />
              </span>
            )}
          </Avatar>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        {/* Only the news is live; the seconds ticking under it would be read out every second. */}
        <p
          role="status"
          className={clsx(
            'line-clamp-2 text-sm font-semibold [overflow-wrap:anywhere]',
            invited && 'text-amber-100',
            r.status === 'over' && 'font-normal text-fg-3',
          )}
        >
          {title}
        </p>
        {/* The bar is narrow on phones: there the button says enough, and only the clock stays. */}
        {r.status !== 'over' && (
          <p className="truncate text-xs text-fg-3">
            {bar ? 'още ' : `${detail} · `}
            <SecondsLeft until={r.until} />
          </p>
        )}
      </div>
      {r.status === 'waiting' ? (
        <Spinner className="mr-2 size-4 shrink-0 text-fg-3" />
      ) : r.status !== 'over' ? (
        <Button size="sm" variant={invited ? 'gold' : 'secondary'} onClick={r.request} className="shrink-0">
          <Swords className="size-4" /> {invited ? 'Приеми' : 'Реванш'}
        </Button>
      ) : null}
    </div>
  );
}

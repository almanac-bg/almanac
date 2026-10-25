import { api, type LiveGame, toast, useStore } from '@quiz/client';
import type { Friendship, FriendsResponse, GamePlayer } from '@quiz/shared';
import clsx from 'clsx';
import { Check, UserCheck, UserPlus } from 'lucide-react';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { useLoad } from '../../lib/load';
import { Spinner } from '../ui';

/** Guest accounts are named like this; they can't be added until they save the account. */
const GUEST_NAME = /^Гост_\d+$/;

interface Friends {
  data: FriendsResponse | null;
  /** The list failed to load: offer the button anyway (the server answers "already friends" if so). */
  failed: boolean;
  update: (next: FriendsResponse) => void;
}

const FriendsContext = createContext<Friends | null>(null);

/** Someone you could add from the results: a human other than you, with a real account. */
const addable = (p: GamePlayer, youId: string) =>
  p.id !== youId && !p.isBot && p.userId !== null && !GUEST_NAME.test(p.name);

function relation(data: FriendsResponse, userId: number): Friendship {
  if (data.friends.some((f) => f.user.id === userId)) return 'friends';
  if (data.outgoing.some((f) => f.user.id === userId)) return 'outgoing';
  if (data.incoming.some((f) => f.user.id === userId)) return 'incoming';
  return 'none';
}

/**
 * Loads your friends list once for the results screen (kept fresh as it changes), so every opponent's button knows
 * where you stand. Nothing loads for a guest or a match without anyone to add.
 */
export function FriendsProvider({ game, children }: { game: LiveGame; children: ReactNode }) {
  const guest = useStore((s) => !!s.me?.isGuest);
  const version = useStore((s) => s.friendsVersion);
  const wanted = !guest && Object.values(game.players).some((p) => addable(p, game.start.youId));
  const { data, error, setData } = useLoad(
    () => (wanted ? api.friends() : Promise.resolve(null)),
    wanted ? 'friends' : 'none',
    version,
  );
  return (
    <FriendsContext.Provider value={wanted ? { data, failed: !!error && !data, update: setData } : null}>
      {children}
    </FriendsContext.Provider>
  );
}

/**
 * "+ Приятел" beside an opponent, or where things stand: request sent, theirs to accept, already friends.
 * `compact` (the podium's narrow columns on phones) keeps the words for screen readers only.
 */
export function FriendButton({
  player,
  youId,
  compact,
  className,
}: {
  player: GamePlayer;
  youId: string;
  compact?: boolean;
  className?: string;
}) {
  const friends = useContext(FriendsContext);
  const [busy, setBusy] = useState(false);
  if (!friends || !addable(player, youId)) return null;
  const { data, failed, update } = friends;
  // Until the list is in, nothing: a button that turns into "Приятели" a moment later would be a false offer.
  if (!data && !failed) return null;
  const state = data ? relation(data, player.userId!) : 'none';
  const label = compact ? 'max-sm:sr-only' : undefined;

  async function add() {
    setBusy(true);
    try {
      const next = await api.addFriend(player.name);
      update(next);
      toast(
        relation(next, player.userId!) === 'friends'
          ? { kind: 'success', title: `Вече сте приятели с ${player.name}!` }
          : { kind: 'success', title: 'Поканата е изпратена', body: `${player.name} ще я види в „Приятели“.` },
      );
    } catch (err) {
      toast({ kind: 'error', title: err instanceof Error ? err.message : 'Нещо се обърка.' });
    } finally {
      setBusy(false);
    }
  }

  const chip = clsx(
    'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold pointer-coarse:h-11',
    compact && 'max-sm:w-11 max-sm:px-0',
    className,
  );

  if (state === 'friends') {
    return (
      <span className={clsx(chip, 'text-emerald-300')} title={`Приятели сте с ${player.name}`}>
        <Check aria-hidden className="size-4" />
        <span className={label}>Приятели</span>
      </span>
    );
  }
  if (state === 'outgoing') {
    return (
      <span className={clsx(chip, 'text-fg-3')} title="Поканата е изпратена">
        <Check aria-hidden className="size-4" />
        <span className={label}>Изпратена</span>
        <span className="sr-only"> покана за приятелство до {player.name}</span>
      </span>
    );
  }
  const incoming = state === 'incoming';
  return (
    <button
      type="button"
      onClick={add}
      disabled={busy}
      aria-label={incoming ? `Приеми поканата за приятелство от ${player.name}` : `Добави ${player.name} за приятел`}
      title={incoming ? `${player.name} ти прати покана за приятелство` : 'Добави за приятел'}
      className={clsx(
        chip,
        'focus-ring border transition-colors disabled:opacity-60',
        incoming
          ? 'border-amber-300/40 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25'
          : 'border-line bg-white/5 text-fg-2 hover:bg-white/10 hover:text-fg',
      )}
    >
      {busy ? (
        <Spinner className="size-3.5" />
      ) : incoming ? (
        <UserCheck aria-hidden className="size-4" />
      ) : (
        <UserPlus aria-hidden className="size-4" />
      )}
      <span aria-hidden className={label}>
        {incoming ? 'Приеми' : 'Приятел'}
      </span>
    </button>
  );
}

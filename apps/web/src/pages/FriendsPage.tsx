import { type FriendEntry, type FriendsResponse, type Presence, titleName } from '@quiz/shared';
import clsx from 'clsx';
import { Check, DoorOpen, Save, Swords, UserMinus, UserPlus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar, LevelBadge } from '../components/Avatar';
import { ClaimAccountModal } from '../components/ClaimAccount';
import { LoadError } from '../components/LoadError';
import { Button, Card, EmptyState, Modal, SectionTitle, Spinner } from '../components/ui';
import { actions, api, timeAgo, toast, useStore } from '@quiz/client';
import { useLoad } from '../lib/load';

const PRESENCE: Record<Presence, { label: string; color: string }> = {
  online: { label: 'Онлайн', color: '#34d399' },
  queue: { label: 'Търси мач', color: '#fbbf24' },
  room: { label: 'В стая', color: '#e879f9' },
  game: { label: 'В игра', color: '#a78bfa' },
  offline: { label: 'Офлайн', color: '#64748b' },
};

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Нещо се обърка.');

export function FriendsPage() {
  const guest = useStore((s) => !!s.me?.isGuest);
  return guest ? <GuestFriends /> : <Friends />;
}

/** Friends need a saved account (a guest may be gone tomorrow), so a guest gets the why and the way, not a form that fails. */
function GuestFriends() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Приятели</h1>
        <p className="mt-1 text-fg-2">Играй с хора, които познаваш.</p>
      </div>
      <Card className="grid place-items-center gap-2 px-6 py-12 text-center">
        <span aria-hidden className="text-5xl">
          👯
        </span>
        <p className="font-display text-lg font-bold">Приятелите са за играчи с профил</p>
        <p className="max-w-md text-sm text-fg-3">
          Играеш като гост. Запази прогреса с име и парола — после добавяш приятели по име, виждаш кога са онлайн, каниш ги в
          своя стая и ги предизвикваш на дуел.
        </p>
        <Button className="mt-4" onClick={() => setOpen(true)}>
          <Save className="size-4" /> Запази прогреса
        </Button>
        <p className="mt-2 max-w-sm text-xs text-fg-3">
          Имаш код за стая от приятел? Въведи го на{' '}
          <Link to="/" className="text-violet-300 hover:underline">
            началната страница
          </Link>{' '}
          — за това не ти трябва профил.
        </p>
      </Card>
      <ClaimAccountModal
        open={open}
        onClose={() => setOpen(false)}
        reason="За да добавяш приятели, избери име и парола. Нивото, серията и всичко изиграно досега остават твои."
      />
    </div>
  );
}

function Friends() {
  // The server bumps the version whenever the list changes (a request, a friend online…): reload, keeping the list on screen.
  const version = useStore((s) => s.friendsVersion);
  const { data, error, retry, setData } = useLoad(() => api.friends(), '', version);
  const [removing, setRemoving] = useState<FriendEntry | null>(null);

  async function mutate(fn: () => Promise<FriendsResponse>, success?: string) {
    try {
      setData(await fn());
      if (success) toast({ kind: 'success', title: success });
    } catch (e) {
      toast({ kind: 'error', title: errorMessage(e) });
    }
  }

  if (!data && error) return <LoadError title="Приятелите не се заредиха" error={error} onRetry={retry} />;
  if (!data) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="size-8 text-violet-400" />
      </div>
    );
  }

  const online = data.friends.filter((f) => f.presence !== 'offline').length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Приятели</h1>
          <p className="mt-1 text-fg-2">
            {data.friends.length ? (
              <>
                <b className="text-fg">{data.friends.length}</b> {data.friends.length === 1 ? 'приятел' : 'приятели'} · <span className="text-emerald-300">{online} онлайн</span>
              </>
            ) : (
              'Играй с хора, които познаваш.'
            )}
          </p>
        </div>
        <AddFriendForm onAdded={setData} />
      </div>

      {data.incoming.length > 0 && (
        <section>
          <SectionTitle>
            Покани за приятелство <span className="text-fuchsia-300">{data.incoming.length}</span>
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {data.incoming.map((f) => (
                <motion.div key={f.user.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}>
                  <Card className="flex items-center gap-3 border-fuchsia-400/40 bg-fuchsia-500/[0.07] p-4">
                    <PersonLink entry={f} />
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        onClick={() => mutate(() => api.acceptFriend(f.user.id), `${f.user.username} вече е твой приятел!`)}
                      >
                        <Check className="size-4" /> Приеми
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Откажи"
                        title="Откажи"
                        onClick={() => mutate(() => api.removeFriend(f.user.id))}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Списък</SectionTitle>
        {data.friends.length === 0 ? (
          <Card>
            <EmptyState
              icon="👯"
              title="Още нямаш приятели тук"
              body="Добави някого по потребителско име горе — щом приеме, ще виждаш кога е онлайн и ще можеш да го предизвикаш на дуел."
            />
          </Card>
        ) : (
          <Card className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {data.friends.map((f) => (
                <FriendRow key={f.user.id} entry={f} onRemove={() => setRemoving(f)} />
              ))}
            </AnimatePresence>
          </Card>
        )}
      </section>

      {data.outgoing.length > 0 && (
        <section>
          <SectionTitle>Изпратени покани</SectionTitle>
          <Card className="divide-y divide-line">
            {data.outgoing.map((f) => (
              <div key={f.user.id} className="flex items-center gap-3 px-4 py-3 opacity-80 sm:px-5">
                <PersonLink entry={f} hint={`изпратена ${timeAgo(f.since)}`} />
                <Button size="sm" variant="ghost" onClick={() => mutate(() => api.removeFriend(f.user.id))}>
                  Откажи поканата
                </Button>
              </div>
            ))}
          </Card>
        </section>
      )}

      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Премахване от приятели">
        <p className="text-fg-2">
          Да премахна ли <b className="text-fg">{removing?.user.username}</b> от приятелите?
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>
            Не
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const target = removing!;
              setRemoving(null);
              void mutate(() => api.removeFriend(target.user.id));
            }}
          >
            Премахни
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function AddFriendForm({ onAdded }: { onAdded: (d: FriendsResponse) => void }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = username.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await api.addFriend(name);
      onAdded(res);
      const key = name.toLowerCase();
      const accepted = res.friends.some((f) => f.user.username.toLowerCase() === key);
      toast({ kind: 'success', title: accepted ? 'Вече сте приятели!' : 'Поканата е изпратена' });
      setUsername('');
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full gap-2 sm:w-auto">
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Потребителско име"
        aria-label="Потребителско име на приятел"
        maxLength={20}
        className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-black/30 px-4 text-[15px] outline-none placeholder:text-fg-3 focus:border-violet-400/60 sm:w-64"
      />
      <Button type="submit" loading={busy} disabled={!username.trim()}>
        <UserPlus className="size-4" /> Добави
      </Button>
    </form>
  );
}

function PersonLink({ entry, hint }: { entry: FriendEntry; hint?: string }) {
  const { user } = entry;
  return (
    <Link to={`/profile/${encodeURIComponent(user.username)}`} className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl">
      <Avatar avatar={user.avatar} frame={user.frame} size={44} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{user.username}</span>
          <LevelBadge level={user.level} />
        </div>
        <div className="truncate text-xs text-fg-3">{hint ?? titleName(user.title)}</div>
      </div>
    </Link>
  );
}

function FriendRow({ entry, onRemove }: { entry: FriendEntry; onRemove: () => void }) {
  const navigate = useNavigate();
  const room = useStore((s) => s.room);
  const inGame = useStore((s) => !!s.game && s.game.phase !== 'ended');
  const [busy, setBusy] = useState<'challenge' | 'invite' | null>(null);
  const { user, presence } = entry;
  const p = PRESENCE[presence];
  const reachable = presence === 'online' || presence === 'room' || presence === 'queue';
  const alreadyInRoom = !!room?.players.some((pl) => pl.userId === user.id);
  const canInvite = !!room && !room.inGame && !inGame && presence !== 'offline' && presence !== 'game' && !alreadyInRoom;

  async function challenge() {
    setBusy('challenge');
    const res = await actions.challenge(user.id);
    setBusy(null);
    if (res.ok) {
      toast({ kind: 'success', title: `Предизвикателството е изпратено на ${user.username}` });
      navigate('/room');
    } else toast({ kind: 'error', title: res.error });
  }

  async function invite() {
    setBusy('invite');
    const res = await actions.invite(user.id);
    setBusy(null);
    if (res.ok) toast({ kind: 'success', title: `Поканата е изпратена на ${user.username}` });
    else toast({ kind: 'error', title: res.error });
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5"
    >
      <Link to={`/profile/${encodeURIComponent(user.username)}`} className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl">
        <span className="relative">
          <Avatar avatar={user.avatar} frame={user.frame} size={46} dim={presence === 'offline'} />
          <span
            className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-ink"
            style={{ background: p.color, boxShadow: presence === 'offline' ? undefined : `0 0 8px ${p.color}` }}
          />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{user.username}</span>
            <LevelBadge level={user.level} />
          </div>
          <div className="flex items-center gap-1.5 truncate text-xs">
            <span className="font-semibold" style={{ color: p.color }}>
              {p.label}
            </span>
            <span className="text-fg-3">· {titleName(user.title)}</span>
          </div>
        </div>
      </Link>

      <div className={clsx('flex shrink-0 items-center gap-2', 'w-full justify-end sm:w-auto')}>
        {canInvite && (
          <Button size="sm" variant="secondary" onClick={invite} loading={busy === 'invite'}>
            <DoorOpen className="size-4" /> Покани в стаята
          </Button>
        )}
        <Button
          size="sm"
          onClick={challenge}
          loading={busy === 'challenge'}
          disabled={!reachable || inGame}
          title={reachable ? 'Създава стая 1 на 1 и праща покана' : 'Може да предизвикаш само приятел, който е онлайн'}
        >
          <Swords className="size-4" /> Предизвикай
        </Button>
        <button
          onClick={onRemove}
          aria-label={`Премахни ${user.username}`}
          title="Премахни от приятели"
          className="focus-ring grid size-11 place-items-center rounded-xl text-fg-3 hover:bg-rose-500/15 hover:text-rose-300"
        >
          <UserMinus className="size-4" />
        </button>
      </div>
    </motion.div>
  );
}

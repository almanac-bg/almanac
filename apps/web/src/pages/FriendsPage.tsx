import { actions, api, errorMessage, timeAgo, toast, useStore } from '@quiz/client';
import { type FriendEntry, type FriendsResponse, titleName } from '@quiz/shared';
import clsx from 'clsx';
import { Check, DoorOpen, Save, UserMinus, UserPlus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Avatar, LevelBadge } from '../components/Avatar';
import { ClaimAccountModal } from '../components/ClaimAccount';
import { DuelButton, DuelRow, useDuels, usePlayDuel } from '../components/duels';
import { LoadError } from '../components/LoadError';
import { PRESENCE } from '../components/presence';
import { Button, Card, EmptyState, Modal, PageSpinner, SectionTitle } from '../components/ui';
import { useLoad } from '../lib/load';
import { usePageTitle } from '../lib/title';

export function FriendsPage() {
  usePageTitle('Приятели');
  const guest = useStore((s) => !!s.me?.isGuest);
  return guest ? <GuestFriends /> : <Friends />;
}

/** Friends need a saved account (a guest may be gone tomorrow), so a guest gets the why and the way, not a form that fails. */
function GuestFriends() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="t-page">Приятели</h1>
        <p className="mt-1 text-fg-2">Играй с хора, които познаваш.</p>
      </div>
      <Card className="grid place-items-center gap-2 px-6 py-12 text-center">
        <span aria-hidden className="text-5xl">
          👯
        </span>
        <p className="t-card">Приятелите са за играчи с профил</p>
        <p className="max-w-md text-sm text-fg-3">
          Играеш като гост. Запази прогреса с име и парола — после добавяш приятели по име, виждаш кога са онлайн, каниш
          ги в своя стая и ги предизвикваш на дуел.
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

/** Your friend duels: the ones waiting for you first, then the ones waiting for them, then the week's results. */
function DuelsSection() {
  const { data } = useDuels();
  const { playing, play } = usePlayDuel();
  const duels = data?.duels ?? [];
  if (!duels.length) return null;
  const order = { yours: 0, theirs: 1, done: 2, expired: 3 } as const;
  return (
    <section>
      <SectionTitle>Дуели</SectionTitle>
      <Card className="divide-y divide-line px-4 py-1 sm:px-5">
        {[...duels]
          .sort((a, b) => order[a.state] - order[b.state] || b.createdAt - a.createdAt)
          .map((d) => (
            <DuelRow key={d.id} duel={d} onPlay={() => play(d.id)} playing={playing === d.id} />
          ))}
      </Card>
    </section>
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
    return <PageSpinner />;
  }

  const online = data.friends.filter((f) => f.presence !== 'offline').length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-page">Приятели</h1>
          <p className="mt-1 text-fg-2">
            {data.friends.length ? (
              <>
                <b className="text-fg">{data.friends.length}</b> {data.friends.length === 1 ? 'приятел' : 'приятели'} ·{' '}
                <span className="text-emerald-300">{online} онлайн</span>
              </>
            ) : (
              'Играй с хора, които познаваш.'
            )}
          </p>
        </div>
        <AddFriendForm onAdded={setData} />
      </div>

      <DuelsSection />

      {data.incoming.length > 0 && (
        <section>
          <SectionTitle>
            Покани за приятелство <span className="text-fuchsia-300">{data.incoming.length}</span>
          </SectionTitle>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {data.incoming.map((f) => (
                <motion.div
                  key={f.user.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  {/* Where the name would be left a few letters, the buttons go under it. */}
                  <Card className="flex flex-wrap items-center justify-end gap-3 border-fuchsia-400/40 bg-fuchsia-500/[0.07] p-4">
                    <PersonLink entry={f} className="basis-32" />
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" onClick={() => mutate(() => api.acceptFriend(f.user.id), 'Вече сте приятели!')}>
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
        className="field h-11 min-w-0 flex-1 rounded-2xl px-4 text-[15px] sm:w-64"
      />
      <Button type="submit" loading={busy} disabled={!username.trim()}>
        <UserPlus className="size-4" /> Добави
      </Button>
    </form>
  );
}

function PersonLink({ entry, hint, className }: { entry: FriendEntry; hint?: string; className?: string }) {
  const { user } = entry;
  return (
    <Link
      to={`/profile/${encodeURIComponent(user.username)}`}
      className={clsx('focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl', className)}
    >
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
  const room = useStore((s) => s.room);
  const inGame = useStore((s) => !!s.game && s.game.phase !== 'ended');
  const [busy, setBusy] = useState<'invite' | null>(null);
  const { user, presence } = entry;
  const p = PRESENCE[presence];
  const alreadyInRoom = !!room?.players.some((pl) => pl.userId === user.id);
  const canInvite =
    !!room && !room.inGame && !inGame && presence !== 'offline' && presence !== 'game' && !alreadyInRoom;

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
      <Link
        to={`/profile/${encodeURIComponent(user.username)}`}
        className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl"
      >
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
        {/* Online or not: you play now, they within a day. */}
        <DuelButton size="sm" friend={user} title={`Играеш сега, ${user.username} — до 24 часа`} />
        <button
          type="button"
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

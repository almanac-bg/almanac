import { actions, api, toast, useStore } from '@quiz/client';
import type { FriendEntry } from '@quiz/shared';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useLoad } from '../../lib/load';
import { Avatar } from '../Avatar';
import { GuestNudge } from '../ClaimAccount';
import { PlayerName } from '../FitName';
import { PRESENCE } from '../presence';
import { Button, Modal, Spinner } from '../ui';

/** A friend who could say yes now: online, in a room or in a queue (not mid-match or away). */
const available = (f: FriendEntry) => f.presence === 'online' || f.presence === 'room' || f.presence === 'queue';

/**
 * What Отбори needs, for its card on the home page — said before the tap rather than after it: a profile, a friend,
 * and one of them online now. `ready`: someone could play now.
 */
export function useDuoNeed(open: boolean): { text: string; ready: boolean } {
  const guest = useStore((s) => !!s.me?.isGuest);
  const version = useStore((s) => s.friendsVersion);
  const asks = open && !guest;
  const { data } = useLoad(() => (asks ? api.friends() : Promise.resolve(null)), String(asks), version);
  if (guest) return { text: 'Нужни са профил и приятел', ready: false };
  if (!data) return { text: 'Играе се с приятел', ready: true };
  if (!data.friends.length) return { text: 'Нужен е приятел', ready: false };
  const online = data.friends.filter(available).length;
  return online
    ? { text: `С приятел · ${online} онлайн`, ready: true }
    : { text: 'С приятел · никой не е онлайн', ready: false };
}

/**
 * Отбори is played by two friends together: pick who to ask. Once they say yes, the two of you wait in the queue as a
 * pair (against another pair of people or bots).
 */
export function DuoPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const guest = useStore((s) => !!s.me?.isGuest);
  const version = useStore((s) => s.friendsVersion);
  const { data } = useLoad(() => (open && !guest ? api.friends() : Promise.resolve(null)), String(open), version);
  const [asked, setAsked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const friends = [...(data?.friends ?? [])].sort(
    (a, b) => Number(b.presence === 'online') - Number(a.presence === 'online'),
  );

  async function ask(f: FriendEntry) {
    setBusy(f.user.id);
    const res = await actions.inviteDuo(f.user.id);
    setBusy(null);
    if (res.ok) setAsked((s) => new Set(s).add(f.user.id));
    else toast({ kind: 'error', title: res.error });
  }

  return (
    <Modal open={open} onClose={onClose} title="Отбори: с кого играеш?">
      <p className="text-sm text-fg-2">
        Двама приятели в един отбор срещу друга двойка (хора или ботове). Покани някого — щом приеме, търсим съперници.
      </p>
      {guest ? (
        <GuestNudge className="mt-4">
          Приятелите са за профили: запази своя с име и парола, за да играеш Отбори.
        </GuestNudge>
      ) : !data ? (
        <div className="grid place-items-center py-8">
          <Spinner className="size-6" />
        </div>
      ) : friends.length === 0 ? (
        <p className="mt-4 text-sm text-fg-3">
          Още нямаш приятели тук.{' '}
          <Link to="/friends" className="font-semibold text-violet-300 hover:underline" onClick={onClose}>
            Добави някого
          </Link>{' '}
          — и играйте заедно.
        </p>
      ) : (
        <ul className="-mx-2 mt-4 max-h-[50vh] divide-y divide-line overflow-y-auto px-2">
          {friends.map((f) => {
            const free = available(f);
            const sent = asked.has(f.user.id);
            return (
              <li key={f.user.id} className="flex items-center gap-3 py-2.5">
                <Avatar avatar={f.user.avatar} frame={f.user.frame} size={40} />
                <div className="min-w-0 flex-1">
                  <PlayerName name={f.user.username} className="font-semibold" />
                  <p className="flex items-center gap-1.5 text-xs text-fg-3">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ background: PRESENCE[f.presence].color }}
                    />
                    {PRESENCE[f.presence].label}
                  </p>
                </div>
                {sent ? (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-300">
                    <Check aria-hidden className="size-4" /> Поканата е пратена
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant={free ? 'primary' : 'ghost'}
                    disabled={!free}
                    loading={busy === f.user.id}
                    onClick={() => void ask(f)}
                  >
                    Покани
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {asked.size > 0 && (
        <p className="mt-4 text-sm text-fg-2" aria-live="polite">
          Поканата важи минута. Щом приеме, търсенето започва само.
        </p>
      )}
    </Modal>
  );
}
